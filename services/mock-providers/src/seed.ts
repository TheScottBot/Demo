import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { demoResourceName, type DemoStage } from '@demo/construct-contracts';
import {
  providerRecordsFromSynthetic,
  syntheticRecords,
  type SyntheticRecord,
} from '@demo/test-doubles/provider-simulation';
import { createDynamoDbProviderStore } from './dynamodb-provider-store';

// Spec 00 §4.3: the seed writes the CU11 synthetic records for both tenants,
// one per fault prefix among them, by key, and deletes nothing. A rerun after a
// partial failure therefore converges on the same store (datum 0.14), and a
// rerun after tests have written restores the seeded values.

export function mockProviderStoreTableName(stage: DemoStage): string {
  return demoResourceName(stage, 'mock-provider-store');
}

export interface SeedOptions {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
  sourceRecords?: readonly SyntheticRecord[];
}

export async function seedMockProviderStore(options: SeedOptions): Promise<void> {
  const store = createDynamoDbProviderStore(options);
  for (const [recordKey, storedRecord] of providerRecordsFromSynthetic(
    options.sourceRecords ?? syntheticRecords,
  )) {
    await store.writeRecord(recordKey, storedRecord);
  }
}
