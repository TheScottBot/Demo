import { describe, expect, it, vi } from 'vitest';
import { createPowertoolsProblemHandling } from '../src/index';

function createForTest() {
  return createPowertoolsProblemHandling({
    stage: 'dev',
    serviceName: 'stub',
    component: 'read-record',
  });
}

describe('the Powertools problem handling adapter', () => {
  it('configures the logger and metrics for the stage and service (Spec 00 §5.1)', () => {
    const observability = createForTest();
    expect(observability.metricsNamespace).toBe('Demo/dev');
    expect(observability.serviceName).toBe('stub');
  });

  it('binds the correlation identifier as a request key and clears it after', () => {
    const observability = createForTest();
    const appendKeys = vi.spyOn(observability.logger, 'appendKeys');
    const resetKeys = vi.spyOn(observability.logger, 'resetKeys');
    observability.log.bindRequestKeys({ correlationId: '01JB0000000000000000000001' });
    observability.log.clearRequestKeys();
    expect(appendKeys).toHaveBeenCalledWith({ correlationId: '01JB0000000000000000000001' });
    expect(resetKeys).toHaveBeenCalledOnce();
  });

  it('logs a rejection by code, status and reason category only', () => {
    const observability = createForTest();
    const warn = vi.spyOn(observability.logger, 'warn').mockImplementation(() => undefined);
    observability.log.recordRejection({
      errorCode: 'not-found',
      status: 404,
      reasonCategory: 'record-absent',
    });
    expect(warn).toHaveBeenCalledWith('request-rejected', {
      errorCode: 'not-found',
      status: 404,
      reasonCategory: 'record-absent',
    });
  });

  it('logs an internal failure by error name only', () => {
    const observability = createForTest();
    const error = vi.spyOn(observability.logger, 'error').mockImplementation(() => undefined);
    observability.log.recordInternalFailure({ errorName: 'TypeError' });
    expect(error).toHaveBeenCalledWith('internal-failure', { errorName: 'TypeError' });
  });

  it('emits RequestRejected at once, with the error code as its dimension', () => {
    const observability = createForTest();
    const addDimension = vi.fn().mockReturnThis();
    const addMetric = vi.fn().mockReturnThis();
    vi.spyOn(observability.metricsPublisher, 'singleMetric').mockReturnValue({
      addDimension,
      addMetric,
    } as never);
    observability.metrics.countRequestRejected('forbidden');
    expect(addDimension).toHaveBeenCalledWith('errorCode', 'forbidden');
    expect(addMetric).toHaveBeenCalledWith('RequestRejected', 'Count', 1);
  });
});
