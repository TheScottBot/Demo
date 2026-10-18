// Seeds a deployed stage's mock provider store (Spec 00 §4.3):
// `npm run seed:dev --workspace services/mock-providers`, and likewise for
// stub, test and demo. It needs AWS credentials for that stage, so under CQ6,
// with nothing deployed, it is built and tested (seed.test.ts) but not run.
import nodeProcess from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { mockProviderStoreTableName, seedMockProviderStore } from '../src/index';

const stage = z.enum(['dev', 'stub', 'test', 'demo']).parse(nodeProcess.argv[2]);

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

await seedMockProviderStore({ documentClient, tableName: mockProviderStoreTableName(stage) });
console.log(`seeded ${mockProviderStoreTableName(stage)}`);
