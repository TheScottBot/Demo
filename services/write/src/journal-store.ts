import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  CommandRequestSchema,
  IdempotencyKeySchema,
  OperationIdentifierSchema,
  OperationStateSchema,
  OperationStatusSchema,
  ProviderIdentifierSchema,
  ProviderVersionSchema,
  RecordIdentifierSchema,
  SectionNameSchema,
  TenantIdentifierSchema,
  TimestampSchema,
  commandTypes,
  contractVersions,
  operationDetailField,
  type OperationState,
} from '@demo/contracts';
import { z } from 'zod';
import {
  allowedSourceStates,
  transitionEffects,
  transitionOrigins,
  type TransitionOrigin,
} from './operation-state-machine';
import { writePathSettings } from './write-path-settings';

// Spec 03 §4.4: the only module that touches the command journal table. Every
// item is read back through a strict schema with its schemaVersion checked
// first (§4.1), so an item another version wrote, or a corrupt one, is
// refused and counted rather than acted on.

export const commandJournalAttributes = {
  partitionKey: 'partitionKey',
  sortKey: 'sortKey',
  // Seconds since the epoch, as DynamoDB time to live requires.
  expiresAt: 'expiresAt',
  pendingBucket: 'pendingBucket',
  pendingSince: 'pendingSince',
} as const;

export const pendingIndexName = 'pending-index';

// Spec 00 §3.1 states the version once; every item carries it.
const journalItemSchemaVersion = contractVersions.journalSchemaVersion;
const operationSortKey = 'OP';
const idempotencySortKey = 'IDEM';
// §4.2: one partition is enough at demo volume (WU4).
const pendingBucketValue = 'PENDING';
const millisecondsPerDay = 86_400_000;

function operationPartitionKey(operationId: string): string {
  return `OP#${operationId}`;
}

function idempotencyPartitionKey(tenantId: string, idempotencyKey: string): string {
  return `IDEM#${tenantId}#${idempotencyKey}`;
}

// The detail shapes are the status contract's own (Spec 00 §3.10).
const DetailFieldsSchema = z.strictObject({
  result: OperationStatusSchema.shape.result,
  conflict: OperationStatusSchema.shape.conflict,
  failure: OperationStatusSchema.shape.failure,
});

const OperationItemSchema = z
  .strictObject({
    partitionKey: z.string(),
    sortKey: z.literal(operationSortKey),
    schemaVersion: z.literal(journalItemSchemaVersion),
    operationId: OperationIdentifierSchema,
    tenantId: TenantIdentifierSchema,
    recordId: RecordIdentifierSchema,
    providerId: ProviderIdentifierSchema,
    section: SectionNameSchema,
    commandType: z.enum([commandTypes.sectionReplace, commandTypes.notesAppend]),
    baseVersion: ProviderVersionSchema,
    // §4.1: stored as a map; checked against its section's shape below.
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: IdempotencyKeySchema,
    requestHash: z.string().regex(/^[0-9a-f]{64}$/),
    state: OperationStateSchema,
    attempts: z.int().min(0),
    redriveCount: z.int().min(0),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lastTransitionOrigin: z.enum(transitionOrigins),
    lastErrorReason: z.string().min(1).optional(),
    pendingBucket: z.literal(pendingBucketValue).optional(),
    pendingSince: TimestampSchema.optional(),
    expiresAt: z.int().min(0),
  })
  .extend(DetailFieldsSchema.shape)
  .superRefine((operationItem, refinementContext) => {
    if (operationItem.partitionKey !== operationPartitionKey(operationItem.operationId)) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['partitionKey'],
        message: 'key-mismatch',
      });
    }
    // The payload is held to the very schema intake checked it against, so a
    // stored command is always one intake could have accepted.
    const commandCheck = CommandRequestSchema.safeParse({
      type: operationItem.commandType,
      recordId: operationItem.recordId,
      section: operationItem.section,
      baseVersion: operationItem.baseVersion,
      payload: operationItem.payload,
    });
    if (!commandCheck.success) {
      refinementContext.addIssue({ code: 'custom', path: ['payload'], message: 'command-invalid' });
    }
    const expectedDetail = operationDetailField(operationItem.state);
    for (const detailField of ['result', 'conflict', 'failure'] as const) {
      if ((operationItem[detailField] !== undefined) !== (detailField === expectedDetail)) {
        refinementContext.addIssue({
          code: 'custom',
          path: [detailField],
          message: 'detail-mismatch',
        });
      }
    }
  });

const IdempotencyItemSchema = z.strictObject({
  partitionKey: z.string(),
  sortKey: z.literal(idempotencySortKey),
  schemaVersion: z.literal(journalItemSchemaVersion),
  operationId: OperationIdentifierSchema,
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: TimestampSchema,
  expiresAt: z.int().min(0),
});

type OperationItem = z.infer<typeof OperationItemSchema>;

export type StoredOperation = Omit<OperationItem, 'partitionKey' | 'sortKey'>;

export interface StoredIdempotencyEntry {
  readonly operationId: string;
  readonly requestHash: string;
  readonly createdAt: string;
}

export type NewOperation = Pick<
  StoredOperation,
  | 'operationId'
  | 'tenantId'
  | 'recordId'
  | 'providerId'
  | 'section'
  | 'commandType'
  | 'baseVersion'
  | 'payload'
  | 'idempotencyKey'
  | 'requestHash'
>;

export type OperationDetail = z.infer<typeof DetailFieldsSchema>;

export interface OperationTransitionRequest {
  operationId: string;
  targetState: OperationState;
  origin: TransitionOrigin;
  detail?: OperationDetail;
}

export type OperationTransitionOutcome =
  | { readonly outcome: 'transitioned'; readonly operation: StoredOperation }
  | { readonly outcome: 'stale'; readonly currentState: OperationState | undefined }
  // Operator origin only (§4.3): the target state was already set.
  | { readonly outcome: 'already-done'; readonly operation: StoredOperation }
  // Operator origin only: any other state stops the action.
  | { readonly outcome: 'stopped'; readonly currentState: OperationState | undefined };

export type CreateOperationOutcome =
  | { readonly outcome: 'created'; readonly operation: StoredOperation }
  | {
      readonly outcome: 'idempotency-entry-exists';
      readonly idempotencyEntry: StoredIdempotencyEntry;
    };

export interface PendingOperation {
  readonly operationId: string;
  readonly tenantId: string;
}

export type JournalItemKind = 'operation' | 'idempotency';
export type JournalItemRejectionReason = 'version-mismatch' | 'schema-invalid';

export interface JournalLog {
  // §4.3: logged once per stale transition, with no field of the command.
  recordStaleTransition(details: {
    operationId: string;
    origin: TransitionOrigin;
    targetState: OperationState;
    currentState: OperationState | undefined;
  }): void;
}

export interface JournalMetrics {
  countStaleTransition(origin: TransitionOrigin): void;
  countJournalItemRejected(reason: JournalItemRejectionReason, itemKind: JournalItemKind): void;
}

export class JournalItemRejectedError extends Error {
  constructor(
    readonly reason: JournalItemRejectionReason,
    readonly itemKind: JournalItemKind,
  ) {
    super(`journal-item-rejected: ${itemKind} ${reason}`);
    this.name = 'JournalItemRejectedError';
  }
}

export interface JournalStore {
  createOperation(newOperation: NewOperation): Promise<CreateOperationOutcome>;
  readOperation(operationId: string): Promise<StoredOperation | undefined>;
  // An operation item as the journal's stream delivers it (§5.1), checked as
  // any read is. It touches no table: the relay has the item already.
  readOperationImage(operationItem: Record<string, unknown>): StoredOperation;
  readIdempotencyEntry(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<StoredIdempotencyEntry | undefined>;
  transitionOperation(request: OperationTransitionRequest): Promise<OperationTransitionOutcome>;
  listPendingOperations(options: {
    pendingBefore: Date;
    limit: number;
    pageSize?: number;
  }): Promise<PendingOperation[]>;
}

export interface JournalStoreOptions {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
  log: JournalLog;
  metrics: JournalMetrics;
  now: () => Date;
}

function expirySeconds(from: Date, retentionDays: number): number {
  return Math.floor((from.getTime() + retentionDays * millisecondsPerDay) / 1_000);
}

const tableKeyAttributes = new Set<string>([
  commandJournalAttributes.partitionKey,
  commandJournalAttributes.sortKey,
]);

// The table's keys are the store's business; callers see the operation.
function withoutKeys(operationItem: OperationItem): StoredOperation {
  return Object.fromEntries(
    Object.entries(operationItem).filter(
      ([attributeName]) => !tableKeyAttributes.has(attributeName),
    ),
  ) as StoredOperation;
}

const transitionOriginSchema = z.enum(transitionOrigins);

export function createJournalStore(options: JournalStoreOptions): JournalStore {
  const { documentClient, tableName, log, metrics, now } = options;

  // schemaVersion is checked before anything else, so an item from another
  // version is named as that, not as a schema failure.
  function parseItem<Parsed>(
    storedItem: Record<string, unknown>,
    itemKind: JournalItemKind,
    itemSchema: z.ZodType<Parsed>,
  ): Parsed {
    if (storedItem['schemaVersion'] !== journalItemSchemaVersion) {
      metrics.countJournalItemRejected('version-mismatch', itemKind);
      throw new JournalItemRejectedError('version-mismatch', itemKind);
    }
    const parsedItem = itemSchema.safeParse(storedItem);
    if (!parsedItem.success) {
      metrics.countJournalItemRejected('schema-invalid', itemKind);
      throw new JournalItemRejectedError('schema-invalid', itemKind);
    }
    return parsedItem.data;
  }

  const parseOperation = (storedItem: Record<string, unknown>) =>
    withoutKeys(parseItem(storedItem, 'operation', OperationItemSchema));

  const parseIdempotencyEntry = (storedItem: Record<string, unknown>): StoredIdempotencyEntry => {
    const idempotencyItem = parseItem(storedItem, 'idempotency', IdempotencyItemSchema);
    return {
      operationId: idempotencyItem.operationId,
      requestHash: idempotencyItem.requestHash,
      createdAt: idempotencyItem.createdAt,
    };
  };

  const onlyIfNew = {
    ConditionExpression: 'attribute_not_exists(#partitionKey)',
    ExpressionAttributeNames: { '#partitionKey': commandJournalAttributes.partitionKey },
    // WU2: the existing item comes back with the cancellation, so a repeated
    // key is answered without a second read.
    ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
  } as const;

  return {
    createOperation: async (newOperation) => {
      const createdAt = now();
      const createdAtText = createdAt.toISOString();
      const operationItem = {
        partitionKey: operationPartitionKey(newOperation.operationId),
        sortKey: operationSortKey,
        schemaVersion: journalItemSchemaVersion,
        ...newOperation,
        state: 'ACCEPTED',
        attempts: 0,
        redriveCount: 0,
        createdAt: createdAtText,
        updatedAt: createdAtText,
        lastTransitionOrigin: 'intake',
        pendingBucket: pendingBucketValue,
        pendingSince: createdAtText,
        expiresAt: expirySeconds(createdAt, writePathSettings.operationRetentionDays),
      } satisfies OperationItem;
      const idempotencyItem = {
        partitionKey: idempotencyPartitionKey(newOperation.tenantId, newOperation.idempotencyKey),
        sortKey: idempotencySortKey,
        schemaVersion: journalItemSchemaVersion,
        operationId: newOperation.operationId,
        requestHash: newOperation.requestHash,
        createdAt: createdAtText,
        expiresAt: expirySeconds(createdAt, writePathSettings.idempotencyRetentionDays),
      } satisfies z.infer<typeof IdempotencyItemSchema>;
      try {
        await documentClient.send(
          new TransactWriteCommand({
            TransactItems: [
              { Put: { TableName: tableName, Item: operationItem, ...onlyIfNew } },
              { Put: { TableName: tableName, Item: idempotencyItem, ...onlyIfNew } },
            ],
          }),
        );
      } catch (transactionFailure) {
        // Only the idempotency item failing its condition, and nothing else,
        // is a replay (§3.2); every other failure goes to the caller, which
        // answers 500 so the client retries with the same key.
        const reasons =
          transactionFailure instanceof TransactionCanceledException
            ? transactionFailure.CancellationReasons
            : undefined;
        const existingEntry = reasons?.[1]?.Item;
        if (
          reasons?.[0]?.Code === 'None' &&
          reasons[1]?.Code === 'ConditionalCheckFailed' &&
          existingEntry !== undefined
        ) {
          return {
            outcome: 'idempotency-entry-exists',
            idempotencyEntry: parseIdempotencyEntry(unmarshall(existingEntry)),
          };
        }
        throw transactionFailure;
      }
      return { outcome: 'created', operation: withoutKeys(operationItem) };
    },

    readOperation: async (operationId) => {
      const readResult = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { partitionKey: operationPartitionKey(operationId), sortKey: operationSortKey },
          // §9 step 3, §6.3 step 2: a state just written must be seen.
          ConsistentRead: true,
        }),
      );
      return readResult.Item === undefined ? undefined : parseOperation(readResult.Item);
    },

    readOperationImage: (operationItem) => parseOperation(operationItem),

    readIdempotencyEntry: async (tenantId, idempotencyKey) => {
      const readResult = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            partitionKey: idempotencyPartitionKey(tenantId, idempotencyKey),
            sortKey: idempotencySortKey,
          },
          ConsistentRead: true,
        }),
      );
      return readResult.Item === undefined ? undefined : parseIdempotencyEntry(readResult.Item);
    },

    transitionOperation: async (request) => {
      // Checked at run time as well as by type, so no path can omit the
      // origin (datum 0.14).
      if (!transitionOriginSchema.safeParse(request.origin).success) {
        throw new Error('transition-origin-required');
      }
      const sourceStates = allowedSourceStates(request.targetState, request.origin);
      if (sourceStates.length === 0) {
        throw new Error(
          `transition-not-in-state-machine: ${request.targetState} by ${request.origin}`,
        );
      }
      const targetDetail = operationDetailField(request.targetState);
      const suppliedDetails = Object.keys(request.detail ?? {});
      if (
        suppliedDetails.length !== (targetDetail === undefined ? 0 : 1) ||
        (targetDetail !== undefined && request.detail?.[targetDetail] === undefined)
      ) {
        throw new Error(`transition-detail-mismatch: ${request.targetState}`);
      }
      const effects = transitionEffects(request.targetState, request.origin);
      const names: Record<string, string> = {
        '#state': 'state',
        '#updatedAt': 'updatedAt',
        '#lastTransitionOrigin': 'lastTransitionOrigin',
      };
      const values: Record<string, unknown> = {
        ':targetState': request.targetState,
        ':updatedAt': now().toISOString(),
        ':lastTransitionOrigin': request.origin,
      };
      const setClauses = [
        '#state = :targetState',
        '#updatedAt = :updatedAt',
        '#lastTransitionOrigin = :lastTransitionOrigin',
      ];
      if (targetDetail !== undefined) {
        names[`#${targetDetail}`] = targetDetail;
        values[`:${targetDetail}`] = request.detail?.[targetDetail];
        setClauses.push(`#${targetDetail} = :${targetDetail}`);
      }
      // Every transition leaves ACCEPTED or was never in it, so the pending
      // attributes go on each (§4.2), as does any detail the target state
      // does not carry.
      const removedAttributes = [
        commandJournalAttributes.pendingBucket,
        commandJournalAttributes.pendingSince,
        ...(['result', 'conflict', 'failure'] as const).filter(
          (detailField) => detailField !== targetDetail,
        ),
      ];
      for (const removedAttribute of removedAttributes) {
        names[`#${removedAttribute}`] = removedAttribute;
      }
      const addClauses: string[] = [];
      if (effects.addAttempt) {
        names['#attempts'] = 'attempts';
        values[':one'] = 1;
        addClauses.push('#attempts :one');
      }
      if (effects.addRedrive) {
        names['#redriveCount'] = 'redriveCount';
        values[':one'] = 1;
        addClauses.push('#redriveCount :one');
      }
      sourceStates.forEach((sourceState, sourceIndex) => {
        values[`:sourceState${String(sourceIndex)}`] = sourceState;
      });
      const updateExpression = [
        `SET ${setClauses.join(', ')}`,
        `REMOVE ${removedAttributes.map((removedAttribute) => `#${removedAttribute}`).join(', ')}`,
        ...(addClauses.length === 0 ? [] : [`ADD ${addClauses.join(', ')}`]),
      ].join(' ');
      try {
        const updateResult = await documentClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: {
              partitionKey: operationPartitionKey(request.operationId),
              sortKey: operationSortKey,
            },
            UpdateExpression: updateExpression,
            ConditionExpression: `#state IN (${sourceStates
              .map((_sourceState, sourceIndex) => `:sourceState${String(sourceIndex)}`)
              .join(', ')})`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW',
            ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
          }),
        );
        return {
          outcome: 'transitioned',
          operation: parseOperation(updateResult.Attributes ?? {}),
        };
      } catch (updateFailure) {
        if (!(updateFailure instanceof ConditionalCheckFailedException)) {
          throw updateFailure;
        }
        const currentOperation =
          updateFailure.Item === undefined
            ? undefined
            : parseOperation(unmarshall(updateFailure.Item));
        if (request.origin === 'operator') {
          // §4.3, §8.2: a rerun finds its own earlier step done, and goes on.
          return currentOperation?.state === request.targetState
            ? { outcome: 'already-done', operation: currentOperation }
            : { outcome: 'stopped', currentState: currentOperation?.state };
        }
        log.recordStaleTransition({
          operationId: request.operationId,
          origin: request.origin,
          targetState: request.targetState,
          currentState: currentOperation?.state,
        });
        metrics.countStaleTransition(request.origin);
        return { outcome: 'stale', currentState: currentOperation?.state };
      }
    },

    listPendingOperations: async ({ pendingBefore, limit, pageSize = limit }) => {
      const pendingOperations: PendingOperation[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const page = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: pendingIndexName,
            KeyConditionExpression:
              '#pendingBucket = :pendingBucket AND #pendingSince < :pendingCutoff',
            ExpressionAttributeNames: {
              '#pendingBucket': commandJournalAttributes.pendingBucket,
              '#pendingSince': commandJournalAttributes.pendingSince,
            },
            ExpressionAttributeValues: {
              ':pendingBucket': pendingBucketValue,
              ':pendingCutoff': pendingBefore.toISOString(),
            },
            Limit: Math.min(pageSize, limit - pendingOperations.length),
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        for (const indexEntry of page.Items ?? []) {
          pendingOperations.push({
            // The index projects the table's keys, not operationId (§4.2).
            operationId: OperationIdentifierSchema.parse(
              /^OP#(?<operationId>.+)$/.exec(String(indexEntry['partitionKey']))?.groups?.[
                'operationId'
              ],
            ),
            tenantId: TenantIdentifierSchema.parse(indexEntry['tenantId']),
          });
        }
        exclusiveStartKey = page.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined && pendingOperations.length < limit);
      return pendingOperations;
    },
  };
}
