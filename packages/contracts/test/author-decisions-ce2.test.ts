// Contract additions the author decided on 18 October 2026 during CE2: the
// sub claim bound, no-store on every problem document, and the CQ7 provider
// wire rules. Earlier assertions are left as they were (datum 0.4).
import { describe, expect, it } from 'vitest';
import {
  DemoError,
  authenticationClaimBounds,
  httpHeaders,
  providerWireStatuses,
  readAuthenticationContext,
  withHttpProblemHandling,
} from '../src/index';
import { SpyProblemHandlingLog, SpyProblemHandlingMetrics } from './support/problem-handling-spies';
import {
  defaultVerifiedClaims,
  syntheticLambdaContext,
  verifiedClaimsEvent,
} from './support/verified-claims-event';

describe('the sub claim bound', () => {
  it('is 255 characters', () => {
    expect(authenticationClaimBounds).toEqual({ subjectClaimMaximumCharacters: 255 });
  });

  it('accepts a subject of 255 characters and refuses one of 256', () => {
    const atBound = verifiedClaimsEvent({
      claims: { ...defaultVerifiedClaims(), sub: 's'.repeat(255) },
    });
    expect(readAuthenticationContext(atBound).subject).toHaveLength(255);
    const overBound = verifiedClaimsEvent({
      claims: { ...defaultVerifiedClaims(), sub: 's'.repeat(256) },
    });
    expect(() => readAuthenticationContext(overBound)).toThrow(DemoError);
  });
});

describe('problem documents on every route', () => {
  it('carry Cache-Control: no-store', async () => {
    const wrappedHandler = withHttpProblemHandling(
      () => {
        throw new DemoError('not-found', 'record-absent');
      },
      { log: new SpyProblemHandlingLog(), metrics: new SpyProblemHandlingMetrics() },
    );
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.headers?.['Cache-Control']).toBe('no-store');
  });

  it('leave a successful response to set its own Cache-Control', async () => {
    const wrappedHandler = withHttpProblemHandling(
      () => Promise.resolve({ statusCode: 200, headers: { 'Cache-Control': 'max-age=30' } }),
      { log: new SpyProblemHandlingLog(), metrics: new SpyProblemHandlingMetrics() },
    );
    const response = await wrappedHandler(verifiedClaimsEvent(), syntheticLambdaContext);
    expect(response.headers?.['Cache-Control']).toBe('max-age=30');
  });
});

describe('the CQ7 provider wire rules', () => {
  it('name the tenant header', () => {
    expect(httpHeaders.providerTenant).toEqual({
      wireName: 'Demo-Tenant-Id',
      direction: 'request',
      boundary: 'provider',
    });
  });

  it('hold every status the author decided', () => {
    expect(providerWireStatuses).toEqual({
      readOk: 200,
      notModified: 304,
      replaceApplied: 200,
      appendApplied: 201,
      requestInvalid: 400,
      apiKeyRefused: 401,
      notHeld: 404,
      preconditionFailed: 412,
      ifMatchRequired: 428,
      idempotencyKeyReused: 422,
      throttled: 429,
      serverError: 500,
      unavailable: 503,
    });
  });
});
