import {
  ProblemDocumentSchema,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
} from '@demo/contracts';
import {
  buildLambdaContext,
  buildVerifiedClaimsEvent,
  publicRouteNamed,
  type PublicRouteName,
} from '@demo/test-doubles';
import { describe, expect, it } from 'vitest';
import { createStubHandler, parseStubConfiguration, type DemoStage } from '../src/index';

function silentDependencies(): {
  log: ProblemHandlingLog;
  metrics: ProblemHandlingMetrics;
  tenantKeys: string[];
} {
  const tenantKeys: string[] = [];
  return {
    tenantKeys,
    log: {
      bindRequestKeys: () => undefined,
      clearRequestKeys: () => undefined,
      recordRejection: () => undefined,
      recordInternalFailure: () => undefined,
    },
    metrics: { countRequestRejected: () => undefined },
  };
}

const routeNames: PublicRouteName[] = ['read-record', 'submit-command', 'read-operation'];

function eventFor(routeName: PublicRouteName, headers: [string, string][] = []) {
  return buildVerifiedClaimsEvent({
    route: publicRouteNamed(routeName),
    pathParameters: { recordId: 'record-0001', operationId: '01JB0000000000000000000001' },
    headers,
  });
}

describe.each(routeNames)('the %s stub function', (routeName) => {
  it.each(['dev', 'stub', 'test', 'demo'] as const)(
    'answers 501 with a schema valid not-implemented problem document in %s',
    async (stage: DemoStage) => {
      const stubHandler = createStubHandler({ stage, routeName, ...silentDependencies() });
      const response = await stubHandler(
        eventFor(routeName, [['X-Correlation-Id', '01JB0000000000000000000009']]),
        buildLambdaContext(),
      );
      expect(response.statusCode).toBe(501);
      expect(response.headers?.['Content-Type']).toBe('application/problem+json');
      expect(response.headers?.['Cache-Control']).toBe('no-store');
      expect(response.headers?.['X-Correlation-Id']).toBe('01JB0000000000000000000009');
      const problemDocument = ProblemDocumentSchema.parse(JSON.parse(response.body ?? 'null'));
      expect(problemDocument.type).toBe('https://errors.demo.local/not-implemented');
      expect(problemDocument.status).toBe(501);
      expect(problemDocument.correlationId).toBe('01JB0000000000000000000009');
    },
  );

  it('echoes exactly If-None-Match, Idempotency-Key and X-Correlation-Id in the stub stage', async () => {
    const stubHandler = createStubHandler({ stage: 'stub', routeName, ...silentDependencies() });
    const response = await stubHandler(
      eventFor(routeName, [
        ['If-None-Match', '"aggregate-1"'],
        ['Idempotency-Key', '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'],
        ['X-Correlation-Id', '01JB0000000000000000000009'],
        ['Content-Type', 'application/json'],
      ]),
      buildLambdaContext(),
    );
    expect(JSON.parse(response.headers?.['Demo-Stub-Echo'] as string)).toEqual({
      'If-None-Match': '"aggregate-1"',
      'Idempotency-Key': '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
      'X-Correlation-Id': '01JB0000000000000000000009',
    });
  });

  it('echoes an absent header as null in the stub stage', async () => {
    const stubHandler = createStubHandler({ stage: 'stub', routeName, ...silentDependencies() });
    const response = await stubHandler(eventFor(routeName), buildLambdaContext());
    expect(JSON.parse(response.headers?.['Demo-Stub-Echo'] as string)).toEqual({
      'If-None-Match': null,
      'Idempotency-Key': null,
      'X-Correlation-Id': null,
    });
  });

  it.each(['dev', 'test', 'demo'] as const)('sends no Demo-Stub-Echo in %s', async (stage) => {
    const stubHandler = createStubHandler({ stage, routeName, ...silentDependencies() });
    const response = await stubHandler(
      eventFor(routeName, [['If-None-Match', '"aggregate-1"']]),
      buildLambdaContext(),
    );
    expect(response.headers?.['Demo-Stub-Echo']).toBeUndefined();
  });
});

describe('parseStubConfiguration', () => {
  it('reads the stage and route from the environment', () => {
    expect(
      parseStubConfiguration({
        DEMO_STAGE: 'stub',
        DEMO_STUB_ROUTE: 'read-record',
        AWS_REGION: 'eu-west-2',
      }),
    ).toEqual({ stage: 'stub', routeName: 'read-record' });
  });

  // Spec 00 §2.3: a missing or invalid required variable fails the cold start.
  it.each([
    ['a missing stage', { DEMO_STUB_ROUTE: 'read-record' }],
    ['an unknown stage', { DEMO_STAGE: 'prod', DEMO_STUB_ROUTE: 'read-record' }],
    ['a missing route', { DEMO_STAGE: 'dev' }],
    ['an unknown route', { DEMO_STAGE: 'dev', DEMO_STUB_ROUTE: 'delete-record' }],
  ])('refuses %s', (_caseName, environment) => {
    expect(() => parseStubConfiguration(environment)).toThrow();
  });
});
