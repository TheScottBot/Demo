// Spec 03 §11 and WE3: the relay, sweep and journal metrics and logs through
// Powertools, each metric a single metric with its own dimensions.
import { describe, expect, it, vi } from 'vitest';
import { createPowertoolsWriteObservability } from '../src/write-path-observability';

function observabilityForTest() {
  const observability = createPowertoolsWriteObservability({
    stage: 'dev',
    component: 'write-relay',
  });
  const singleMetrics: { dimensions: [string, string][]; metric: [string, string, number] }[] = [];
  vi.spyOn(observability.metricsPublisher, 'singleMetric').mockImplementation(() => {
    const recorded = {
      dimensions: [] as [string, string][],
      metric: ['', '', 0] as [string, string, number],
    };
    singleMetrics.push(recorded);
    const fakeMetric = {
      addDimension: (name: string, value: string) => {
        recorded.dimensions.push([name, value]);
        return fakeMetric;
      },
      addMetric: (name: string, unit: string, value: number) => {
        recorded.metric = [name, unit, value];
        return fakeMetric;
      },
    };
    return fakeMetric as never;
  });
  return { observability, singleMetrics };
}

describe('write path metrics (§11)', () => {
  it('names each metric and its dimensions as §11 does', () => {
    const { observability, singleMetrics } = observabilityForTest();
    observability.journalMetrics.countStaleTransition('sweep');
    observability.journalMetrics.countJournalItemRejected('version-mismatch', 'operation');
    observability.relayMetrics.countRelayEnqueued();
    observability.relayMetrics.countRelayBatchFailed();
    observability.relayMetrics.countJournalItemExpired('idempotency');
    observability.sweepMetrics.countSweepRecovered();
    observability.sweepMetrics.countSweepLimitReached('time');
    expect(singleMetrics).toEqual([
      { dimensions: [['origin', 'sweep']], metric: ['StaleTransition', 'Count', 1] },
      {
        dimensions: [
          ['reason', 'version-mismatch'],
          ['itemKind', 'operation'],
        ],
        metric: ['JournalItemRejected', 'Count', 1],
      },
      { dimensions: [], metric: ['RelayEnqueued', 'Count', 1] },
      { dimensions: [], metric: ['RelayBatchFailed', 'Count', 1] },
      { dimensions: [['itemKind', 'idempotency']], metric: ['JournalItemExpired', 'Count', 1] },
      { dimensions: [], metric: ['SweepRecovered', 'Count', 1] },
      { dimensions: [['limit', 'time']], metric: ['SweepLimitReached', 'Count', 1] },
    ]);
  });

  it('publishes under the stage namespace for the write service (Spec 00 §5.1)', () => {
    const { observability } = observabilityForTest();
    expect(observability.metricsNamespace).toBe('Demo/dev');
    expect(observability.serviceName).toBe('write');
  });
});

describe('write path logs', () => {
  it('logs each event once, with operationId and categories and no command field', () => {
    const { observability } = observabilityForTest();
    const info = vi.spyOn(observability.logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(observability.logger, 'warn').mockImplementation(() => undefined);
    observability.journalLog.recordStaleTransition({
      operationId: '01JB0000000000000000000101',
      origin: 'relay',
      targetState: 'QUEUED',
      currentState: 'APPLYING',
    });
    observability.relayLog.recordBatchFailed({ failedRecordCount: 2 });
    observability.sweepLog.recordRecovery();
    observability.sweepLog.recordAbsentSubsystem('relay', 'relayEnabled is false');
    expect(info).toHaveBeenCalledWith('StaleTransition', {
      operationId: '01JB0000000000000000000101',
      origin: 'relay',
      targetState: 'QUEUED',
      currentState: 'APPLYING',
    });
    expect(warn).toHaveBeenCalledWith('relay-batch-failed', {
      failedRecordCount: 2,
      reason: expect.any(String) as string,
    });
    expect(warn).toHaveBeenCalledWith('sweep-recovering', { reason: expect.any(String) as string });
    expect(info).toHaveBeenCalledWith('subsystem-absent', {
      subsystem: 'relay',
      reason: 'relayEnabled is false',
    });
  });
});
