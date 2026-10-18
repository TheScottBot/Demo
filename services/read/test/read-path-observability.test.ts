// Spec 02 §8 and RE5: the read path's logging, metrics and traces through
// Powertools, and the subsegment per provider call.
import type { ProviderReadResult, ReadAdapter } from '@demo/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createPowertoolsReadPathObservability,
  traceReadAdapters,
  type TraceSubsegmentSource,
} from '../src/read-path-observability';

function observabilityForTest() {
  const observability = createPowertoolsReadPathObservability({ stage: 'dev' });
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

describe('read path metrics (§8)', () => {
  it('records ProviderLatency and ProviderOutcome for each provider call', () => {
    const { observability, singleMetrics } = observabilityForTest();
    observability.readMetrics.recordProviderCall({
      providerId: 'provider-b',
      status: 'error',
      errorReason: 'version-mismatch',
      ttlSeconds: 0,
      latencyMilliseconds: 42,
    });
    expect(singleMetrics).toEqual([
      {
        dimensions: [['providerId', 'provider-b']],
        metric: ['ProviderLatency', 'Milliseconds', 42],
      },
      {
        dimensions: [
          ['providerId', 'provider-b'],
          ['status', 'error'],
          ['errorReason', 'version-mismatch'],
        ],
        metric: ['ProviderOutcome', 'Count', 1],
      },
    ]);
  });

  it('leaves errorReason off an outcome that has none', () => {
    const { observability, singleMetrics } = observabilityForTest();
    observability.readMetrics.recordProviderCall({
      providerId: 'provider-a',
      status: 'timeout',
      ttlSeconds: 0,
      latencyMilliseconds: 1_500,
    });
    expect(singleMetrics[1]?.dimensions).toEqual([
      ['providerId', 'provider-a'],
      ['status', 'timeout'],
    ]);
  });

  it.each([
    ['countReadPartial', 'ReadPartial'],
    ['countReadNotModified', 'ReadNotModified'],
    ['countReadAllSourcesUnavailable', 'ReadAllSourcesUnavailable'],
  ] as const)('%s counts %s with no dimension of its own', (methodName, metricName) => {
    const { observability, singleMetrics } = observabilityForTest();
    observability.readMetrics[methodName]();
    expect(singleMetrics).toEqual([{ dimensions: [], metric: [metricName, 'Count', 1] }]);
  });

  it('counts ignored sections and conditional refetches by provider', () => {
    const { observability, singleMetrics } = observabilityForTest();
    observability.readMetrics.countSectionsIgnored('provider-c', 2);
    observability.readMetrics.countConditionalRefetch('provider-a');
    expect(singleMetrics).toEqual([
      {
        dimensions: [['providerId', 'provider-c']],
        metric: ['ProviderSectionIgnored', 'Count', 2],
      },
      { dimensions: [['providerId', 'provider-a']], metric: ['ConditionalRefetch', 'Count', 1] },
    ]);
  });

  it('publishes under the stage namespace for the read service (Spec 00 §5.1)', () => {
    const { observability } = observabilityForTest();
    expect(observability.metricsNamespace).toBe('Demo/dev');
    expect(observability.serviceName).toBe('read');
  });
});

describe('read path log', () => {
  it('binds the tenant, and logs an absent subsystem and a conditional refetch without any input value', () => {
    const { observability } = observabilityForTest();
    const appendKeys = vi.spyOn(observability.logger, 'appendKeys');
    const info = vi.spyOn(observability.logger, 'info').mockImplementation(() => undefined);
    observability.readLog.bindTenant('tenant-1');
    observability.readLog.recordAbsentSubsystem('read-cache', 'read cache disabled');
    observability.readLog.recordConditionalRefetch(['provider-b', 'provider-c']);
    expect(appendKeys).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
    expect(info).toHaveBeenNthCalledWith(1, 'subsystem-absent', {
      subsystem: 'read-cache',
      reason: 'read cache disabled',
    });
    expect(info).toHaveBeenNthCalledWith(2, 'conditional-refetch', {
      providerIds: ['provider-b', 'provider-c'],
      reason: expect.any(String) as string,
    });
  });
});

describe('traceReadAdapters (§8: a subsegment per provider call)', () => {
  function recordingSource() {
    const subsegments: { name: string; annotations: Record<string, string>; closed: boolean }[] =
      [];
    const source: TraceSubsegmentSource = {
      openSubsegment: (name) => {
        const subsegment = { name, annotations: {} as Record<string, string>, closed: false };
        subsegments.push(subsegment);
        return {
          annotate: (key, value) => {
            subsegment.annotations[key] = value;
          },
          close: () => {
            subsegment.closed = true;
          },
        };
      },
    };
    return { source, subsegments };
  }

  const answering = (result: ProviderReadResult): ReadAdapter => ({
    providerId: 'provider-a',
    read: () => Promise.resolve(result),
  });

  const callOptions = {
    abortSignal: new AbortController().signal,
    correlationId: '01JB0000000000000000000009',
  };

  it('opens, annotates and closes a subsegment for each call', async () => {
    const { source, subsegments } = recordingSource();
    const [traced] = traceReadAdapters(
      [answering({ outcome: 'not-modified', version: 'v1', ttlSeconds: 60 })],
      source,
    );
    await traced?.read({ tenantId: 'tenant-1', recordId: 'record-0001' }, callOptions);
    expect(subsegments).toEqual([
      {
        name: 'provider provider-a',
        annotations: { providerId: 'provider-a', status: 'not-modified' },
        closed: true,
      },
    ]);
  });

  it('marks an aborted call timeout, and any other rejection error, closing the subsegment either way', async () => {
    const { source, subsegments } = recordingSource();
    const abortController = new AbortController();
    abortController.abort(new DOMException('deadline', 'TimeoutError'));
    const rejecting: ReadAdapter = {
      providerId: 'provider-b',
      read: () => Promise.reject(new Error('transport failure')),
    };
    const [traced] = traceReadAdapters([rejecting], source);
    await expect(
      traced?.read(
        { tenantId: 'tenant-1', recordId: 'record-0001' },
        { ...callOptions, abortSignal: abortController.signal },
      ),
    ).rejects.toThrow();
    await expect(
      traced?.read({ tenantId: 'tenant-1', recordId: 'record-0001' }, callOptions),
    ).rejects.toThrow();
    expect(
      subsegments.map((subsegment) => [subsegment.annotations['status'], subsegment.closed]),
    ).toEqual([
      ['timeout', true],
      ['error', true],
    ]);
  });

  it('passes calls through untouched when there is no segment to trace into', async () => {
    const [traced] = traceReadAdapters([answering({ outcome: 'not-found', ttlSeconds: 0 })], {
      openSubsegment: () => undefined,
    });
    expect(
      await traced?.read({ tenantId: 'tenant-1', recordId: 'record-0001' }, callOptions),
    ).toEqual({
      outcome: 'not-found',
      ttlSeconds: 0,
    });
  });

  it('gives no subsegment when Powertools tracing is off, as it is outside Lambda', () => {
    const { observability } = observabilityForTest();
    expect(
      observability.traceSubsegmentSource.openSubsegment('provider provider-a'),
    ).toBeUndefined();
  });
});
