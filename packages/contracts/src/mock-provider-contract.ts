import { providerIdentifiers, type ProviderIdentifier } from './routing';

// Spec 00 §4.3: the behaviour every provider double shares. Both the msw
// doubles (CE2) and the local mock provider servers (CE4) are generated from
// these tables, so the two cannot disagree.

// CU9 and CU11, adopted as written by the author on 18 October 2026.
export const mockProviderBehaviour = {
  // Longer than Spec 02's per provider timeout (RU1, 1,500 ms), so a slow
  // provider times the read adapter out.
  slowResponseDelayMilliseconds: 3_000,
  cacheMaxAgeSeconds: 60,
  idempotentReplayWindowSeconds: 86_400,
  versionPrefixHexadecimalCharacters: 16,
  throttleRetryAfterSeconds: 2,
  flakyFailedAttemptsPerKey: 2,
  seedRecordsPerTenant: 20,
  seedTenants: ['tenant-1', 'tenant-2'],
} as const;

export type MockProviderFaultEffect =
  | 'delay-response'
  | 'service-unavailable'
  | 'unavailable-for-first-attempts'
  | 'throttle-once-per-key'
  | 'server-error'
  | 'precondition-failed'
  | 'omit-contract-header'
  | 'oversize-body'
  | 'max-age-beyond-bound';

export interface MockProviderFault {
  readonly prefix: string;
  readonly effect: MockProviderFaultEffect;
  readonly appliesTo: 'reads' | 'writes' | 'reads-and-writes';
  readonly providers: readonly ProviderIdentifier[];
}

const everyProvider = providerIdentifiers;

// Selected by record identifier prefix, so every stream's tests are
// deterministic and share no toggles.
export const mockProviderFaults: readonly MockProviderFault[] = [
  {
    prefix: 'slow-a-',
    effect: 'delay-response',
    appliesTo: 'reads-and-writes',
    providers: ['provider-a'],
  },
  {
    prefix: 'slow-b-',
    effect: 'delay-response',
    appliesTo: 'reads-and-writes',
    providers: ['provider-b'],
  },
  {
    prefix: 'slow-c-',
    effect: 'delay-response',
    appliesTo: 'reads-and-writes',
    providers: ['provider-c'],
  },
  {
    prefix: 'down-a-',
    effect: 'service-unavailable',
    appliesTo: 'reads-and-writes',
    providers: ['provider-a'],
  },
  {
    prefix: 'down-b-',
    effect: 'service-unavailable',
    appliesTo: 'reads-and-writes',
    providers: ['provider-b'],
  },
  {
    prefix: 'down-c-',
    effect: 'service-unavailable',
    appliesTo: 'reads-and-writes',
    providers: ['provider-c'],
  },
  // Counted per idempotency key, which only writes carry.
  {
    prefix: 'flaky-',
    effect: 'unavailable-for-first-attempts',
    appliesTo: 'writes',
    providers: everyProvider,
  },
  {
    prefix: 'throttle-',
    effect: 'throttle-once-per-key',
    appliesTo: 'writes',
    providers: everyProvider,
  },
  { prefix: 'poison-', effect: 'server-error', appliesTo: 'writes', providers: everyProvider },
  {
    prefix: 'conflict-',
    effect: 'precondition-failed',
    appliesTo: 'writes',
    providers: everyProvider,
  },
  {
    prefix: 'oldversion-',
    effect: 'omit-contract-header',
    appliesTo: 'reads',
    providers: everyProvider,
  },
  { prefix: 'oversize-', effect: 'oversize-body', appliesTo: 'reads', providers: everyProvider },
  {
    prefix: 'badheader-',
    effect: 'max-age-beyond-bound',
    appliesTo: 'reads',
    providers: everyProvider,
  },
];

export function faultForRecord(recordIdentifier: string): MockProviderFault | undefined {
  return mockProviderFaults.find((fault) => recordIdentifier.startsWith(fault.prefix));
}
