// Spec 02 §4.2 and RE1: the aggregate ETag, the only validator a client sees.
// Its grammar is owned here, not in packages/contracts (Spec 02 §4.2).
import { fc, test } from '@fast-check/vitest';
import { contractBounds, providerIdentifiers } from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import { formatAggregateEntityTag, parseAggregateEntityTag } from '../src/aggregate-etag';

// Built here independently of the module under test, from Node's own Buffer.
function expectedEntityTag(canonicalJson: string): string {
  return `"v1.${Buffer.from(canonicalJson).toString('base64url')}"`;
}

function quotedBody(bodyText: string): string {
  return `"v1.${Buffer.from(bodyText).toString('base64url')}"`;
}

describe('formatAggregateEntityTag', () => {
  it('quotes v1. and the unpadded base64url of the versions, keys sorted', () => {
    expect(
      formatAggregateEntityTag({ 'provider-b': 'b-version.2', 'provider-a': 'a_version-1' }),
    ).toBe(expectedEntityTag('{"provider-a":"a_version-1","provider-b":"b-version.2"}'));
    expect(formatAggregateEntityTag({ 'provider-c': 'c' })).not.toContain('=');
  });

  it('refuses an empty set of versions and a version outside the provider grammar', () => {
    expect(() => formatAggregateEntityTag({})).toThrow();
    expect(() => formatAggregateEntityTag({ 'provider-a': 'a version' })).toThrow();
  });
});

describe('parseAggregateEntityTag', () => {
  it('reads back what it formats', () => {
    const versions = { 'provider-a': '0123456789abcdef', 'provider-c': 'fedcba9876543210' };
    expect(parseAggregateEntityTag(formatAggregateEntityTag(versions))).toEqual({
      outcome: 'valid',
      versionsByProvider: versions,
    });
  });

  const validTag = formatAggregateEntityTag({ 'provider-a': 'a1' });
  const validBody = validTag.slice('"v1.'.length, -1);

  it.each([
    ['a weak validator', `W/${validTag}`, 'weak-validator'],
    ['a list', `${validTag}, ${validTag}`, 'list'],
    ['a list without a space', `${validTag},${validTag}`, 'list'],
    ['the wildcard', '*', 'wildcard'],
    ['an unquoted value', validTag.slice(1, -1), 'unquoted'],
    ['a value quoted at one end only', validTag.slice(0, -1), 'unquoted'],
    ['an empty quoted value', '""', 'prefix'],
    ['another version prefix', `"v2.${validBody}"`, 'prefix'],
    ['a prefix without its dot', `"v1${validBody}"`, 'prefix'],
    ['standard base64 characters', `"v1.${validBody}+/"`, 'base64'],
    ['base64 padding', `"v1.${validBody}=="`, 'base64'],
    // 26 characters plus 3: a length that leaves 1 over a multiple of 4, which no
    // encoder produces. (Adding one character gives a decodable length.)
    ['a base64 length no encoding produces', `"v1.${validBody}AAA"`, 'base64'],
    ['a body that is not JSON', quotedBody('not json'), 'json'],
    ['JSON that is a list', quotedBody('["provider-a"]'), 'json'],
    ['a version that is not a string', quotedBody('{"provider-a":1}'), 'json'],
    ['a provider not in the routing table', quotedBody('{"provider-z":"a1"}'), 'unknown-provider'],
    [
      'a version outside the provider grammar',
      quotedBody('{"provider-a":"a 1"}'),
      'version-grammar',
    ],
    ['no versions at all', quotedBody('{}'), 'empty'],
    ['keys out of order', quotedBody('{"provider-b":"b1","provider-a":"a1"}'), 'not-canonical'],
    ['JSON with whitespace', quotedBody('{"provider-a": "a1"}'), 'not-canonical'],
    ['a value over the If-None-Match bound', `"v1.${'A'.repeat(1_024)}"`, 'too-long'],
  ])('refuses %s', (_caseName, headerValue, reason) => {
    expect(parseAggregateEntityTag(headerValue)).toEqual({ outcome: 'invalid', reason });
  });
});

const providerVersion = fc.stringMatching(/^[A-Za-z0-9._-]{1,128}$/);
const versionsArbitrary = fc
  .record(
    Object.fromEntries(
      providerIdentifiers.map((providerId) => [providerId, providerVersion]),
    ) as Record<(typeof providerIdentifiers)[number], fc.Arbitrary<string>>,
    { requiredKeys: [] },
  )
  .filter((versions) => Object.keys(versions).length > 0);

// Spec 00 §2.4 check 6: a property per parser.
describe('the aggregate ETag parser', () => {
  test.prop([versionsArbitrary])('reads back every set of versions it formats', (versions) => {
    const entityTag = formatAggregateEntityTag(versions);
    if (entityTag.length <= contractBounds.ifNoneMatchMaximumCharacters) {
      expect(parseAggregateEntityTag(entityTag)).toEqual({
        outcome: 'valid',
        versionsByProvider: versions,
      });
    } else {
      expect(parseAggregateEntityTag(entityTag)).toEqual({
        outcome: 'invalid',
        reason: 'too-long',
      });
    }
  });

  test.prop([fc.oneof(fc.string(), fc.string({ unit: 'binary' }))])(
    'never throws, and accepts only what it would itself format',
    (headerValue) => {
      const parsed = parseAggregateEntityTag(headerValue);
      if (parsed.outcome === 'valid') {
        expect(formatAggregateEntityTag(parsed.versionsByProvider)).toBe(headerValue);
      }
    },
  );
});
