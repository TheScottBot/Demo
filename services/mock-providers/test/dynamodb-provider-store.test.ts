import type { StoredProviderRecord } from '@demo/test-doubles/provider-simulation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDynamoDbProviderStore } from '../src/index';
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

function store() {
  return createDynamoDbProviderStore({
    documentClient: fakeTable.documentClient,
    tableName: fakeTableName,
  });
}

const recordKey = {
  providerId: 'provider-a',
  tenantId: 'tenant-1',
  recordId: 'record-0001',
} as const;

const storedRecord: StoredProviderRecord = {
  sections: {
    summary: { title: 'Synthetic summary', status: 'active' },
    tasks: { entries: [{ taskId: 'task-01', label: 'Synthetic task', done: false }] },
  },
  updatedAt: '2026-10-18T09:30:00.000Z',
};

describe('the DynamoDB provider store', () => {
  // Spec 00 §4.3: partitionKey is providerId, tenantId and recordId joined by
  // #, and sortKey is the section name.
  it('keeps one tableItem per section, keyed as Spec 00 §4.3 states', async () => {
    await store().writeRecord(recordKey, storedRecord);
    expect(
      [...fakeTable.items.values()].map((tableItem) => [
        tableItem['partitionKey'],
        tableItem['sortKey'],
      ]),
    ).toEqual([
      ['provider-a#tenant-1#record-0001', 'summary'],
      ['provider-a#tenant-1#record-0001', 'tasks'],
    ]);
  });

  it('reads back what it wrote', async () => {
    await store().writeRecord(recordKey, storedRecord);
    expect(await store().readRecord(recordKey)).toEqual(storedRecord);
  });

  it('reads nothing for a record it does not hold, or another tenant’s', async () => {
    await store().writeRecord(recordKey, storedRecord);
    expect(await store().readRecord({ ...recordKey, recordId: 'record-9999' })).toBeUndefined();
    expect(await store().readRecord({ ...recordKey, tenantId: 'tenant-2' })).toBeUndefined();
  });

  it('reads with strong consistency, so a write is seen by the next read', async () => {
    await store().readRecord(recordKey);
    expect(fakeTable.calls.find((call) => call.command === 'Query')?.input['ConsistentRead']).toBe(
      true,
    );
  });

  it('keeps idempotency entries apart from records, and expires them after the CU11 window', async () => {
    const entryKey = {
      providerId: 'provider-a',
      tenantId: 'tenant-1',
      idempotencyKey: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
    } as const;
    const entry = {
      requestFingerprint: 'PUT /records/record-0001/sections/summary\n{}',
      firstSeenAt: '2026-10-18T09:30:00.000Z',
      attemptsSeen: 1,
      throttled: false,
      completedResponse: undefined,
    };
    await store().writeIdempotencyEntry(entryKey, entry);
    expect(await store().readIdempotencyEntry(entryKey)).toEqual(entry);
    const [storedEntry] = [...fakeTable.items.values()];
    expect(storedEntry?.['partitionKey']).toBe(
      'idempotency#provider-a#tenant-1#3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
    );
    // A time to live in seconds (§2.3): 24 hours after it was first seen.
    expect(storedEntry?.['expiresAt']).toBe(Date.parse('2026-10-19T09:30:00.000Z') / 1_000);
  });

  it('never deletes', async () => {
    await store().writeRecord(recordKey, storedRecord);
    await store().writeRecord(recordKey, {
      ...storedRecord,
      sections: { summary: { title: 'Synthetic summary', status: 'active' } },
    });
    expect(fakeTable.calls.some((call) => call.command === 'Delete')).toBe(false);
  });
});
