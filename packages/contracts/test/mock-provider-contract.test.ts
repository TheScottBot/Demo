import { describe, expect, it } from 'vitest';
import { faultForRecord, mockProviderBehaviour, mockProviderFaults } from '../src/index';

describe('mock provider behaviour values', () => {
  it('hold the CU9 and CU11 values the author adopted on 18 October 2026', () => {
    expect(mockProviderBehaviour).toEqual({
      slowResponseDelayMilliseconds: 3_000,
      cacheMaxAgeSeconds: 60,
      idempotentReplayWindowSeconds: 86_400,
      versionPrefixHexadecimalCharacters: 16,
      throttleRetryAfterSeconds: 2,
      flakyFailedAttemptsPerKey: 2,
      seedRecordsPerTenant: 20,
      seedTenants: ['tenant-1', 'tenant-2'],
    });
  });
});

describe('mock provider faults', () => {
  it('hold every Spec 00 §4.3 prefix', () => {
    expect(mockProviderFaults.map((fault) => fault.prefix)).toEqual([
      'slow-a-',
      'slow-b-',
      'slow-c-',
      'down-a-',
      'down-b-',
      'down-c-',
      'flaky-',
      'throttle-',
      'poison-',
      'conflict-',
      'oldversion-',
      'oversize-',
      'badheader-',
    ]);
  });

  // A record identifier must select one fault at most, or two streams could
  // read the same record differently.
  it('never lets one prefix start another', () => {
    for (const fault of mockProviderFaults) {
      for (const otherFault of mockProviderFaults) {
        if (fault !== otherFault) {
          expect(otherFault.prefix.startsWith(fault.prefix)).toBe(false);
        }
      }
    }
  });

  it.each([
    [
      'slow-b-0001',
      {
        prefix: 'slow-b-',
        effect: 'delay-response',
        appliesTo: 'reads-and-writes',
        providers: ['provider-b'],
      },
    ],
    [
      'down-c-0001',
      {
        prefix: 'down-c-',
        effect: 'service-unavailable',
        appliesTo: 'reads-and-writes',
        providers: ['provider-c'],
      },
    ],
    [
      'flaky-0001',
      {
        prefix: 'flaky-',
        effect: 'unavailable-for-first-attempts',
        appliesTo: 'writes',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
    [
      'throttle-0001',
      {
        prefix: 'throttle-',
        effect: 'throttle-once-per-key',
        appliesTo: 'writes',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
    [
      'poison-0001',
      {
        prefix: 'poison-',
        effect: 'server-error',
        appliesTo: 'writes',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
    [
      'conflict-0001',
      {
        prefix: 'conflict-',
        effect: 'precondition-failed',
        appliesTo: 'writes',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
    [
      'oldversion-0001',
      {
        prefix: 'oldversion-',
        effect: 'omit-contract-header',
        appliesTo: 'reads',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
    [
      'oversize-0001',
      {
        prefix: 'oversize-',
        effect: 'oversize-body',
        appliesTo: 'reads',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
    [
      'badheader-0001',
      {
        prefix: 'badheader-',
        effect: 'max-age-beyond-bound',
        appliesTo: 'reads',
        providers: ['provider-a', 'provider-b', 'provider-c'],
      },
    ],
  ])('selects the fault for %s', (recordIdentifier, expectedFault) => {
    expect(faultForRecord(recordIdentifier)).toEqual(expectedFault);
  });

  it('selects no fault for an ordinary record', () => {
    expect(faultForRecord('record-0001')).toBeUndefined();
    expect(faultForRecord('xslow-a-0001')).toBeUndefined();
  });
});
