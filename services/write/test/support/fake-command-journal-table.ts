import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

// A stand in for the command journal table (Spec 03 §4), behind
// aws-sdk-client-mock (CU6). It interprets only the requests the journal
// store makes, in the exact forms it makes them, and refuses anything else,
// so a change in how the store talks to DynamoDB fails a test rather than
// passing against a fake that guessed. Condition failures carry the existing
// item in DynamoDB's own attribute value form, as the service returns it and
// lib-dynamodb leaves it (WU2).

type StoredItem = Record<string, unknown>;

export interface FakeCommandJournalTable {
  readonly documentClient: DynamoDBDocumentClient;
  readonly items: Map<string, StoredItem>;
  readonly calls: { command: string; input: Record<string, unknown> }[];
  putItem(storedItem: StoredItem): void;
  itemAt(partitionKey: string, sortKey: string): StoredItem | undefined;
  // The next request of this kind fails with this error, once.
  failNext(command: 'TransactWrite' | 'Update' | 'Get' | 'Query', failure: Error): void;
  restore(): void;
}

export const fakeJournalTableName = 'demo-dev-command-journal';
const pendingIndexName = 'pending-index';
const conditionMetadata = { $metadata: {} };

function itemKey(partitionKey: unknown, sortKey: unknown): string {
  return `${String(partitionKey)}\u0000${String(sortKey)}`;
}

function requireTable(input: Record<string, unknown>): void {
  if (input['TableName'] !== fakeJournalTableName) {
    throw new Error(`unexpected table: ${String(input['TableName'])}`);
  }
}

function requireExactly(
  input: Record<string, unknown>,
  field: string,
  expectedValue: unknown,
): void {
  if (JSON.stringify(input[field]) !== JSON.stringify(expectedValue)) {
    throw new Error(`unexpected ${field}: ${JSON.stringify(input[field])}`);
  }
}

type ExpressionNames = Record<string, string>;
type ExpressionValues = Record<string, unknown>;

function nameOf(placeholder: string, expressionNames: ExpressionNames): string {
  const attributeName = expressionNames[placeholder];
  if (attributeName === undefined) {
    throw new Error(`unbound name placeholder: ${placeholder}`);
  }
  return attributeName;
}

function valueOf(placeholder: string, expressionValues: ExpressionValues): unknown {
  if (!(placeholder in expressionValues)) {
    throw new Error(`unbound value placeholder: ${placeholder}`);
  }
  return expressionValues[placeholder];
}

// The one update form the store sends: SET pairs, then optional REMOVE
// names, then optional ADD pairs, each clause once and in that order.
function applyUpdateExpression(
  storedItem: StoredItem,
  updateExpression: string,
  expressionNames: ExpressionNames,
  expressionValues: ExpressionValues,
): StoredItem {
  const clauses =
    /^SET (?<setClause>.+?)(?: REMOVE (?<removeClause>.+?))?(?: ADD (?<addClause>.+))?$/.exec(
      updateExpression,
    );
  if (clauses?.groups?.['setClause'] === undefined) {
    throw new Error(`unexpected update expression: ${updateExpression}`);
  }
  const updatedItem = structuredClone(storedItem);
  for (const assignment of clauses.groups['setClause'].split(', ')) {
    const assignmentParts = /^(#\w+) = (:\w+)$/.exec(assignment);
    if (assignmentParts?.[1] === undefined || assignmentParts[2] === undefined) {
      throw new Error(`unexpected SET assignment: ${assignment}`);
    }
    updatedItem[nameOf(assignmentParts[1], expressionNames)] = valueOf(
      assignmentParts[2],
      expressionValues,
    );
  }
  for (const removedPlaceholder of clauses.groups['removeClause']?.split(', ') ?? []) {
    if (!/^#\w+$/.test(removedPlaceholder)) {
      throw new Error(`unexpected REMOVE name: ${removedPlaceholder}`);
    }
    Reflect.deleteProperty(updatedItem, nameOf(removedPlaceholder, expressionNames));
  }
  for (const addition of clauses.groups['addClause']?.split(', ') ?? []) {
    const additionParts = /^(#\w+) (:\w+)$/.exec(addition);
    if (additionParts?.[1] === undefined || additionParts[2] === undefined) {
      throw new Error(`unexpected ADD pair: ${addition}`);
    }
    const attributeName = nameOf(additionParts[1], expressionNames);
    const increment = valueOf(additionParts[2], expressionValues);
    const currentValue = updatedItem[attributeName] ?? 0;
    if (typeof increment !== 'number' || typeof currentValue !== 'number') {
      throw new Error(`ADD needs numbers: ${attributeName}`);
    }
    updatedItem[attributeName] = currentValue + increment;
  }
  return updatedItem;
}

// The one condition form the store sends on an update: the current state is
// one of the allowed sources (Spec 03 §4.3).
function stateConditionHolds(
  storedItem: StoredItem | undefined,
  conditionExpression: string,
  expressionNames: ExpressionNames,
  expressionValues: ExpressionValues,
): boolean {
  const conditionParts = /^(#\w+) IN \((:\w+(?:, :\w+)*)\)$/.exec(conditionExpression);
  if (conditionParts?.[1] === undefined || conditionParts[2] === undefined) {
    throw new Error(`unexpected condition: ${conditionExpression}`);
  }
  if (storedItem === undefined) {
    return false;
  }
  const attributeName = nameOf(conditionParts[1], expressionNames);
  const allowedValues = conditionParts[2]
    .split(', ')
    .map((placeholder) => valueOf(placeholder, expressionValues));
  return allowedValues.includes(storedItem[attributeName]);
}

export function createFakeCommandJournalTable(): FakeCommandJournalTable {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-2' }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const clientMock = mockClient(documentClient);
  const items = new Map<string, StoredItem>();
  const calls: { command: string; input: Record<string, unknown> }[] = [];
  const pendingFailures = new Map<string, Error>();

  const takeFailure = (command: string): void => {
    const failure = pendingFailures.get(command);
    if (failure !== undefined) {
      pendingFailures.delete(command);
      throw failure;
    }
  };

  // Registered first: the specific handlers below take precedence over it.
  clientMock.onAnyCommand().callsFake((input: unknown) => {
    throw new Error(`unexpected request to the journal table: ${JSON.stringify(input)}`);
  });

  clientMock.on(TransactWriteCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'TransactWrite', input });
    takeFailure('TransactWrite');
    const transactItems = input['TransactItems'] as { Put?: Record<string, unknown> }[];
    const puts = transactItems.map((transactItem) => {
      if (transactItem.Put === undefined || Object.keys(transactItem).length !== 1) {
        throw new Error('unexpected transaction action: only Put is made');
      }
      requireTable(transactItem.Put);
      requireExactly(
        transactItem.Put,
        'ConditionExpression',
        'attribute_not_exists(#partitionKey)',
      );
      requireExactly(transactItem.Put, 'ExpressionAttributeNames', {
        '#partitionKey': 'partitionKey',
      });
      requireExactly(transactItem.Put, 'ReturnValuesOnConditionCheckFailure', 'ALL_OLD');
      return transactItem.Put['Item'] as StoredItem;
    });
    const existingItems = puts.map((putItem) =>
      items.get(itemKey(putItem['partitionKey'], putItem['sortKey'])),
    );
    if (existingItems.some((existingItem) => existingItem !== undefined)) {
      throw new TransactionCanceledException({
        message: 'Transaction cancelled, please refer cancellation reasons for specific reasons',
        ...conditionMetadata,
        CancellationReasons: existingItems.map((existingItem) =>
          existingItem === undefined
            ? { Code: 'None' }
            : {
                Code: 'ConditionalCheckFailed',
                Message: 'The conditional request failed',
                Item: marshall(existingItem),
              },
        ),
      });
    }
    for (const putItem of puts) {
      items.set(itemKey(putItem['partitionKey'], putItem['sortKey']), structuredClone(putItem));
    }
    return {};
  });

  clientMock.on(GetCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Get', input });
    takeFailure('Get');
    requireTable(input);
    requireExactly(input, 'ConsistentRead', true);
    const keyInput = input['Key'] as StoredItem;
    const storedItem = items.get(itemKey(keyInput['partitionKey'], keyInput['sortKey']));
    return storedItem === undefined ? {} : { Item: structuredClone(storedItem) };
  });

  clientMock.on(UpdateCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Update', input });
    takeFailure('Update');
    requireTable(input);
    requireExactly(input, 'ReturnValues', 'ALL_NEW');
    requireExactly(input, 'ReturnValuesOnConditionCheckFailure', 'ALL_OLD');
    const keyInput = input['Key'] as StoredItem;
    const storageKey = itemKey(keyInput['partitionKey'], keyInput['sortKey']);
    const storedItem = items.get(storageKey);
    const expressionNames = input['ExpressionAttributeNames'] as ExpressionNames;
    const expressionValues = input['ExpressionAttributeValues'] as ExpressionValues;
    if (
      !stateConditionHolds(
        storedItem,
        String(input['ConditionExpression']),
        expressionNames,
        expressionValues,
      )
    ) {
      throw new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        ...conditionMetadata,
        ...(storedItem === undefined ? {} : { Item: marshall(storedItem) }),
      });
    }
    const updatedItem = applyUpdateExpression(
      storedItem as StoredItem,
      String(input['UpdateExpression']),
      expressionNames,
      expressionValues,
    );
    items.set(storageKey, updatedItem);
    return { Attributes: structuredClone(updatedItem) };
  });

  clientMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Query', input });
    takeFailure('Query');
    requireTable(input);
    requireExactly(input, 'IndexName', pendingIndexName);
    requireExactly(
      input,
      'KeyConditionExpression',
      '#pendingBucket = :pendingBucket AND #pendingSince < :pendingCutoff',
    );
    requireExactly(input, 'ExpressionAttributeNames', {
      '#pendingBucket': 'pendingBucket',
      '#pendingSince': 'pendingSince',
    });
    const expressionValues = input['ExpressionAttributeValues'] as ExpressionValues;
    const limit = input['Limit'];
    if (typeof limit !== 'number' || limit < 1) {
      throw new Error('a pending query is always limited');
    }
    const startKey = input['ExclusiveStartKey'] as StoredItem | undefined;
    // The index projects its keys, the table's keys and tenantId (§4.2),
    // sorted by pendingSince, then by the table key to keep ties stable.
    const indexEntries = [...items.values()]
      .filter(
        (storedItem) =>
          storedItem['pendingBucket'] === expressionValues[':pendingBucket'] &&
          typeof storedItem['pendingSince'] === 'string' &&
          storedItem['pendingSince'] < String(expressionValues[':pendingCutoff']),
      )
      .map((storedItem) => ({
        partitionKey: storedItem['partitionKey'],
        sortKey: storedItem['sortKey'],
        pendingBucket: storedItem['pendingBucket'],
        pendingSince: storedItem['pendingSince'],
        tenantId: storedItem['tenantId'],
      }))
      .sort((left, right) =>
        `${String(left.pendingSince)}${String(left.partitionKey)}`.localeCompare(
          `${String(right.pendingSince)}${String(right.partitionKey)}`,
        ),
      );
    const startIndex =
      startKey === undefined
        ? 0
        : indexEntries.findIndex(
            (indexEntry) => indexEntry.partitionKey === startKey['partitionKey'],
          ) + 1;
    const page = indexEntries.slice(startIndex, startIndex + limit);
    const lastEntry = page.at(-1);
    const morePages = startIndex + limit < indexEntries.length;
    return {
      Items: page,
      ...(morePages && lastEntry !== undefined
        ? {
            LastEvaluatedKey: {
              partitionKey: lastEntry.partitionKey,
              sortKey: lastEntry.sortKey,
              pendingBucket: lastEntry.pendingBucket,
              pendingSince: lastEntry.pendingSince,
            },
          }
        : {}),
    };
  });

  return {
    documentClient,
    items,
    calls,
    putItem: (storedItem) => {
      items.set(
        itemKey(storedItem['partitionKey'], storedItem['sortKey']),
        structuredClone(storedItem),
      );
    },
    itemAt: (partitionKey, sortKey) => items.get(itemKey(partitionKey, sortKey)),
    failNext: (command, failure) => {
      pendingFailures.set(command, failure);
    },
    restore: () => {
      clientMock.restore();
    },
  };
}
