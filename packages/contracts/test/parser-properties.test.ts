// Spec 00 §2.4 check 6: a short property based run over every parser this
// package owns. This is random generation by fast-check, not coverage guided
// fuzzing; IMPLEMENTATION_DEVIATIONS.md records that (CE3).
import { fc, test } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import {
  CommandRequestSchema,
  CorrelationIdentifierSchema,
  ProviderReadResponseBodySchema,
  contractBounds,
  formatEntityTag,
  invalidFieldsFromZodError,
  parseCacheControlMaxAge,
  parseCommandRequestBody,
  parseEntityTag,
  parseProviderReadResponseBody,
  parseRetryAfterSeconds,
} from '../src/index';
import { syntheticReplaceCommand } from './support/synthetic-values';

const arbitraryText = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.json());
const arbitraryJsonValue = fc.jsonValue();

describe('the command body parser', () => {
  test.prop([arbitraryText])('never throws on arbitrary text', (rawBody) => {
    expect(() => parseCommandRequestBody(rawBody)).not.toThrow();
  });

  test.prop([arbitraryJsonValue])('accepts only values the schema accepts', (jsonValue) => {
    const parsed = parseCommandRequestBody(JSON.stringify(jsonValue));
    expect(parsed.outcome === 'accepted').toBe(CommandRequestSchema.safeParse(jsonValue).success);
  });

  test.prop([fc.string({ minLength: 12 }).filter((candidate) => /^[A-Za-z0-9]+$/.test(candidate))])(
    'never echoes a generated value in its invalid fields',
    (generatedValue) => {
      const hostileCommand = {
        ...syntheticReplaceCommand(),
        recordId: `${generatedValue}!`,
        baseVersion: `"${generatedValue}"`,
        [generatedValue]: generatedValue,
      };
      const parsed = parseCommandRequestBody(JSON.stringify(hostileCommand));
      expect(parsed.outcome).toBe('rejected');
      expect(JSON.stringify(parsed)).not.toContain(generatedValue);
    },
  );
});

describe('the provider response body parser', () => {
  test.prop([arbitraryText])('never throws on arbitrary text', (bodyText) => {
    expect(() => parseProviderReadResponseBody(bodyText)).not.toThrow();
  });

  test.prop([arbitraryJsonValue])('accepts only values the schema accepts', (jsonValue) => {
    const parsed = parseProviderReadResponseBody(JSON.stringify(jsonValue));
    expect(parsed.outcome === 'accepted').toBe(
      ProviderReadResponseBodySchema.safeParse(jsonValue).success,
    );
  });
});

describe('the provider header parsers', () => {
  test.prop([fc.option(fc.string(), { nil: undefined })])(
    'never throw on arbitrary values',
    (headerValue) => {
      expect(() => parseEntityTag(headerValue)).not.toThrow();
      expect(() => parseRetryAfterSeconds(headerValue)).not.toThrow();
      expect(() => parseCacheControlMaxAge(headerValue)).not.toThrow();
    },
  );

  test.prop([fc.stringMatching(/^[A-Za-z0-9._-]{1,128}$/)])(
    'read back every entity tag they format',
    (version) => {
      expect(parseEntityTag(formatEntityTag(version))).toEqual({ outcome: 'valid', version });
    },
  );

  test.prop([fc.string()])(
    'only ever return seconds within the Spec 00 §3.3 bounds',
    (headerValue) => {
      const retryAfter = parseRetryAfterSeconds(headerValue);
      if (retryAfter.outcome === 'valid') {
        expect(retryAfter.seconds).toBeLessThanOrEqual(
          contractBounds.providerRetryAfterMaximumSeconds,
        );
        expect(Number.isInteger(retryAfter.seconds)).toBe(true);
      }
      const maxAge = parseCacheControlMaxAge(headerValue);
      if (maxAge.outcome === 'valid') {
        expect(maxAge.seconds).toBeLessThanOrEqual(
          contractBounds.providerCacheMaxAgeMaximumSeconds,
        );
        expect(Number.isInteger(maxAge.seconds)).toBe(true);
      }
    },
  );

  test.prop([fc.integer({ min: 0, max: 86_400 })])(
    'read every max-age within the bound',
    (seconds) => {
      expect(parseCacheControlMaxAge(`max-age=${String(seconds)}`)).toEqual({
        outcome: 'valid',
        seconds,
      });
    },
  );
});

describe('the correlation identifier parser', () => {
  test.prop([fc.string({ unit: 'binary' })])('accepts nothing over its bound', (candidate) => {
    const parsed = CorrelationIdentifierSchema.safeParse(candidate);
    if (parsed.success) {
      expect(candidate.length).toBeLessThanOrEqual(
        contractBounds.correlationIdentifierMaximumCharacters,
      );
    }
  });

  test.prop([fc.ulid(), fc.uuid({ version: 4 })])(
    'accepts every ULID and UUID',
    (generatedUlid, generatedUuid) => {
      expect(CorrelationIdentifierSchema.safeParse(generatedUlid).success).toBe(true);
      expect(CorrelationIdentifierSchema.safeParse(generatedUuid).success).toBe(true);
    },
  );
});

describe('invalid field mapping', () => {
  test.prop([arbitraryJsonValue])(
    'never throws, whatever input the schema refused',
    (jsonValue) => {
      const parsed = CommandRequestSchema.safeParse(jsonValue);
      if (!parsed.success) {
        expect(() => invalidFieldsFromZodError(parsed.error, jsonValue)).not.toThrow();
      }
    },
  );
});
