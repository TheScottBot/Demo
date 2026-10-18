import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

// A stand in for the mock provider store table, behind aws-sdk-client-mock
// (CU6). It interprets only the exact requests the store makes, and refuses
// anything else, so a change in how the store talks to DynamoDB fails a test
// rather than passing against a fake that guessed.

type StoredItem = Record<string, unknown>;

export interface FakeMockProviderTable {
  readonly documentClient: DynamoDBDocumentClient;
  readonly items: Map<string, StoredItem>;
  readonly calls: { command: string; input: Record<string, unknown> }[];
  // Makes the next put fail after this many puts have succeeded, to test a
  // seed interrupted part way.
  failPutsAfter(successfulPuts: number): void;
  restore(): void;
}

const expectedTableName = 'demo-dev-mock-provider-store';

function itemKey(partitionKey: unknown, sortKey: unknown): string {
  return `${String(partitionKey)}\u0000${String(sortKey)}`;
}

function requireTable(input: Record<string, unknown>): void {
  if (input['TableName'] !== expectedTableName) {
    throw new Error(`unexpected table: ${String(input['TableName'])}`);
  }
}

export function createFakeMockProviderTable(): FakeMockProviderTable {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-2' }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const clientMock = mockClient(documentClient);
  const items = new Map<string, StoredItem>();
  const calls: { command: string; input: Record<string, unknown> }[] = [];
  let putsBeforeFailure: number | undefined;

  clientMock.on(PutCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Put', input });
    requireTable(input);
    if (putsBeforeFailure !== undefined) {
      if (putsBeforeFailure === 0) {
        putsBeforeFailure = undefined;
        throw new Error('fake table: planted put failure');
      }
      putsBeforeFailure -= 1;
    }
    const tableItem = structuredClone(input['Item']) as StoredItem;
    items.set(itemKey(tableItem['partitionKey'], tableItem['sortKey']), tableItem);
    return {};
  });
  clientMock.on(GetCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Get', input });
    requireTable(input);
    const key = input['Key'] as StoredItem;
    const tableItem = items.get(itemKey(key['partitionKey'], key['sortKey']));
    return { Item: tableItem === undefined ? undefined : structuredClone(tableItem) };
  });
  clientMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Query', input });
    requireTable(input);
    if (input['KeyConditionExpression'] !== 'partitionKey = :partitionKey') {
      throw new Error(`unexpected query: ${String(input['KeyConditionExpression'])}`);
    }
    const values = input['ExpressionAttributeValues'] as StoredItem;
    const matching = [...items.values()]
      .filter((tableItem) => tableItem['partitionKey'] === values[':partitionKey'])
      .sort((first, second) => String(first['sortKey']).localeCompare(String(second['sortKey'])))
      .map((tableItem) => structuredClone(tableItem));
    return { Items: matching };
  });
  clientMock.on(DeleteCommand).callsFake((input: Record<string, unknown>) => {
    calls.push({ command: 'Delete', input });
    throw new Error('fake table: the mock providers never delete');
  });

  return {
    documentClient,
    items,
    calls,
    failPutsAfter: (successfulPuts) => {
      putsBeforeFailure = successfulPuts;
    },
    restore: () => {
      clientMock.restore();
    },
  };
}

export const fakeTableName = expectedTableName;
