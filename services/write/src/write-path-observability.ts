import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { createPowertoolsProblemHandling } from '@demo/construct-contracts/runtime';
import type { WriteAdapterMetrics } from './adapters/http-write-adapter';
import type { IntakeLog, IntakeMetrics } from './handlers/intake-handler';
import type { RelayLog, RelayMetrics } from './handlers/relay-handler';
import type { StatusLog } from './handlers/status-handler';
import type { SweepLog, SweepMetrics } from './handlers/sweep-handler';
import type { WorkerLog, WorkerMetrics } from './handlers/worker-handler';
import type { JournalLog, JournalMetrics } from './journal-store';

// Spec 03 §11 through Powertools (Spec 00 §5.1, CU5). Each metric is a single
// metric, emitted at once with its own dimensions. Nothing here takes a
// payload, a command field or a body.

export function createPowertoolsWriteObservability(options: {
  stage: 'dev' | 'stub' | 'test' | 'demo';
  component: 'write-intake' | 'write-status' | 'write-relay' | 'write-sweep' | 'write-worker';
}) {
  const {
    log: problemLog,
    metrics: problemMetrics,
    logger,
    metricsPublisher,
    tracer,
    metricsNamespace,
    serviceName,
  } = createPowertoolsProblemHandling({
    stage: options.stage,
    serviceName: 'write',
    component: options.component,
  });

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
  const count = (metricName: string, dimensions: readonly [string, string][] = []) => {
    emit(metricName, MetricUnit.Count, 1, dimensions);
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

  const workerLog: WorkerLog = {
    bindOperation: (keys) => {
      logger.appendKeys({ ...keys });
    },
    recordMessageRejected: (reason) => {
      logger.warn('QueueMessageRejected', { reason });
    },
    recordOperationMissing: (operationId) => {
      logger.warn('OperationMissing', { operationId });
    },
    recordDuplicateDelivery: (operationId, state) => {
      logger.info('DuplicateDelivery', { operationId, state });
    },
    recordRetry: (details) => {
      logger.warn('apply-retrying', {
        ...details,
        retry:
          'the message becomes visible again after the backoff, with the same key and If-Match',
      });
    },
  };
  const workerMetrics: WorkerMetrics = {
    countQueueMessageRejected: (reason) => {
      count('QueueMessageRejected', [['reason', reason]]);
    },
    countDuplicateDelivery: () => {
      count('DuplicateDelivery');
    },
    recordApplyOutcome: (details) => {
      count('ApplyOutcome', [
        ['providerId', details.providerId],
        ['outcome', details.outcome],
        ...(details.reason === undefined ? [] : [['reason', details.reason] as [string, string]]),
      ]);
      emit('ApplyLatency', MetricUnit.Milliseconds, details.latencyMilliseconds, [
        ['providerId', details.providerId],
      ]);
    },
    recordTimeToTerminalState: (state, milliseconds) => {
      emit('TimeToTerminalState', MetricUnit.Milliseconds, milliseconds, [['state', state]]);
    },
  };
  // §11: operationId on every line once it is known.
  const bindOperation = (operationId: string) => {
    logger.appendKeys({ operationId });
  };
  const intakeLog: IntakeLog = { bindOperation };
  const statusLog: StatusLog = { bindOperation };
  const intakeMetrics: IntakeMetrics = {
    countCommandAccepted: (providerId) => {
      count('CommandsAccepted', [['providerId', providerId]]);
    },
    countIdempotentReplay: () => {
      count('IdempotentReplay');
    },
    countIdempotencyKeyReused: () => {
      count('IdempotencyKeyReused');
    },
  };
  const adapterMetrics: WriteAdapterMetrics = {
    countRetryAfterIgnored: (providerId) => {
      count('ProviderRetryAfterIgnored', [['providerId', providerId]]);
    },
  };

  return {
    problemLog,
    problemMetrics,
    intakeLog,
    intakeMetrics,
    statusLog,
    adapterMetrics,
    workerLog,
    workerMetrics,
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
