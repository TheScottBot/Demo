import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DemoError,
  ProblemDocumentSchema,
  invalidFieldsFromZodError,
  withHttpProblemHandling,
  type DemoRequestHandler,
} from '../src/index';
import { SpyProblemHandlingLog, SpyProblemHandlingMetrics } from './support/problem-handling-spies';
import { plantedSecretValue, secondSyntheticUlid, syntheticUlid } from './support/synthetic-values';
import { syntheticLambdaContext, verifiedClaimsEvent } from './support/verified-claims-event';

function wrapForTest(requestHandler: DemoRequestHandler) {
  const log = new SpyProblemHandlingLog();
  const metrics = new SpyProblemHandlingMetrics();
  const wrappedHandler = withHttpProblemHandling(requestHandler, {
    log,
    metrics,
    mintCorrelationIdentifier: () => secondSyntheticUlid,
  });
  return { wrappedHandler, log, metrics };
}

function parsedProblemDocument(body: string | undefined) {
  return ProblemDocumentSchema.parse(JSON.parse(body ?? 'null'));
}

const succeedingHandler: DemoRequestHandler = () =>
  Promise.resolve({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' });

describe('withHttpProblemHandling', () => {
  it('echoes a valid request correlation identifier on success', async () => {
    const { wrappedHandler, log } = wrapForTest(succeedingHandler);
    const response = await wrappedHandler(
      verifiedClaimsEvent({ headers: { 'x-correlation-id': syntheticUlid } }),
      syntheticLambdaContext,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers?.['X-Correlation-Id']).toBe(syntheticUlid);
    expect(response.headers?.['Content-Type']).toBe('application/json');
    expect(log.boundKeys).toEqual([{ correlationId: syntheticUlid }]);
  });

  it('mints a correlation identifier when the request carries none', async () => {
    const { wrappedHandler } = wrapForTest((_event, _lambdaContext, requestScope) =>
      Promise.resolve({ statusCode: 200, body: requestScope.correlationId }),
    );
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.headers?.['X-Correlation-Id']).toBe(secondSyntheticUlid);
    expect(response.body).toBe(secondSyntheticUlid);
  });

  it('refuses a malformed correlation identifier with 400, without echoing it', async () => {
    let handlerWasCalled = false;
    const { wrappedHandler, metrics } = wrapForTest(() => {
      handlerWasCalled = true;
      return succeedingHandler(verifiedClaimsEvent(), syntheticLambdaContext, {
        correlationId: '',
      });
    });
    const response = await wrappedHandler(
      verifiedClaimsEvent({ headers: { 'x-correlation-id': plantedSecretValue } }),
      syntheticLambdaContext,
    );
    expect(handlerWasCalled).toBe(false);
    expect(response.statusCode).toBe(400);
    expect(response.headers?.['X-Correlation-Id']).toBe(secondSyntheticUlid);
    expect(parsedProblemDocument(response.body)).toEqual({
      type: 'https://errors.demo.local/validation-failed',
      title: expect.any(String) as string,
      status: 400,
      correlationId: secondSyntheticUlid,
      invalidFields: [{ path: 'headers.X-Correlation-Id', reason: 'grammar' }],
    });
    expect(JSON.stringify(response)).not.toContain(plantedSecretValue);
    expect(metrics.rejectedErrorCodes).toEqual(['validation-failed']);
  });

  it('maps a thrown DemoError to its problem document', async () => {
    const { wrappedHandler, log, metrics } = wrapForTest(() => {
      throw new DemoError('not-found', 'record-absent');
    });
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.statusCode).toBe(404);
    expect(response.headers?.['Content-Type']).toBe('application/problem+json');
    expect(response.headers?.['X-Correlation-Id']).toBe(secondSyntheticUlid);
    expect(parsedProblemDocument(response.body).type).toBe('https://errors.demo.local/not-found');
    expect(metrics.rejectedErrorCodes).toEqual(['not-found']);
    expect(log.entries).toEqual([
      { kind: 'rejection', errorCode: 'not-found', status: 404, reasonCategory: 'record-absent' },
    ]);
  });

  it('sets Retry-After when the error carries one', async () => {
    const { wrappedHandler, metrics } = wrapForTest(() => {
      throw new DemoError('all-sources-unavailable', 'every-provider-failed', {
        retryAfterSeconds: 5,
      });
    });
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.statusCode).toBe(503);
    expect(response.headers?.['Retry-After']).toBe('5');
    expect(metrics.rejectedErrorCodes).toEqual([]);
  });

  it('maps anything else to internal, keeping its message out of the response and the log', async () => {
    const { wrappedHandler, log, metrics } = wrapForTest(() => {
      throw new TypeError(`cannot read ${plantedSecretValue}`);
    });
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.statusCode).toBe(500);
    expect(parsedProblemDocument(response.body).type).toBe('https://errors.demo.local/internal');
    expect(log.entries).toEqual([{ kind: 'internal-failure', errorName: 'TypeError' }]);
    expect(metrics.rejectedErrorCodes).toEqual([]);
    expect(JSON.stringify({ response, log })).not.toContain(plantedSecretValue);
  });

  it('maps a rejected promise the same way as a throw', async () => {
    const { wrappedHandler } = wrapForTest(() =>
      Promise.reject(new DemoError('forbidden', 'scope-missing')),
    );
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.statusCode).toBe(403);
  });

  it('counts RequestRejected for every 4xx it answers', async () => {
    for (const errorCode of [
      'validation-failed',
      'unauthorised',
      'forbidden',
      'not-found',
      'idempotency-key-reused',
    ] as const) {
      const { wrappedHandler, metrics } = wrapForTest(() => {
        throw new DemoError(errorCode, 'test-reason');
      });
      await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
      expect(metrics.rejectedErrorCodes).toEqual([errorCode]);
    }
  });

  it('clears the request keys after every invocation, success or failure', async () => {
    const succeeding = wrapForTest(succeedingHandler);
    await succeeding.wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(succeeding.log.clearedCount).toBe(1);
    const failing = wrapForTest(() => {
      throw new Error('boom');
    });
    await failing.wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(failing.log.clearedCount).toBe(1);
  });

  it('never puts an input value in a problem document or a log line', async () => {
    const commandSchema = z.strictObject({ recordId: z.string().regex(/^[a-z]+$/) });
    const hostileBody = { recordId: plantedSecretValue, [plantedSecretValue]: plantedSecretValue };
    const { wrappedHandler, log } = wrapForTest(() => {
      const parsed = commandSchema.safeParse(hostileBody);
      if (!parsed.success) {
        throw new DemoError('validation-failed', 'body-schema', {
          invalidFields: invalidFieldsFromZodError(parsed.error, hostileBody, 'body'),
        });
      }
      return succeedingHandler(verifiedClaimsEvent(), syntheticLambdaContext, {
        correlationId: '',
      });
    });
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.statusCode).toBe(400);
    expect(parsedProblemDocument(response.body).invalidFields).toEqual(
      expect.arrayContaining([
        { path: 'body', reason: 'unknown-field' },
        { path: 'body.recordId', reason: 'grammar' },
      ]),
    );
    expect(
      JSON.stringify({ response, entries: log.entries, boundKeys: log.boundKeys }),
    ).not.toContain(plantedSecretValue);
  });
});
