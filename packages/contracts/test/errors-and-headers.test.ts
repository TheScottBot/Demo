import { describe, expect, it } from 'vitest';
import {
  DemoError,
  ErrorCodeSchema,
  ProblemDocumentSchema,
  errorCodeDefinitions,
  headerLookupKey,
  httpHeaders,
  problemDocumentFor,
  problemTypeUriPrefix,
  readRequestHeader,
} from '../src/index';
import { syntheticUlid } from './support/synthetic-values';

describe('error codes', () => {
  it.each([
    ['validation-failed', 400],
    ['idempotency-key-required', 400],
    ['unauthorised', 401],
    ['forbidden', 403],
    ['not-found', 404],
    ['idempotency-key-reused', 422],
    ['throttled', 429],
    ['internal', 500],
    ['not-implemented', 501],
    ['all-sources-unavailable', 503],
  ] as const)('maps %s to %i', (errorCode, expectedStatus) => {
    expect(errorCodeDefinitions[errorCode].status).toBe(expectedStatus);
  });

  it('defines exactly the ten Spec 00 §3.6 codes', () => {
    expect(ErrorCodeSchema.options).toHaveLength(10);
    expect(Object.keys(errorCodeDefinitions).sort()).toEqual([...ErrorCodeSchema.options].sort());
  });
});

describe('problem documents', () => {
  it('name the error code in the type URI and carry its status and title', () => {
    const problemDocument = problemDocumentFor(
      new DemoError('not-found', 'record-absent'),
      syntheticUlid,
    );
    expect(problemDocument).toEqual({
      type: `${problemTypeUriPrefix}not-found`,
      title: errorCodeDefinitions['not-found'].title,
      status: 404,
      correlationId: syntheticUlid,
    });
    expect(ProblemDocumentSchema.safeParse(problemDocument).success).toBe(true);
  });

  it('carry invalid fields when the error has them', () => {
    const problemDocument = problemDocumentFor(
      new DemoError('validation-failed', 'body-schema', {
        invalidFields: [{ path: 'recordId', reason: 'grammar' }],
      }),
      syntheticUlid,
    );
    expect(problemDocument.invalidFields).toEqual([{ path: 'recordId', reason: 'grammar' }]);
  });

  it('refuse an unknown key', () => {
    const problemDocument = problemDocumentFor(
      new DemoError('internal', 'unexpected'),
      syntheticUlid,
    );
    expect(ProblemDocumentSchema.safeParse({ ...problemDocument, stack: 'x' }).success).toBe(false);
  });

  it('keep the error code and reason category on DemoError, and no message beyond the code', () => {
    const demoError = new DemoError('forbidden', 'scope-missing');
    expect(demoError.errorCode).toBe('forbidden');
    expect(demoError.reasonCategory).toBe('scope-missing');
    expect(demoError.message).toBe('forbidden');
    expect(demoError).toBeInstanceOf(Error);
  });
});

describe('header constants', () => {
  it('hold the Spec 00 §3.4 wire names', () => {
    expect(httpHeaders.correlationIdentifier.wireName).toBe('X-Correlation-Id');
    expect(httpHeaders.idempotencyKey.wireName).toBe('Idempotency-Key');
    expect(httpHeaders.idempotentReplayed.wireName).toBe('Idempotent-Replayed');
    expect(httpHeaders.providerContract.wireName).toBe('Demo-Provider-Contract');
  });

  it('derive the lower case key payload format 2.0 delivers headers under', () => {
    expect(headerLookupKey(httpHeaders.correlationIdentifier)).toBe('x-correlation-id');
    expect(
      readRequestHeader({ 'x-correlation-id': syntheticUlid }, httpHeaders.correlationIdentifier),
    ).toBe(syntheticUlid);
    expect(readRequestHeader({}, httpHeaders.correlationIdentifier)).toBeUndefined();
  });

  it('give every header a unique wire name', () => {
    const wireNames = Object.values(httpHeaders).map((headerDefinition) =>
      headerDefinition.wireName.toLowerCase(),
    );
    expect(new Set(wireNames).size).toBe(wireNames.length);
  });
});
