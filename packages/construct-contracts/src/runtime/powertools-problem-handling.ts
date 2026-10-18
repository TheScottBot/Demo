import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { ProblemHandlingLog, ProblemHandlingMetrics } from '@demo/contracts';
import type { DemoStage } from '../construct-properties';
import { demoMetricsNamespace } from '../resource-naming';

// The CQ3 interfaces satisfied with Powertools (Spec 00 §5.1, CU5). It lives
// here, beside the stubs that are its first users; a service may use it too.
// Neither interface method takes free text, so nothing here can log an input
// value or a payload.

export interface PowertoolsProblemHandlingOptions {
  stage: DemoStage;
  serviceName: string;
  // The route or component every log line names (§5.1).
  component: string;
}

export function createPowertoolsProblemHandling(options: PowertoolsProblemHandlingOptions) {
  const metricsNamespace = demoMetricsNamespace(options.stage);
  const logger = new Logger({
    serviceName: options.serviceName,
    persistentKeys: { component: options.component, stage: options.stage },
  });
  // serviceName becomes the metric dimension `service` (§5.1).
  const metricsPublisher = new Metrics({
    namespace: metricsNamespace,
    serviceName: options.serviceName,
  });
  const tracer = new Tracer({ serviceName: options.serviceName });

  const log: ProblemHandlingLog = {
    bindRequestKeys: (requestKeys) => {
      logger.appendKeys({ correlationId: requestKeys.correlationId });
    },
    clearRequestKeys: () => {
      logger.resetKeys();
    },
    recordRejection: (rejection) => {
      logger.warn('request-rejected', {
        errorCode: rejection.errorCode,
        status: rejection.status,
        reasonCategory: rejection.reasonCategory,
      });
    },
    recordInternalFailure: (failure) => {
      logger.error('internal-failure', { errorName: failure.errorName });
    },
  };

  // A single metric is emitted at once, so its errorCode dimension stays on
  // this one data point and never leaks onto metrics stored for later.
  const metrics: ProblemHandlingMetrics = {
    countRequestRejected: (errorCode) => {
      metricsPublisher
        .singleMetric()
        .addDimension('errorCode', errorCode)
        .addMetric('RequestRejected', MetricUnit.Count, 1);
    },
  };

  return {
    log,
    metrics,
    logger,
    metricsPublisher,
    tracer,
    metricsNamespace,
    serviceName: options.serviceName,
  };
}
