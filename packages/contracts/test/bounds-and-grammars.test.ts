import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CorrelationIdentifierSchema,
  IdempotencyKeySchema,
  OperationIdentifierSchema,
  ProviderVersionSchema,
  RecordIdentifierSchema,
  TenantIdentifierSchema,
  TimestampSchema,
  UlidSchema,
  contractBounds,
  contractVersions,
  isWithinByteBound,
  measureUtf8ByteLength,
} from '../src/index';
import { syntheticUlid, syntheticUuidVersion4 } from './support/synthetic-values';

describe('contractBounds', () => {
  it('holds exactly the Spec 00 §3.3 maximums', () => {
    expect(contractBounds).toEqual({
      commandRequestBodyMaximumBytes: 65_536,
      providerResponseBodyMaximumBytes: 262_144,
      recordIdentifierMaximumCharacters: 128,
      tenantIdentifierMaximumCharacters: 64,
      scopeClaimMaximumCharacters: 1_024,
      operationIdentifierCharacters: 26,
      correlationIdentifierMaximumCharacters: 64,
      idempotencyKeyCharacters: 36,
      ifNoneMatchMaximumCharacters: 1_024,
      providerVersionMaximumCharacters: 128,
      providerRetryAfterMaximumSeconds: 3_600,
      providerCacheMaxAgeMaximumSeconds: 86_400,
      queueMessageBodyMaximumBytes: 256,
    });
  });
});

describe('contractVersions', () => {
  it('holds exactly the Spec 00 §3.1 versions', () => {
    expect(contractVersions).toEqual({
      publicApiPathPrefix: '/v1',
      providerContractVersion: '1',
      queueMessageVersion: 1,
      journalSchemaVersion: 1,
    });
  });
});

describe('measureUtf8ByteLength', () => {
  it('counts encoded bytes rather than characters', () => {
    expect(measureUtf8ByteLength('abc')).toBe(3);
    expect(measureUtf8ByteLength('é')).toBe(2);
    expect(measureUtf8ByteLength('😀')).toBe(4);
  });

  it('accepts a body at its bound and refuses one byte over', () => {
    expect(isWithinByteBound('a'.repeat(256), 256)).toBe(true);
    expect(isWithinByteBound('a'.repeat(257), 256)).toBe(false);
    expect(isWithinByteBound('é'.repeat(128), 256)).toBe(true);
    expect(isWithinByteBound('é'.repeat(128) + 'a', 256)).toBe(false);
  });
});

interface GrammarCase {
  grammarName: string;
  schema: z.ZodType;
  accepted: string[];
  refused: string[];
}

const grammarCases: GrammarCase[] = [
  {
    grammarName: 'recordId',
    schema: RecordIdentifierSchema,
    accepted: ['a', 'record_1-A', 'x'.repeat(128)],
    refused: ['', 'x'.repeat(129), 'record.1', 'record 1', 'récord', 'record/1', ' record'],
  },
  {
    grammarName: 'tenantId',
    schema: TenantIdentifierSchema,
    accepted: ['tenant-1', 'T_2', 'x'.repeat(64)],
    refused: ['', 'x'.repeat(65), 'tenant.1', 'tenant 1', 'tenant#1'],
  },
  {
    grammarName: 'operationId',
    schema: OperationIdentifierSchema,
    accepted: [syntheticUlid],
    refused: [
      '',
      syntheticUlid.slice(0, 25),
      syntheticUlid + '0',
      syntheticUlid.toLowerCase(),
      '01JAZ5Q8Z1X2Y3W4V5T6S7R8QU',
      '81JAZ5Q8Z1X2Y3W4V5T6S7R8Q9',
    ],
  },
  {
    grammarName: 'ULID',
    schema: UlidSchema,
    accepted: [syntheticUlid],
    refused: [
      '01JAZ5Q8Z1X2Y3W4V5T6S7R8QL',
      '01JAZ5Q8Z1X2Y3W4V5T6S7R8QI',
      '01JAZ5Q8Z1X2Y3W4V5T6S7R8QO',
    ],
  },
  {
    grammarName: 'X-Correlation-Id',
    schema: CorrelationIdentifierSchema,
    accepted: [syntheticUlid, syntheticUuidVersion4, syntheticUuidVersion4.toUpperCase()],
    refused: [
      '',
      'not-an-identifier',
      syntheticUuidVersion4.replaceAll('-', ''),
      `{${syntheticUuidVersion4}}`,
      'x'.repeat(65),
      '01JAZ5Q8Z1X2Y3W4V5T6S7R8QL',
      `${syntheticUlid},${syntheticUlid}`,
    ],
  },
  {
    grammarName: 'Idempotency-Key',
    schema: IdempotencyKeySchema,
    accepted: [syntheticUuidVersion4, syntheticUuidVersion4.toUpperCase()],
    refused: [
      '',
      '3f2b8c1e-4d5a-1b6c-8d7e-9f0a1b2c3d4e',
      '3f2b8c1e-4d5a-4b6c-cd7e-9f0a1b2c3d4e',
      syntheticUuidVersion4.slice(0, 35),
      `${syntheticUuidVersion4}0`,
      syntheticUlid,
    ],
  },
  {
    grammarName: 'provider version',
    schema: ProviderVersionSchema,
    accepted: ['abc.DEF_1-2', '0123456789abcdef', 'v'.repeat(128)],
    refused: ['', 'v'.repeat(129), '"abc"', 'a b', 'a/b', 'W/abc'],
  },
  {
    grammarName: 'timestamp',
    schema: TimestampSchema,
    accepted: ['2026-10-18T09:30:00.000Z', '2028-02-29T23:59:59.999Z'],
    refused: [
      '2026-10-18T09:30:00Z',
      '2026-10-18T09:30:00.000+01:00',
      '2026-02-30T00:00:00.000Z',
      '2027-02-29T00:00:00.000Z',
      '2026-10-18 09:30:00.000Z',
      '2026-10-18T09:30:00.0000Z',
      '2026-10-18T24:00:00.000Z',
      '2026-10-18t09:30:00.000z',
    ],
  },
];

describe.each(grammarCases)('the $grammarName grammar', ({ schema, accepted, refused }) => {
  it.each(accepted)('accepts %s', (candidate) => {
    expect(schema.safeParse(candidate).success).toBe(true);
  });

  it.each(refused)('refuses the near miss %s', (candidate) => {
    expect(schema.safeParse(candidate).success).toBe(false);
  });

  it('refuses a value that is not a string', () => {
    expect(schema.safeParse(42).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});
