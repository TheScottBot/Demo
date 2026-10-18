// Spec 00 §4.3 and datum 0.14: seeding writes by key and deletes nothing, so a
// rerun, even after a partial failure, converges on the same store.
import { mockProviderBehaviour } from '@demo/contracts';
import {
  providerRecordsFromSynthetic,
  syntheticRecords,
} from '@demo/test-doubles/provider-simulation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockProviderStoreTableName, seedMockProviderStore } from '../src/index';
import {
  createFakeMockProviderTable,
  fakeTableName,
  type FakeMockProviderTable,
} from './support/fake-mock-provider-table';

let fakeTable: FakeMockProviderTable;

beforeEach(() => {
  fakeTable = createFakeMockProviderTable();
});

afterEach(() => {
  fakeTable.restore();
});

function seed() {
  return seedMockProviderStore({
    documentClient: fakeTable.documentClient,
    tableName: fakeTableName,
  });
}

function storeSnapshot(): string {
  return JSON.stringify(
    [...fakeTable.items.entries()].sort(([first], [second]) => first.localeCompare(second)),
  );
}

describe('seedMockProviderStore', () => {
  it('writes every section of every synthetic record each provider owns', async () => {
    await seed();
    const expectedItems = providerRecordsFromSynthetic(syntheticRecords).reduce(
      (itemCount, [, storedRecord]) => itemCount + Object.keys(storedRecord.sections).length,
      0,
    );
    expect(fakeTable.items.size).toBe(expectedItems);
  });

  it('covers both tenants and CU11 records each', async () => {
    await seed();
    for (const tenantId of mockProviderBehaviour.seedTenants) {
      const recordIdentifiers = new Set(
        [...fakeTable.items.values()]
          .map((tableItem) => String(tableItem['partitionKey']).split('#'))
          .filter(([, itemTenant]) => itemTenant === tenantId)
          .map(([, , recordId]) => recordId),
      );
      expect(recordIdentifiers.size).toBe(mockProviderBehaviour.seedRecordsPerTenant);
    }
  });

  it('gives the same store when run twice', async () => {
    await seed();
    const afterOneRun = storeSnapshot();
    await seed();
    expect(storeSnapshot()).toBe(afterOneRun);
  });

  it('gives the same store when interrupted part way and run again', async () => {
    await seed();
    const cleanStore = storeSnapshot();
    fakeTable.items.clear();
    fakeTable.failPutsAfter(17);
    await expect(seed()).rejects.toThrow('planted put failure');
    expect(fakeTable.items.size).toBe(17);
    await seed();
    expect(storeSnapshot()).toBe(cleanStore);
  });

  it('restores seeded values a test run changed, and deletes nothing', async () => {
    await seed();
    const cleanStore = storeSnapshot();
    const [firstKey, firstItem] = [...fakeTable.items.entries()][0] ?? [];
    if (firstKey === undefined || firstItem === undefined) {
      throw new Error('seed wrote nothing');
    }
    fakeTable.items.set(firstKey, { ...firstItem, updatedAt: '2026-10-30T00:00:00.000Z' });
    await seed();
    expect(storeSnapshot()).toBe(cleanStore);
    expect(fakeTable.calls.some((call) => call.command === 'Delete')).toBe(false);
  });

  it('names the table for the stage', () => {
    expect(mockProviderStoreTableName('dev')).toBe('demo-dev-mock-provider-store');
  });
});
