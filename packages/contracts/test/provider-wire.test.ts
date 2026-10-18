import { describe, expect, it } from 'vitest';
import {
  ApplyOutcomeSchema,
  ProviderReadResponseBodySchema,
  ProviderReadResultSchema,
  ProviderWriteResponseBodySchema,
  formatEntityTag,
  isProviderContractVersionSupported,
  parseCacheControlMaxAge,
  parseEntityTag,
  parseProviderReadResponseBody,
  parseProviderWriteResponseBody,
  parseRetryAfterSeconds,
} from '../src/index';
import {
  syntheticProviderVersion,
  syntheticRecordIdentifier,
  syntheticSections,
  syntheticTimestamp,
} from './support/synthetic-values';

const readBody = {
  recordId: syntheticRecordIdentifier,
  updatedAt: syntheticTimestamp,
  sections: { summary: syntheticSections.summary, tasks: syntheticSections.tasks },
};

const writeBody = {
  recordId: syntheticRecordIdentifier,
  section: 'schedule',
  updatedAt: syntheticTimestamp,
};

describe('provider wire bodies', () => {
  it('accept the Spec 00 §4.4 shapes', () => {
    expect(ProviderReadResponseBodySchema.safeParse(readBody).success).toBe(true);
    expect(ProviderWriteResponseBodySchema.safeParse(writeBody).success).toBe(true);
  });

  it.each([
    [
      'a read body with an unknown key',
      ProviderReadResponseBodySchema,
      { ...readBody, version: 'v1' },
    ],
    [
      'a read body with an unknown section',
      ProviderReadResponseBodySchema,
      { ...readBody, sections: { attachments: {} } },
    ],
    [
      'a read body with a malformed section',
      ProviderReadResponseBodySchema,
      { ...readBody, sections: { summary: { title: '' } } },
    ],
    [
      'a read body without updatedAt',
      ProviderReadResponseBodySchema,
      { ...readBody, updatedAt: undefined },
    ],
    [
      'a write body with an unknown key',
      ProviderWriteResponseBodySchema,
      { ...writeBody, etag: 'v1' },
    ],
    [
      'a write body naming an unknown section',
      ProviderWriteResponseBodySchema,
      { ...writeBody, section: 'attachments' },
    ],
  ] as const)('refuse %s', (_caseName, schema, candidate) => {
    expect(schema.safeParse(candidate).success).toBe(false);
  });

  it('parse a read body within its bound', () => {
    expect(parseProviderReadResponseBody(JSON.stringify(readBody))).toEqual({
      outcome: 'accepted',
      body: readBody,
    });
  });

  it('refuse a read body one byte over 262,144 without parsing it', () => {
    expect(parseProviderReadResponseBody(' '.repeat(262_145))).toEqual({
      outcome: 'rejected',
      errorReason: 'body-too-large',
    });
  });

  it('report malformed JSON and schema breaches as schema-invalid', () => {
    expect(parseProviderReadResponseBody('{')).toEqual({
      outcome: 'rejected',
      errorReason: 'schema-invalid',
    });
    expect(parseProviderReadResponseBody('{}')).toEqual({
      outcome: 'rejected',
      errorReason: 'schema-invalid',
    });
    expect(parseProviderWriteResponseBody('[]')).toEqual({
      outcome: 'rejected',
      errorReason: 'schema-invalid',
    });
  });

  it('parse a write body', () => {
    expect(parseProviderWriteResponseBody(JSON.stringify(writeBody))).toEqual({
      outcome: 'accepted',
      body: writeBody,
    });
  });
});

describe('entity tags', () => {
  it('quote a provider version on the wire and read it back', () => {
    expect(formatEntityTag(syntheticProviderVersion)).toBe(`"${syntheticProviderVersion}"`);
    expect(parseEntityTag(formatEntityTag(syntheticProviderVersion))).toEqual({
      outcome: 'valid',
      version: syntheticProviderVersion,
    });
  });

  it('report an absent header as absent', () => {
    expect(parseEntityTag(undefined)).toEqual({ outcome: 'absent' });
  });

  it.each([
    ['an unquoted value', 'v1'],
    ['a weak tag', 'W/"v1"'],
    ['a value with a space', '"v 1"'],
    ['an empty quoted value', '""'],
    ['a version of 129 characters', `"${'v'.repeat(129)}"`],
    ['two tags', '"v1", "v2"'],
  ])('refuse %s', (_caseName, headerValue) => {
    expect(parseEntityTag(headerValue)).toEqual({ outcome: 'invalid' });
  });

  it('refuse to format a version outside the grammar', () => {
    expect(() => formatEntityTag('v 1')).toThrow();
  });
});

describe('provider Retry-After', () => {
  it.each([
    ['0', 0],
    ['2', 2],
    ['3600', 3_600],
  ])('accepts %s', (headerValue, expectedSeconds) => {
    expect(parseRetryAfterSeconds(headerValue)).toEqual({
      outcome: 'valid',
      seconds: expectedSeconds,
    });
  });

  it.each([
    '3601',
    '-1',
    '1.5',
    ' 2',
    '2 ',
    '',
    'Wed, 21 Oct 2026 07:28:00 GMT',
    '99999999999999999999',
  ])('refuses %j', (headerValue) => {
    expect(parseRetryAfterSeconds(headerValue)).toEqual({ outcome: 'invalid' });
  });

  it('reports an absent header as absent', () => {
    expect(parseRetryAfterSeconds(undefined)).toEqual({ outcome: 'absent' });
  });
});

describe('provider Cache-Control max-age', () => {
  it.each([
    ['max-age=60', 60],
    ['public, max-age=60', 60],
    ['MAX-AGE=60', 60],
    ['max-age=86400', 86_400],
    ['max-age=0, must-revalidate', 0],
  ])('reads %s', (headerValue, expectedSeconds) => {
    expect(parseCacheControlMaxAge(headerValue)).toEqual({
      outcome: 'valid',
      seconds: expectedSeconds,
    });
  });

  it.each([undefined, 'no-store', 'public, s-maxage=60'])('reports %s as absent', (headerValue) => {
    expect(parseCacheControlMaxAge(headerValue)).toEqual({ outcome: 'absent' });
  });

  it.each([
    'max-age=86401',
    'max-age="60"',
    'max-age=60, max-age=30',
    'max-age=',
    'max-age=-1',
    'max-age=6O',
  ])('refuses %s', (headerValue) => {
    expect(parseCacheControlMaxAge(headerValue)).toEqual({ outcome: 'invalid' });
  });
});

describe('the provider contract version', () => {
  it('accepts only the exact Spec 00 §3.1 value', () => {
    expect(isProviderContractVersionSupported('1')).toBe(true);
    expect(isProviderContractVersionSupported('2')).toBe(false);
    expect(isProviderContractVersionSupported(' 1')).toBe(false);
    expect(isProviderContractVersionSupported('1.0')).toBe(false);
    expect(isProviderContractVersionSupported(undefined)).toBe(false);
  });
});

describe('adapter results', () => {
  it('accept each ApplyOutcome kind', () => {
    for (const applyOutcome of [
      { kind: 'applied', providerVersion: syntheticProviderVersion },
      { kind: 'conflict', currentVersion: syntheticProviderVersion, reason: 'stale-base-version' },
      { kind: 'conflict', reason: 'stale-base-version' },
      { kind: 'rejected', code: 'http-status', reason: 'provider-500' },
      { kind: 'retryable', retryAfterMilliseconds: 2_000, reason: 'throttled' },
      { kind: 'retryable', reason: 'transport' },
    ]) {
      expect(ApplyOutcomeSchema.safeParse(applyOutcome).success).toBe(true);
    }
  });

  it('refuse an unknown ApplyOutcome kind or key', () => {
    expect(ApplyOutcomeSchema.safeParse({ kind: 'merged', reason: 'x' }).success).toBe(false);
    expect(
      ApplyOutcomeSchema.safeParse({ kind: 'applied', providerVersion: 'v1', extra: 1 }).success,
    ).toBe(false);
  });

  it('require an error reason exactly when a read result is an error', () => {
    expect(
      ProviderReadResultSchema.safeParse({
        outcome: 'error',
        errorReason: 'transport',
        ttlSeconds: 0,
      }).success,
    ).toBe(true);
    expect(ProviderReadResultSchema.safeParse({ outcome: 'error', ttlSeconds: 0 }).success).toBe(
      false,
    );
    expect(
      ProviderReadResultSchema.safeParse({
        outcome: 'not-found',
        errorReason: 'transport',
        ttlSeconds: 0,
      }).success,
    ).toBe(false);
    expect(
      ProviderReadResultSchema.safeParse({
        outcome: 'ok',
        version: syntheticProviderVersion,
        updatedAt: syntheticTimestamp,
        ttlSeconds: 60,
        sections: { summary: syntheticSections.summary },
      }).success,
    ).toBe(true);
  });
});
