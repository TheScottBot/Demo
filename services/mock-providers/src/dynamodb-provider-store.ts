import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { SectionsPartialSchema, mockProviderBehaviour } from '@demo/contracts';
import type {
  IdempotencyEntryKey,
  ProviderRecordKey,
  ProviderSimulationStore,
  StoredIdempotencyEntry,
  StoredProviderRecord,
} from '@demo/test-doubles/provider-simulation';
import { z } from 'zod';

// The mock provider store table (Spec 00 §4.3): one tableItem per section, under
// partitionKey providerId#tenantId#recordId and sortKey the section name.
// Idempotency entries share the table under their own partition prefix, so
// they can never collide with a record, and expire by DynamoDB's time to live.
//
// Limitation: a write reads the record and then puts its sections without a
// condition, so two concurrent writes to one record could interleave. A mock
// provider is driven by one test at a time; the real providers are out of
// scope (Spec 00 §1).

export const mockProviderStoreAttributes = {
  partitionKey: 'partitionKey',
  sortKey: 'sortKey',
  // Seconds since the epoch, as DynamoDB time to live requires (§2.3).
  expiresAt: 'expiresAt',
} as const;

const idempotencySortKey = 'entry';

export function recordPartitionKey(recordKey: ProviderRecordKey): string {
  return [recordKey.providerId, recordKey.tenantId, recordKey.recordId].join('#');
}

export function idempotencyPartitionKey(entryKey: IdempotencyEntryKey): string {
  return ['idempotency', entryKey.providerId, entryKey.tenantId, entryKey.idempotencyKey].join('#');
}

// What the table holds was written by this code, but it is still read through
// a schema: a corrupt tableItem fails loudly rather than reaching a test as data.
const StoredSectionItemSchema = z.object({
  sortKey: z.string(),
  sectionValue: z.unknown(),
  updatedAt: z.string(),
});

const StoredIdempotencyEntrySchema = z.strictObject({
  requestFingerprint: z.string(),
  firstSeenAt: z.string(),
  attemptsSeen: z.int().min(0),
  throttled: z.boolean(),
  completedResponse: z
    .strictObject({
      status: z.int(),
      headers: z.record(z.string(), z.string()),
      bodyText: z.string().optional(),
    })
    .optional(),
});

export interface DynamoDbProviderStoreOptions {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
}

export function createDynamoDbProviderStore(
  options: DynamoDbProviderStoreOptions,
): ProviderSimulationStore {
  const { documentClient, tableName } = options;
  return {
    readRecord: async (recordKey) => {
      const sectionItems: z.infer<typeof StoredSectionItemSchema>[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const page = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'partitionKey = :partitionKey',
            ExpressionAttributeValues: { ':partitionKey': recordPartitionKey(recordKey) },
            // A write must be seen by the read that follows it.
            ConsistentRead: true,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        sectionItems.push(
          ...(page.Items ?? []).map((tableItem) => StoredSectionItemSchema.parse(tableItem)),
        );
        exclusiveStartKey = page.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined);
      if (sectionItems.length === 0) {
        return undefined;
      }
      const storedRecord: StoredProviderRecord = {
        sections: SectionsPartialSchema.parse(
          Object.fromEntries(
            sectionItems.map((sectionItem) => [sectionItem.sortKey, sectionItem.sectionValue]),
          ),
        ),
        // Every write stamps every section of the record, so the latest stamp
        // is the record's.
        updatedAt:
          sectionItems
            .map((sectionItem) => sectionItem.updatedAt)
            .sort()
            .at(-1) ?? '',
      };
      return storedRecord;
    },
    writeRecord: async (recordKey, storedRecord) => {
      // By key, and never a delete (datum 0.14): a section absent from the
      // write keeps its tableItem.
      for (const [sectionName, sectionValue] of Object.entries(storedRecord.sections)) {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              partitionKey: recordPartitionKey(recordKey),
              sortKey: sectionName,
              sectionValue,
              updatedAt: storedRecord.updatedAt,
            },
          }),
        );
      }
    },
    readIdempotencyEntry: async (entryKey) => {
      const result = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { partitionKey: idempotencyPartitionKey(entryKey), sortKey: idempotencySortKey },
          ConsistentRead: true,
        }),
      );
      const storedItem = result.Item as { entry?: unknown } | undefined;
      return storedItem?.entry === undefined
        ? undefined
        : (StoredIdempotencyEntrySchema.parse(storedItem.entry) as StoredIdempotencyEntry);
    },
    writeIdempotencyEntry: async (entryKey, entry) => {
      const expiresAt =
        Math.floor(Date.parse(entry.firstSeenAt) / 1_000) +
        mockProviderBehaviour.idempotentReplayWindowSeconds;
      await documentClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            partitionKey: idempotencyPartitionKey(entryKey),
            sortKey: idempotencySortKey,
            entry,
            expiresAt,
          },
        }),
      );
    },
  };
}
