import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { createPowertoolsProblemHandling } from '@demo/construct-contracts/runtime';
import type { ProviderIdentifier, ReadAdapter } from '@demo/contracts';
import type { ReadPathLog, ReadPathMetrics } from './read-handler';

// Spec 02 §8 through Powertools (Spec 00 §5.1, CU5). Each metric is a single
// metric, emitted at once with its own dimensions, so a provider's dimensions
// never leak onto another data point. Nothing here takes a section, a body or
// a token.

export interface TraceSubsegment {
  annotate(key: string, value: string): void;
  close(): void;
}

// Where provider subsegments come from; undefined when there is no segment,
// as outside Lambda or with tracing off.
export interface TraceSubsegmentSource {
  openSubsegment(name: string): TraceSubsegment | undefined;
}

export function createPowertoolsReadPathObservability(options: {
  stage: 'dev' | 'stub' | 'test' | 'demo';
}) {
  const problemHandling = createPowertoolsProblemHandling({
    stage: options.stage,
    serviceName: 'read',
    component: 'read-record',
  });
  const { logger, metricsPublisher, tracer } = problemHandling;

  const emit = (
    metricName: string,
    unit: (typeof MetricUnit)[keyof typeof MetricUnit],
    value: number,
    dimensions: readonly [string, string][] = [],
  ) => {
    const singleMetric = metricsPublisher.singleMetric();
    for (const [dimensionName, dimensionValue] of dimensions) {
      singleMetric.addDimension(dimensionName, dimensionValue);
    }
    singleMetric.addMetric(metricName, unit, value);
  };

  const readMetrics: ReadPathMetrics = {
    recordProviderCall: (outcome) => {
      emit('ProviderLatency', MetricUnit.Milliseconds, outcome.latencyMilliseconds, [
        ['providerId', outcome.providerId],
      ]);
      emit('ProviderOutcome', MetricUnit.Count, 1, [
        ['providerId', outcome.providerId],
        ['status', outcome.status],
        ...(outcome.errorReason === undefined
          ? []
          : [['errorReason', outcome.errorReason] as [string, string]]),
      ]);
    },
    countSectionsIgnored: (providerId, sectionCount) => {
      emit('ProviderSectionIgnored', MetricUnit.Count, sectionCount, [['providerId', providerId]]);
    },
    countReadPartial: () => {
      emit('ReadPartial', MetricUnit.Count, 1);
    },
    countReadNotModified: () => {
      emit('ReadNotModified', MetricUnit.Count, 1);
    },
    countReadAllSourcesUnavailable: () => {
      emit('ReadAllSourcesUnavailable', MetricUnit.Count, 1);
    },
    countConditionalRefetch: (providerId: ProviderIdentifier) => {
      emit('ConditionalRefetch', MetricUnit.Count, 1, [['providerId', providerId]]);
    },
  };

  const readLog: ReadPathLog = {
    bindTenant: (tenantId) => {
      logger.appendKeys({ tenantId });
    },
    recordAbsentSubsystem: (subsystem, reason) => {
      logger.info('subsystem-absent', { subsystem, reason });
    },
    // §4.3: logged once, with the reason the providers are called again.
    recordConditionalRefetch: (providerIds) => {
      logger.info('conditional-refetch', {
        providerIds: [...providerIds],
        reason: 'unchanged providers beside a changed or emptied one: their bodies are needed',
      });
    },
  };

  const traceSubsegmentSource: TraceSubsegmentSource = {
    openSubsegment: (name) => {
      const parentSegment = tracer.isTracingEnabled() ? tracer.getSegment() : undefined;
      if (parentSegment === undefined) {
        return undefined;
      }
      const subsegment = parentSegment.addNewSubsegment(name);
      return {
        annotate: (key, value) => {
          subsegment.addAnnotation(key, value);
        },
        close: () => {
          subsegment.close();
        },
      };
    },
  };

  return {
    problemLog: problemHandling.log,
    problemMetrics: problemHandling.metrics,
    readLog,
    readMetrics,
    traceSubsegmentSource,
    logger,
    metricsPublisher,
    tracer,
    metricsNamespace: problemHandling.metricsNamespace,
    serviceName: problemHandling.serviceName,
  };
}

// §8: each provider call is its own subsegment, annotated with providerId and
// status. An abort reads as timeout and any other rejection as error, as the
// fan-out maps them (§3.1).
export function traceReadAdapters(
  readAdapters: readonly ReadAdapter[],
  subsegmentSource: TraceSubsegmentSource,
): ReadAdapter[] {
  return readAdapters.map((readAdapter) => ({
    providerId: readAdapter.providerId,
    read: async (readRequest, callOptions) => {
      const subsegment = subsegmentSource.openSubsegment(`provider ${readAdapter.providerId}`);
      if (subsegment === undefined) {
        return readAdapter.read(readRequest, callOptions);
      }
      subsegment.annotate('providerId', readAdapter.providerId);
      try {
        const result = await readAdapter.read(readRequest, callOptions);
        subsegment.annotate('status', result.outcome);
        return result;
      } catch (callFailure) {
        subsegment.annotate('status', callOptions.abortSignal.aborted ? 'timeout' : 'error');
        throw callFailure;
      } finally {
        subsegment.close();
      }
    },
  }));
}
