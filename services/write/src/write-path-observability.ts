import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { createPowertoolsProblemHandling } from '@demo/construct-contracts/runtime';
import type { RelayLog, RelayMetrics } from './handlers/relay-handler';
import type { SweepLog, SweepMetrics } from './handlers/sweep-handler';
import type { JournalLog, JournalMetrics } from './journal-store';

// Spec 03 §11 through Powertools (Spec 00 §5.1, CU5). Each metric is a single
// metric, emitted at once with its own dimensions. Nothing here takes a
// payload, a command field or a body.

export function createPowertoolsWriteObservability(options: {
  stage: 'dev' | 'stub' | 'test' | 'demo';
  component: 'write-relay' | 'write-sweep';
}) {
  const { logger, metricsPublisher, tracer, metricsNamespace, serviceName } =
    createPowertoolsProblemHandling({
      stage: options.stage,
      serviceName: 'write',
      component: options.component,
    });

  const count = (metricName: string, dimensions: readonly [string, string][] = []) => {
    const singleMetric = metricsPublisher.singleMetric();
    for (const [dimensionName, dimensionValue] of dimensions) {
      singleMetric.addDimension(dimensionName, dimensionValue);
    }
    singleMetric.addMetric(metricName, MetricUnit.Count, 1);
  };

  const journalLog: JournalLog = {
    recordStaleTransition: (details) => {
      logger.info('StaleTransition', { ...details });
    },
  };
  const journalMetrics: JournalMetrics = {
    countStaleTransition: (origin) => {
      count('StaleTransition', [['origin', origin]]);
    },
    countJournalItemRejected: (reason, itemKind) => {
      count('JournalItemRejected', [
        ['reason', reason],
        ['itemKind', itemKind],
      ]);
    },
  };
  const relayLog: RelayLog = {
    recordBatchFailed: (details) => {
      logger.warn('relay-batch-failed', {
        failedRecordCount: details.failedRecordCount,
        reason: 'reported failed; the event source retries them, then sends them to relay-failures',
      });
    },
  };
  const relayMetrics: RelayMetrics = {
    countRelayEnqueued: () => {
      count('RelayEnqueued');
    },
    countRelayBatchFailed: () => {
      count('RelayBatchFailed');
    },
    countJournalItemExpired: (itemKind) => {
      count('JournalItemExpired', [['itemKind', itemKind]]);
    },
  };
  const sweepLog: SweepLog = {
    recordAbsentSubsystem: (subsystem, reason) => {
      logger.info('subsystem-absent', { subsystem, reason });
    },
    recordRecovery: () => {
      logger.warn('sweep-recovering', {
        reason: 'sending accepted operations the relay has not moved past the grace period',
      });
    },
  };
  const sweepMetrics: SweepMetrics = {
    countSweepRecovered: () => {
      count('SweepRecovered');
    },
    countSweepLimitReached: (limit) => {
      count('SweepLimitReached', [['limit', limit]]);
    },
  };

  return {
    journalLog,
    journalMetrics,
    relayLog,
    relayMetrics,
    sweepLog,
    sweepMetrics,
    logger,
    metricsPublisher,
    tracer,
    metricsNamespace,
    serviceName,
  };
}
