import {
  CommandRequestSchema,
  RecordIdentifierSchema,
  SectionsPartialSchema,
  TenantIdentifierSchema,
  TimestampSchema,
  UlidSchema,
  mockProviderBehaviour,
  mockProviderFaults,
} from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import {
  findSyntheticRecord,
  syntheticCommandFor,
  syntheticRecords,
  syntheticRecordsForTenant,
  syntheticTenants,
} from '../src/index';

describe('the synthetic record set', () => {
  it('covers both seed tenants', () => {
    expect(syntheticTenants).toEqual(mockProviderBehaviour.seedTenants);
  });

  it.each(mockProviderBehaviour.seedTenants)(
    'holds exactly the CU11 number of records for %s',
    (tenantId) => {
      expect(syntheticRecordsForTenant(tenantId)).toHaveLength(
        mockProviderBehaviour.seedRecordsPerTenant,
      );
    },
  );

  it.each(mockProviderBehaviour.seedTenants)(
    'holds one record per fault prefix for %s',
    (tenantId) => {
      for (const fault of mockProviderFaults) {
        const faultRecords = syntheticRecordsForTenant(tenantId).filter((syntheticRecord) =>
          syntheticRecord.recordId.startsWith(fault.prefix),
        );
        expect(faultRecords).toHaveLength(1);
      }
    },
  );

  it('gives every record valid identifiers, timestamps and sections', () => {
    for (const syntheticRecord of syntheticRecords) {
      expect(TenantIdentifierSchema.safeParse(syntheticRecord.tenantId).success).toBe(true);
      expect(RecordIdentifierSchema.safeParse(syntheticRecord.recordId).success).toBe(true);
      expect(TimestampSchema.safeParse(syntheticRecord.updatedAt).success).toBe(true);
      expect(SectionsPartialSchema.safeParse(syntheticRecord.sections).success).toBe(true);
    }
  });

  it('never repeats a record identifier within a tenant', () => {
    for (const tenantId of syntheticTenants) {
      const recordIdentifiers = syntheticRecordsForTenant(tenantId).map(
        (syntheticRecord) => syntheticRecord.recordId,
      );
      expect(new Set(recordIdentifiers).size).toBe(recordIdentifiers.length);
    }
  });

  // Tenant isolation tests need the same record identifier to mean different
  // records in each tenant.
  it('gives each tenant different content under the same record identifier', () => {
    const firstTenantRecord = findSyntheticRecord('tenant-1', 'record-0001');
    const secondTenantRecord = findSyntheticRecord('tenant-2', 'record-0001');
    expect(firstTenantRecord).toBeDefined();
    expect(secondTenantRecord).toBeDefined();
    expect(firstTenantRecord?.sections).not.toEqual(secondTenantRecord?.sections);
  });

  it('includes a record one provider holds nothing of, and one holding a single section', () => {
    expect(findSyntheticRecord('tenant-1', 'record-0006')?.sections.preferences).toBeUndefined();
    expect(Object.keys(findSyntheticRecord('tenant-1', 'record-0007')?.sections ?? {})).toEqual([
      'summary',
    ]);
  });

  it('finds nothing for an unknown record or tenant', () => {
    expect(findSyntheticRecord('tenant-1', 'record-9999')).toBeUndefined();
    expect(findSyntheticRecord('tenant-3', 'record-0001')).toBeUndefined();
  });
});

// Datum 0.17 item 17: only synthetic values. The synthetic set is defined here
// as a closed set of shapes, so a real looking value cannot slip into a fixture.
const syntheticStringShapes: readonly RegExp[] = [
  /^Synthetic [A-Za-z0-9 -]+$/,
  /^tenant-[12]$/,
  /^task-\d{2}$/,
  /^2026-10-\d{2}T\d{2}:\d{2}:00\.000Z$/,
  /^01JB\d{22}$/,
  /^(active|paused|closed)$/,
  /^(morning|afternoon|evening)$/,
  /^(en-GB|cy-GB|ga-IE)$/,
];

function everyLeafValue(candidate: unknown): unknown[] {
  if (Array.isArray(candidate)) {
    return candidate.flatMap(everyLeafValue);
  }
  if (typeof candidate === 'object' && candidate !== null) {
    return Object.values(candidate).flatMap(everyLeafValue);
  }
  return [candidate];
}

describe('fixture values', () => {
  it('all lie inside the synthetic set', () => {
    const recordIdentifierShape = new RegExp(
      `^(record-\\d{4}|(${mockProviderFaults.map((fault) => fault.prefix).join('|')})\\d{4})$`,
    );
    for (const syntheticRecord of syntheticRecords) {
      expect(syntheticRecord.recordId).toMatch(recordIdentifierShape);
      for (const leafValue of everyLeafValue({ ...syntheticRecord, recordId: undefined })) {
        if (typeof leafValue === 'string') {
          expect(
            syntheticStringShapes.some((syntheticShape) => syntheticShape.test(leafValue)),
            `outside the synthetic set: ${leafValue}`,
          ).toBe(true);
        } else {
          expect(['boolean', 'undefined']).toContain(typeof leafValue);
        }
      }
    }
  });

  it('use ULIDs that pass the contract grammar', () => {
    for (const syntheticRecord of syntheticRecords) {
      for (const noteEntry of syntheticRecord.sections.notes?.entries ?? []) {
        expect(UlidSchema.safeParse(noteEntry.noteId).success).toBe(true);
      }
    }
  });
});

describe('syntheticCommandFor', () => {
  it.each(['summary', 'tasks', 'schedule', 'notes', 'preferences'] as const)(
    'builds a valid command for the %s section',
    (sectionName) => {
      const command = syntheticCommandFor(sectionName, 'record-0001', '0123456789abcdef');
      expect(CommandRequestSchema.safeParse(command).success).toBe(true);
      expect(command.section).toBe(sectionName);
    },
  );
});
