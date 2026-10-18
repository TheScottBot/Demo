import {
  providerIdentifiers,
  sectionsOwnedByProvider,
  type ProviderIdentifier,
  type SectionsBySectionName,
} from '@demo/contracts';
import { syntheticRecords, type SyntheticRecord } from './synthetic-records';

// What a mock provider keeps. The interface is asynchronous because CE4's
// local servers may keep it somewhere other than memory; the msw doubles keep
// it in memory.

export interface ProviderRecordKey {
  readonly providerId: ProviderIdentifier;
  readonly tenantId: string;
  readonly recordId: string;
}

export interface StoredProviderRecord {
  readonly sections: Partial<SectionsBySectionName>;
  readonly updatedAt: string;
}

export interface IdempotencyEntryKey {
  readonly providerId: ProviderIdentifier;
  readonly tenantId: string;
  readonly idempotencyKey: string;
}

export interface StoredProviderResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string | undefined;
}

export interface StoredIdempotencyEntry {
  // The request a key was first used for; a different request under the same
  // key is refused (CQ7.4).
  readonly requestFingerprint: string;
  readonly firstSeenAt: string;
  // Counted for flaky-, which fails the first attempts per key.
  readonly attemptsSeen: number;
  // Set once throttle- has refused this key.
  readonly throttled: boolean;
  readonly completedResponse: StoredProviderResponse | undefined;
}

export interface ProviderSimulationStore {
  readRecord(recordKey: ProviderRecordKey): Promise<StoredProviderRecord | undefined>;
  writeRecord(recordKey: ProviderRecordKey, storedRecord: StoredProviderRecord): Promise<void>;
  readIdempotencyEntry(entryKey: IdempotencyEntryKey): Promise<StoredIdempotencyEntry | undefined>;
  writeIdempotencyEntry(
    entryKey: IdempotencyEntryKey,
    entry: StoredIdempotencyEntry,
  ): Promise<void>;
}

// Spec 00 §4.3 keys the store by provider, tenant and record joined by `#`.
function recordStorageKey(recordKey: ProviderRecordKey): string {
  return [recordKey.providerId, recordKey.tenantId, recordKey.recordId].join('#');
}

function entryStorageKey(entryKey: IdempotencyEntryKey): string {
  return [entryKey.providerId, entryKey.tenantId, entryKey.idempotencyKey].join('#');
}

// Each provider holds only the sections the routing table gives it, and
// nothing at all of a record where it owns none of the sections present.
export function providerRecordsFromSynthetic(
  sourceRecords: readonly SyntheticRecord[],
): [ProviderRecordKey, StoredProviderRecord][] {
  const providerRecords: [ProviderRecordKey, StoredProviderRecord][] = [];
  for (const sourceRecord of sourceRecords) {
    for (const providerId of providerIdentifiers) {
      const ownedSections: Partial<SectionsBySectionName> = {};
      for (const sectionName of sectionsOwnedByProvider(providerId)) {
        const sectionValue = sourceRecord.sections[sectionName];
        if (sectionValue !== undefined) {
          Object.assign(ownedSections, { [sectionName]: structuredClone(sectionValue) });
        }
      }
      if (Object.keys(ownedSections).length > 0) {
        providerRecords.push([
          { providerId, tenantId: sourceRecord.tenantId, recordId: sourceRecord.recordId },
          { sections: ownedSections, updatedAt: sourceRecord.updatedAt },
        ]);
      }
    }
  }
  return providerRecords;
}

export interface InMemoryProviderStore extends ProviderSimulationStore {
  // Back to the seed, so each test starts from the same state.
  reset(): void;
}

export function createInMemoryProviderStore(
  seedRecords: readonly SyntheticRecord[] = syntheticRecords,
): InMemoryProviderStore {
  const records = new Map<string, StoredProviderRecord>();
  const idempotencyEntries = new Map<string, StoredIdempotencyEntry>();

  function reseed(): void {
    records.clear();
    idempotencyEntries.clear();
    for (const [recordKey, storedRecord] of providerRecordsFromSynthetic(seedRecords)) {
      records.set(recordStorageKey(recordKey), storedRecord);
    }
  }
  reseed();

  // Copies in and out, so a caller mutating what it read cannot change the
  // store behind the simulation's back.
  return {
    readRecord: (recordKey) => {
      const storedRecord = records.get(recordStorageKey(recordKey));
      return Promise.resolve(
        storedRecord === undefined ? undefined : structuredClone(storedRecord),
      );
    },
    writeRecord: (recordKey, storedRecord) => {
      records.set(recordStorageKey(recordKey), structuredClone(storedRecord));
      return Promise.resolve();
    },
    readIdempotencyEntry: (entryKey) => {
      const entry = idempotencyEntries.get(entryStorageKey(entryKey));
      return Promise.resolve(entry === undefined ? undefined : structuredClone(entry));
    },
    writeIdempotencyEntry: (entryKey, entry) => {
      idempotencyEntries.set(entryStorageKey(entryKey), structuredClone(entry));
      return Promise.resolve();
    },
    reset: reseed,
  };
}
