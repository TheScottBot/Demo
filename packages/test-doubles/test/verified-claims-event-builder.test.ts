import {
  httpHeaders,
  publicRoutes,
  readAuthenticationContext,
  readRequestHeader,
  withHttpProblemHandling,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
} from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import { buildLambdaContext, buildVerifiedClaimsEvent, publicRouteNamed } from '../src/index';

const readRecordRoute = publicRouteNamed('read-record');

describe('buildVerifiedClaimsEvent', () => {
  it('builds an event that readAuthenticationContext accepts', () => {
    const event = buildVerifiedClaimsEvent({
      route: readRecordRoute,
      pathParameters: { recordId: 'record-0001' },
    });
    expect(readAuthenticationContext(event)).toEqual({
      subject: 'synthetic-subject-0001',
      tenantId: 'tenant-1',
      scopes: ['records:read', 'records:write'],
    });
  });

  it('carries the tenant, subject and scopes it is given', () => {
    const event = buildVerifiedClaimsEvent({
      route: readRecordRoute,
      pathParameters: { recordId: 'record-0001' },
      claims: { tenantId: 'tenant-2', subject: 'synthetic-subject-0002', scope: ['records:read'] },
    });
    expect(readAuthenticationContext(event)).toEqual({
      subject: 'synthetic-subject-0002',
      tenantId: 'tenant-2',
      scopes: ['records:read'],
    });
  });

  it('replaces the claims outright when given raw claims, so hostile claims can be tested', () => {
    const event = buildVerifiedClaimsEvent({
      route: readRecordRoute,
      pathParameters: { recordId: 'record-0001' },
      rawClaims: { sub: 'synthetic-subject-0001', scope: 'records:read' },
    });
    expect(event.requestContext.authorizer.jwt.claims).toEqual({
      sub: 'synthetic-subject-0001',
      scope: 'records:read',
    });
    expect(() => readAuthenticationContext(event)).toThrow();
  });

  it.each(publicRoutes.map((publicRoute) => [publicRoute.path, publicRoute] as const))(
    'fills the route key and path for %s',
    (_routePath, publicRoute) => {
      const event = buildVerifiedClaimsEvent({
        route: publicRoute,
        pathParameters: { recordId: 'record-0001', operationId: '01JB0000000000000000000001' },
      });
      expect(event.routeKey).toBe(`${publicRoute.method} ${publicRoute.path}`);
      expect(event.requestContext.routeKey).toBe(event.routeKey);
      expect(event.requestContext.http.method).toBe(publicRoute.method);
      expect(event.rawPath).not.toContain('{');
      expect(event.requestContext.http.path).toBe(event.rawPath);
    },
  );

  it('substitutes path parameters into the raw path and keeps only those the route names', () => {
    const event = buildVerifiedClaimsEvent({
      route: readRecordRoute,
      pathParameters: { recordId: 'record-0002', operationId: 'unused' },
    });
    expect(event.rawPath).toBe('/v1/records/record-0002');
    expect(event.pathParameters).toEqual({ recordId: 'record-0002' });
  });

  it('refuses to build an event missing a path parameter its route names', () => {
    expect(() => buildVerifiedClaimsEvent({ route: readRecordRoute })).toThrow(
      'path-parameter-missing',
    );
  });

  // CU3: payload format 2.0 lower cases header names and joins duplicates
  // with commas.
  it('delivers headers the way payload format 2.0 does', () => {
    const event = buildVerifiedClaimsEvent({
      route: readRecordRoute,
      pathParameters: { recordId: 'record-0001' },
      headers: [
        ['X-Correlation-Id', '01JB0000000000000000000001'],
        ['If-None-Match', '"a"'],
        ['if-none-match', '"b"'],
      ],
    });
    expect(event.headers).toEqual({
      'x-correlation-id': '01JB0000000000000000000001',
      'if-none-match': '"a","b"',
    });
    expect(readRequestHeader(event.headers, httpHeaders.correlationIdentifier)).toBe(
      '01JB0000000000000000000001',
    );
  });

  it('carries a body and its encoding flag', () => {
    const event = buildVerifiedClaimsEvent({
      route: publicRouteNamed('submit-command'),
      body: '{"type":"record.notes.append"}',
      isBase64Encoded: false,
    });
    expect(event.body).toBe('{"type":"record.notes.append"}');
    expect(event.isBase64Encoded).toBe(false);
    expect(buildVerifiedClaimsEvent({ route: publicRouteNamed('submit-command') }).body).toBe(
      undefined,
    );
  });

  it('builds events that withHttpProblemHandling accepts end to end', async () => {
    const quietLog: ProblemHandlingLog = {
      bindRequestKeys: () => undefined,
      clearRequestKeys: () => undefined,
      recordRejection: () => undefined,
      recordInternalFailure: () => undefined,
    };
    const quietMetrics: ProblemHandlingMetrics = { countRequestRejected: () => undefined };
    const wrappedHandler = withHttpProblemHandling(
      (event) =>
        Promise.resolve({ statusCode: 200, body: readAuthenticationContext(event).tenantId }),
      { log: quietLog, metrics: quietMetrics },
    );
    const response = await wrappedHandler(
      buildVerifiedClaimsEvent({
        route: readRecordRoute,
        pathParameters: { recordId: 'record-0001' },
        headers: [['X-Correlation-Id', '01JB0000000000000000000001']],
      }),
      buildLambdaContext(),
    );
    expect(response).toEqual({
      statusCode: 200,
      body: 'tenant-1',
      headers: { 'X-Correlation-Id': '01JB0000000000000000000001' },
    });
  });
});

describe('buildLambdaContext', () => {
  it('gives a context whose remaining time can be overridden', () => {
    expect(buildLambdaContext().getRemainingTimeInMillis()).toBe(5_000);
    expect(buildLambdaContext({ remainingMilliseconds: 250 }).getRemainingTimeInMillis()).toBe(250);
    expect(buildLambdaContext().functionName).toBe('demo-dev-synthetic');
  });
});

describe('publicRouteNamed', () => {
  it('names each Spec 00 §3.2 route', () => {
    expect(publicRouteNamed('read-record').path).toBe('/v1/records/{recordId}');
    expect(publicRouteNamed('submit-command').path).toBe('/v1/commands');
    expect(publicRouteNamed('read-operation').path).toBe('/v1/operations/{operationId}');
  });
});
