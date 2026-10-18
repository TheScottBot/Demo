import {
  SectionNameSchema,
  sectionRoutingTable,
  type DemoRecord,
  type ProviderErrorReason,
  type ProviderIdentifier,
  type ProviderOutcomeStatus,
  type SectionName,
  type SectionsBySectionName,
  type SourceProvenance,
} from '@demo/contracts';
import type { VersionsByProvider } from './aggregate-etag';

// Spec 02 §4.1: merge, a pure function of the provider results, the routing
// table and the current time (Spec 02 §2). Each section has exactly one
// owning provider (Spec 00 §4.2), so merging never chooses between values: it
// only keeps each provider to the sections it owns.
//
// Deciding the response (ETag, 304, the second call of §4.3) is the handler's
// (RE4); this module reports the facts that decision needs.

export interface ProviderCallOutcome {
  readonly providerId: ProviderIdentifier;
  readonly status: ProviderOutcomeStatus;
  readonly errorReason?: ProviderErrorReason;
  readonly version?: string;
  readonly updatedAt?: string;
  readonly ttlSeconds: number;
  readonly sections?: Partial<SectionsBySectionName>;
  readonly latencyMilliseconds: number;
}

export interface MergedRead {
  // Present when at least one provider answered ok.
  readonly record: DemoRecord | undefined;
  // One per provider, in routing table order, failures included.
  readonly sources: readonly SourceProvenance[];
  // The providers that returned a version, for the aggregate ETag (§4.2).
  readonly versionsByProvider: VersionsByProvider;
  // §3.4, as written.
  readonly partial: boolean;
  readonly allNotFound: boolean;
  readonly allSourcesUnavailable: boolean;
  // Sections an ok provider sent but does not own, dropped and counted as
  // ProviderSectionIgnored (§4.1).
  readonly ignoredSectionCounts: Partial<Record<ProviderIdentifier, number>>;
}

// A provider that timed out or failed, as opposed to one that answered,
// even with not-found. The one statement of the rule; the handler uses it too.
export function isFailedStatus(status: ProviderOutcomeStatus): boolean {
  return status === 'timeout' || status === 'error';
}

// The routing table's providers, in its order, each once.
const routingProviders: readonly ProviderIdentifier[] = [
  ...new Set(sectionRoutingTable.map((routingRow) => routingRow.owningProvider)),
];

function ownerOf(section: SectionName): ProviderIdentifier | undefined {
  return sectionRoutingTable.find((routingRow) => routingRow.section === section)?.owningProvider;
}

function provenanceFor(outcome: ProviderCallOutcome, fetchedAt: string): SourceProvenance {
  const versionAllowed = outcome.status === 'ok' || outcome.status === 'not-modified';
  return {
    providerId: outcome.providerId,
    status: outcome.status,
    ...(outcome.status === 'error' && outcome.errorReason !== undefined
      ? { errorReason: outcome.errorReason }
      : {}),
    ...(versionAllowed && outcome.version !== undefined ? { version: outcome.version } : {}),
    fetchedAt,
    ttlSeconds: outcome.ttlSeconds,
    latencyMilliseconds: outcome.latencyMilliseconds,
  };
}

export function mergeProviderOutcomes(
  outcomes: readonly ProviderCallOutcome[],
  recordId: string,
  mergedAt: Date,
): MergedRead {
  // One outcome per provider is the fan-out's promise; anything else is a bug
  // upstream, and merging it would silently drop or double a source.
  const outcomesByProvider = new Map(outcomes.map((outcome) => [outcome.providerId, outcome]));
  if (
    outcomes.length !== routingProviders.length ||
    !routingProviders.every((providerId) => outcomesByProvider.has(providerId))
  ) {
    throw new Error('merge-needs-one-outcome-per-provider');
  }
  const orderedOutcomes = routingProviders.map(
    (providerId) => outcomesByProvider.get(providerId) as ProviderCallOutcome,
  );
  // The time of the merged read: every source is reported as of the moment the
  // record it contributes to was assembled.
  const fetchedAt = mergedAt.toISOString();

  const sections: Partial<Record<SectionName, unknown>> = {};
  const sectionSources: Partial<Record<SectionName, ProviderIdentifier>> = {};
  const ignoredSectionCounts: Partial<Record<ProviderIdentifier, number>> = {};
  const okUpdatedAts: string[] = [];
  const versionsByProvider: VersionsByProvider = {};

  for (const outcome of orderedOutcomes) {
    if (
      (outcome.status === 'ok' || outcome.status === 'not-modified') &&
      outcome.version !== undefined
    ) {
      versionsByProvider[outcome.providerId] = outcome.version;
    }
    if (outcome.status !== 'ok') {
      continue;
    }
    if (outcome.updatedAt !== undefined) {
      okUpdatedAts.push(outcome.updatedAt);
    }
    for (const [sectionName, sectionValue] of Object.entries(outcome.sections ?? {})) {
      const parsedSection = SectionNameSchema.safeParse(sectionName);
      if (parsedSection.success && ownerOf(parsedSection.data) === outcome.providerId) {
        sections[parsedSection.data] = sectionValue;
        sectionSources[parsedSection.data] = outcome.providerId;
      } else {
        ignoredSectionCounts[outcome.providerId] =
          (ignoredSectionCounts[outcome.providerId] ?? 0) + 1;
      }
    }
  }

  const statuses = orderedOutcomes.map((outcome) => outcome.status);
  const anyFailed = statuses.some(isFailedStatus);
  const anyAnswered = statuses.some((status) => status === 'ok' || status === 'not-modified');
  const anyOk = statuses.includes('ok');

  return {
    record: anyOk
      ? {
          recordId,
          sections: sections as Partial<SectionsBySectionName>,
          sectionSources,
          // ISO 8601 UTC with milliseconds sorts as text in time order.
          updatedAt: okUpdatedAts.sort().at(-1) ?? fetchedAt,
        }
      : undefined,
    sources: orderedOutcomes.map((outcome) => provenanceFor(outcome, fetchedAt)),
    versionsByProvider,
    partial: anyFailed && anyAnswered,
    allNotFound: statuses.every((status) => status === 'not-found'),
    allSourcesUnavailable: !anyAnswered && anyFailed,
    ignoredSectionCounts,
  };
}
