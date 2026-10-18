import {
  DemoError,
  RecordIdentifierSchema,
  contractBounds,
  headerValues,
  httpHeaders,
  readAuthenticationContext,
  readRequestHeader,
  requireScope,
  scopeNames,
  withHttpProblemHandling,
  type DemoHttpHandler,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
  type ProviderIdentifier,
  type ReadAdapter,
  type ReadResponse,
} from '@demo/contracts';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  formatAggregateEntityTag,
  parseAggregateEntityTag,
  type VersionsByProvider,
} from './aggregate-etag';
import { fanOutToProviders } from './provider-fan-out';
import type { ReadCachePolicy } from './read-cache-policy';
import { readPathSettings } from './read-path-settings';
import { isFailedStatus, mergeProviderOutcomes, type ProviderCallOutcome } from './record-merge';

// Spec 02 §2: GET /v1/records/{recordId}. Steps 1 to 3 and 8 live here; the
// fan-out, merge and ETag are the pure modules it composes. Everything that
// touches the outside (adapters, logging, metrics, clocks) is injected, so the
// Lambda entry point (RE5) only wires them.

export interface ReadPathLog {
  bindTenant(tenantId: string): void;
  recordAbsentSubsystem(subsystem: 'read-cache', reason: string): void;
  recordConditionalRefetch(providerIds: readonly ProviderIdentifier[]): void;
}

// Spec 02 §8.
export interface ReadPathMetrics {
  // ProviderLatency and ProviderOutcome.
  recordProviderCall(outcome: ProviderCallOutcome): void;
  countSectionsIgnored(providerId: ProviderIdentifier, sectionCount: number): void;
  countReadPartial(): void;
  countReadNotModified(): void;
  countReadAllSourcesUnavailable(): void;
  countConditionalRefetch(providerId: ProviderIdentifier): void;
}

export interface ReadHandlerDependencies {
  // In routing table order.
  readonly readAdapters: readonly ReadAdapter[];
  readonly problemLog: ProblemHandlingLog;
  readonly problemMetrics: ProblemHandlingMetrics;
  readonly readLog: ReadPathLog;
  readonly readMetrics: ReadPathMetrics;
  readonly readCachePolicy: ReadCachePolicy;
  // RU1 and RU2 unless a caller narrows them.
  readonly timing?: {
    readonly providerTimeoutMilliseconds: number;
    readonly fanOutBudgetMilliseconds: number;
  };
  readonly now: () => Date;
  readonly monotonicNow: () => number;
}

function invalidRequest(path: string, reason: 'grammar' | 'too-long'): DemoError {
  return new DemoError('validation-failed', 'request-field-invalid', {
    invalidFields: [{ path, reason }],
  });
}

// §2 step 3, then step 4: bounds before anything reads the values.
function checkedRecordIdentifier(recordId: string | undefined): string {
  const parsedRecordId = RecordIdentifierSchema.safeParse(recordId);
  if (!parsedRecordId.success) {
    const tooLong =
      recordId !== undefined && recordId.length > contractBounds.recordIdentifierMaximumCharacters;
    throw invalidRequest('pathParameters.recordId', tooLong ? 'too-long' : 'grammar');
  }
  return parsedRecordId.data;
}

function clientVersionsFrom(ifNoneMatch: string | undefined): VersionsByProvider | undefined {
  if (ifNoneMatch === undefined) {
    return undefined;
  }
  const fieldPath = `headers.${httpHeaders.ifNoneMatch.wireName}`;
  if (ifNoneMatch.length > contractBounds.ifNoneMatchMaximumCharacters) {
    throw invalidRequest(fieldPath, 'too-long');
  }
  const parsedEntityTag = parseAggregateEntityTag(ifNoneMatch);
  if (parsedEntityTag.outcome === 'invalid') {
    throw invalidRequest(fieldPath, 'grammar');
  }
  return parsedEntityTag.versionsByProvider;
}

function sameProviders(firstSet: Iterable<string>, secondSet: Iterable<string>): boolean {
  const firstProviders = new Set(firstSet);
  const secondProviders = new Set(secondSet);
  return (
    firstProviders.size === secondProviders.size &&
    [...firstProviders].every((providerId) => secondProviders.has(providerId))
  );
}

function smallestTtl(outcomes: readonly ProviderCallOutcome[]): number {
  const answeredTtls = outcomes
    .filter((outcome) => outcome.status === 'ok' || outcome.status === 'not-modified')
    .map((outcome) => outcome.ttlSeconds);
  return answeredTtls.length === 0 ? 0 : Math.min(...answeredTtls);
}

export function createReadHandler(dependencies: ReadHandlerDependencies): DemoHttpHandler {
  const timing = dependencies.timing ?? readPathSettings;
  // Spec 00 §5.1: an absent optional subsystem is a fact in the log at cold start.
  dependencies.readLog.recordAbsentSubsystem(
    'read-cache',
    dependencies.readCachePolicy.absenceReason,
  );

  return withHttpProblemHandling(
    async (event, _lambdaContext, requestScope) => {
      const authenticationContext = readAuthenticationContext(event);
      requireScope(authenticationContext, scopeNames.recordsRead);
      dependencies.readLog.bindTenant(authenticationContext.tenantId);

      const recordId = checkedRecordIdentifier(event.pathParameters?.['recordId']);
      const clientVersions = clientVersionsFrom(
        readRequestHeader(event.headers, httpHeaders.ifNoneMatch),
      );
      // §2 step 5: the cache is consulted only when enabled, which RD1 does not allow.

      const startedAt = dependencies.monotonicNow();
      const fanOutOptions = {
        readRequest: { tenantId: authenticationContext.tenantId, recordId },
        correlationId: requestScope.correlationId,
        providerTimeoutMilliseconds: timing.providerTimeoutMilliseconds,
        now: dependencies.monotonicNow,
      };
      let outcomes = await fanOutToProviders({
        ...fanOutOptions,
        readAdapters: dependencies.readAdapters,
        clientVersionsByProvider: clientVersions ?? {},
        fanOutBudgetMilliseconds: timing.fanOutBudgetMilliseconds,
      });
      for (const outcome of outcomes) {
        dependencies.readMetrics.recordProviderCall(outcome);
      }

      const statuses = outcomes.map((outcome) => outcome.status);
      const anyOk = statuses.includes('ok');
      const anyFailed = statuses.some(isFailedStatus);
      const notModifiedProviders = outcomes
        .filter((outcome) => outcome.status === 'not-modified')
        .map((outcome) => outcome.providerId);

      // §4.3, with RQ4: a 304 needs every provider unchanged or holding nothing,
      // and the unchanged ones to be exactly those in the client's ETag, so a
      // provider that has since emptied cannot hide behind the 304.
      if (
        clientVersions !== undefined &&
        !anyOk &&
        !anyFailed &&
        notModifiedProviders.length > 0 &&
        sameProviders(notModifiedProviders, Object.keys(clientVersions))
      ) {
        dependencies.readMetrics.countReadNotModified();
        const unchangedVersions: VersionsByProvider = Object.fromEntries(
          outcomes.flatMap((outcome) =>
            outcome.version === undefined ? [] : [[outcome.providerId, outcome.version]],
          ),
        );
        return {
          statusCode: 304,
          headers: {
            [httpHeaders.entityTag.wireName]: formatAggregateEntityTag(unchangedVersions),
            [httpHeaders.cacheControl.wireName]:
              `private, max-age=${String(smallestTtl(outcomes))}`,
            [httpHeaders.vary.wireName]: httpHeaders.authorization.wireName,
          },
        } satisfies APIGatewayProxyStructuredResultV2;
      }

      // §4.3: unchanged providers alongside a changed or emptied one are called
      // once more for their bodies, within what remains of the budget. When
      // the rest failed and none answered 200, there is no record to complete,
      // and §3.4 answers 503 below without that call.
      if (notModifiedProviders.length > 0 && !(anyFailed && !anyOk)) {
        dependencies.readLog.recordConditionalRefetch(notModifiedProviders);
        const remainingBudget = Math.floor(
          timing.fanOutBudgetMilliseconds - (dependencies.monotonicNow() - startedAt),
        );
        const refetchAdapters = dependencies.readAdapters.filter((readAdapter) =>
          notModifiedProviders.includes(readAdapter.providerId),
        );
        const refetched =
          remainingBudget >= 1
            ? await fanOutToProviders({
                ...fanOutOptions,
                readAdapters: refetchAdapters,
                clientVersionsByProvider: {},
                fanOutBudgetMilliseconds: remainingBudget,
              })
            : refetchAdapters.map((readAdapter): ProviderCallOutcome => ({
                providerId: readAdapter.providerId,
                status: 'timeout',
                ttlSeconds: 0,
                latencyMilliseconds: 0,
              }));
        for (const refetchedOutcome of refetched) {
          dependencies.readMetrics.countConditionalRefetch(refetchedOutcome.providerId);
          dependencies.readMetrics.recordProviderCall(refetchedOutcome);
        }
        outcomes = outcomes.map(
          (outcome) =>
            refetched.find(
              (refetchedOutcome) => refetchedOutcome.providerId === outcome.providerId,
            ) ?? outcome,
        );
      }

      const merged = mergeProviderOutcomes(outcomes, recordId, dependencies.now());
      for (const [providerId, sectionCount] of Object.entries(merged.ignoredSectionCounts)) {
        dependencies.readMetrics.countSectionsIgnored(
          providerId as ProviderIdentifier,
          sectionCount,
        );
      }
      // A merge with no failure and no record can only be every provider
      // unchanged against a different ETag; the refetch above has replaced
      // those, so here no record means not found or unavailable.
      if (merged.allNotFound) {
        throw new DemoError('not-found', 'no-provider-holds-the-record');
      }
      if (merged.record === undefined) {
        dependencies.readMetrics.countReadAllSourcesUnavailable();
        throw new DemoError('all-sources-unavailable', 'no-provider-answered', {
          retryAfterSeconds: readPathSettings.retryAfterSeconds,
        });
      }
      if (merged.partial) {
        dependencies.readMetrics.countReadPartial();
      }
      const readResponse: ReadResponse = {
        record: merged.record,
        partial: merged.partial,
        sources: [...merged.sources],
        servedFrom: 'live',
      };
      // §4.2 with RQ4: an ETag only when no provider failed, so a conditional
      // request can never hide a missing source.
      const complete = !merged.partial && Object.keys(merged.versionsByProvider).length > 0;
      return {
        statusCode: 200,
        headers: {
          [httpHeaders.contentType.wireName]: headerValues.jsonMediaType,
          [httpHeaders.cacheControl.wireName]: complete
            ? `private, max-age=${String(smallestTtl(outcomes))}`
            : 'private, max-age=0, must-revalidate',
          [httpHeaders.vary.wireName]: httpHeaders.authorization.wireName,
          ...(complete
            ? {
                [httpHeaders.entityTag.wireName]: formatAggregateEntityTag(
                  merged.versionsByProvider,
                ),
              }
            : {}),
        },
        body: JSON.stringify(readResponse),
      };
    },
    { log: dependencies.problemLog, metrics: dependencies.problemMetrics },
  );
}
