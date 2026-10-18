// Spec 02 §3.4, §4.1 and RE1: merging the provider results into one record.
import { fc, test } from '@fast-check/vitest';
import {
  DemoRecordSchema,
  ProviderOutcomeStatusSchema,
  SourceProvenanceSchema,
  providerIdentifiers,
  type ProviderIdentifier,
  type ProviderOutcomeStatus,
} from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import { mergeProviderOutcomes, type ProviderCallOutcome } from '../src/record-merge';

const mergedAt = new Date('2026-10-18T12:00:00.000Z');

const okOutcomes: Record<ProviderIdentifier, ProviderCallOutcome> = {
  'provider-a': {
    providerId: 'provider-a',
    status: 'ok',
    version: 'a-version',
    updatedAt: '2026-10-18T09:00:00.000Z',
    ttlSeconds: 60,
    latencyMilliseconds: 40,
    sections: {
      summary: { title: 'Synthetic summary', status: 'active' },
      tasks: { entries: [] },
    },
  },
  'provider-b': {
    providerId: 'provider-b',
    status: 'ok',
    version: 'b-version',
    updatedAt: '2026-10-18T11:30:00.000Z',
    ttlSeconds: 120,
    latencyMilliseconds: 55,
    sections: { schedule: { entries: [] }, notes: { entries: [] } },
  },
  'provider-c': {
    providerId: 'provider-c',
    status: 'ok',
    version: 'c-version',
    updatedAt: '2026-10-18T10:15:00.000Z',
    ttlSeconds: 60,
    latencyMilliseconds: 30,
    sections: { preferences: { contactWindow: 'morning', language: 'en-GB' } },
  },
};

function outcomeWithStatus(
  providerId: ProviderIdentifier,
  status: ProviderOutcomeStatus,
): ProviderCallOutcome {
  const okOutcome = okOutcomes[providerId];
  switch (status) {
    case 'ok':
      return okOutcome;
    case 'not-modified':
      return {
        providerId,
        status,
        version: okOutcome.version,
        ttlSeconds: 60,
        latencyMilliseconds: 20,
      };
    case 'error':
      return {
        providerId,
        status,
        errorReason: 'http-status',
        ttlSeconds: 0,
        latencyMilliseconds: 25,
      };
    case 'timeout':
    case 'not-found':
      return { providerId, status, ttlSeconds: 0, latencyMilliseconds: 1_500 };
  }
}

describe('mergeProviderOutcomes', () => {
  it('merges every owned section, naming its source, with the latest updatedAt', () => {
    const merged = mergeProviderOutcomes(Object.values(okOutcomes), 'record-0001', mergedAt);
    expect(merged.record).toEqual({
      recordId: 'record-0001',
      sections: {
        summary: { title: 'Synthetic summary', status: 'active' },
        tasks: { entries: [] },
        schedule: { entries: [] },
        notes: { entries: [] },
        preferences: { contactWindow: 'morning', language: 'en-GB' },
      },
      sectionSources: {
        summary: 'provider-a',
        tasks: 'provider-a',
        schedule: 'provider-b',
        notes: 'provider-b',
        preferences: 'provider-c',
      },
      updatedAt: '2026-10-18T11:30:00.000Z',
    });
    expect(DemoRecordSchema.safeParse(merged.record).success).toBe(true);
    expect(merged.ignoredSectionCounts).toEqual({});
  });

  it('drops and counts a section a provider does not own (Spec 00 §4.2)', () => {
    const overreaching: ProviderCallOutcome = {
      ...okOutcomes['provider-a'],
      sections: {
        ...okOutcomes['provider-a'].sections,
        schedule: { entries: [] },
        preferences: { contactWindow: 'evening', language: 'cy-GB' },
      },
    };
    const merged = mergeProviderOutcomes(
      [overreaching, okOutcomes['provider-b'], outcomeWithStatus('provider-c', 'timeout')],
      'record-0001',
      mergedAt,
    );
    expect(merged.record?.sections.preferences).toBeUndefined();
    expect(merged.record?.sectionSources.schedule).toBe('provider-b');
    expect(merged.ignoredSectionCounts).toEqual({ 'provider-a': 2 });
  });

  it('takes sections from ok providers only', () => {
    const notModifiedWithSections: ProviderCallOutcome = {
      ...outcomeWithStatus('provider-c', 'not-modified'),
      sections: okOutcomes['provider-c'].sections,
    };
    const merged = mergeProviderOutcomes(
      [okOutcomes['provider-a'], okOutcomes['provider-b'], notModifiedWithSections],
      'record-0001',
      mergedAt,
    );
    expect(merged.record?.sections.preferences).toBeUndefined();
  });

  it('returns one source per provider, in routing table order, including every failure', () => {
    const merged = mergeProviderOutcomes(
      [
        outcomeWithStatus('provider-c', 'error'),
        outcomeWithStatus('provider-a', 'timeout'),
        okOutcomes['provider-b'],
      ],
      'record-0001',
      mergedAt,
    );
    expect(merged.sources).toEqual([
      {
        providerId: 'provider-a',
        status: 'timeout',
        fetchedAt: mergedAt.toISOString(),
        ttlSeconds: 0,
        latencyMilliseconds: 1_500,
      },
      {
        providerId: 'provider-b',
        status: 'ok',
        version: 'b-version',
        fetchedAt: mergedAt.toISOString(),
        ttlSeconds: 120,
        latencyMilliseconds: 55,
      },
      {
        providerId: 'provider-c',
        status: 'error',
        errorReason: 'http-status',
        fetchedAt: mergedAt.toISOString(),
        ttlSeconds: 0,
        latencyMilliseconds: 25,
      },
    ]);
    for (const source of merged.sources) {
      expect(SourceProvenanceSchema.safeParse(source).success).toBe(true);
    }
  });

  it('collects the versions of providers that returned one', () => {
    const merged = mergeProviderOutcomes(
      [
        okOutcomes['provider-a'],
        outcomeWithStatus('provider-b', 'not-modified'),
        outcomeWithStatus('provider-c', 'not-found'),
      ],
      'record-0001',
      mergedAt,
    );
    expect(merged.versionsByProvider).toEqual({
      'provider-a': 'a-version',
      'provider-b': 'b-version',
    });
  });

  it('builds no record when no provider is ok', () => {
    const merged = mergeProviderOutcomes(
      providerIdentifiers.map((providerId) => outcomeWithStatus(providerId, 'not-modified')),
      'record-0001',
      mergedAt,
    );
    expect(merged.record).toBeUndefined();
  });

  it('refuses outcomes that do not name every provider exactly once', () => {
    expect(() =>
      mergeProviderOutcomes(
        [okOutcomes['provider-a'], okOutcomes['provider-b']],
        'record-0001',
        mergedAt,
      ),
    ).toThrow();
    expect(() =>
      mergeProviderOutcomes(
        [okOutcomes['provider-a'], okOutcomes['provider-a'], okOutcomes['provider-c']],
        'record-0001',
        mergedAt,
      ),
    ).toThrow();
  });
});

// Spec 02 §3.4, transcribed: every combination of the five statuses across
// the three providers.
describe('partial and total failure, for every combination of statuses', () => {
  const statuses = ProviderOutcomeStatusSchema.options;
  const combinations = statuses.flatMap((statusA) =>
    statuses.flatMap((statusB) => statuses.map((statusC) => [statusA, statusB, statusC] as const)),
  );

  it('covers all 125 combinations', () => {
    expect(combinations).toHaveLength(125);
  });

  it.each(combinations)(
    'provider-a %s, provider-b %s, provider-c %s',
    (statusA, statusB, statusC) => {
      const providerStatuses = [statusA, statusB, statusC];
      const merged = mergeProviderOutcomes(
        providerIdentifiers.map((providerId, providerIndex) =>
          outcomeWithStatus(providerId, providerStatuses[providerIndex] ?? 'ok'),
        ),
        'record-0001',
        mergedAt,
      );
      const anyFailed = providerStatuses.some(
        (status) => status === 'timeout' || status === 'error',
      );
      const anyAnswered = providerStatuses.some(
        (status) => status === 'ok' || status === 'not-modified',
      );
      expect(merged.partial).toBe(anyFailed && anyAnswered);
      expect(merged.allNotFound).toBe(providerStatuses.every((status) => status === 'not-found'));
      expect(merged.allSourcesUnavailable).toBe(!anyAnswered && anyFailed);
      expect(merged.record === undefined).toBe(!providerStatuses.includes('ok'));
    },
  );
});

describe('the merge', () => {
  const statusArbitrary = fc.constantFrom(...ProviderOutcomeStatusSchema.options);
  test.prop([statusArbitrary, statusArbitrary, statusArbitrary])(
    'always produces sources and a record the contract accepts',
    (statusA, statusB, statusC) => {
      const merged = mergeProviderOutcomes(
        [
          outcomeWithStatus('provider-c', statusC),
          outcomeWithStatus('provider-a', statusA),
          outcomeWithStatus('provider-b', statusB),
        ],
        'record-0001',
        mergedAt,
      );
      for (const source of merged.sources) {
        expect(SourceProvenanceSchema.safeParse(source).success).toBe(true);
      }
      if (merged.record !== undefined) {
        expect(DemoRecordSchema.safeParse(merged.record).success).toBe(true);
      }
    },
  );
});
