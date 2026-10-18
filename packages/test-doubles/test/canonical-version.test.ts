import { createHash } from 'node:crypto';
import { mockProviderBehaviour } from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson, computeProviderVersion } from '../src/index';

// CQ7.6: keys sorted at every level, list order kept, no whitespace.
describe('canonicalJson', () => {
  it('sorts object keys at every level and keeps list order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: true, c: 'x' }, { c: 'y' }] })).toBe(
      '{"a":[{"c":"x","d":true},{"c":"y"}],"b":1}',
    );
  });

  it('gives the same text whatever order the keys were written in', () => {
    expect(canonicalJson({ title: 't', status: 'active' })).toBe(
      canonicalJson({ status: 'active', title: 't' }),
    );
  });

  it('treats a reordered list as different', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('leaves out an absent optional field rather than writing it', () => {
    expect(canonicalJson({ present: 'yes', absent: undefined })).toBe('{"present":"yes"}');
  });

  it('escapes strings exactly as JSON does', () => {
    expect(canonicalJson({ text: 'a "quoted" line\nbreak' })).toBe(
      JSON.stringify({ text: 'a "quoted" line\nbreak' }),
    );
  });
});

describe('computeProviderVersion', () => {
  const sections = { summary: { title: 'Synthetic summary', status: 'active' } } as const;

  it('is the CU11 prefix of the SHA-256 of the canonical sections', () => {
    const expectedVersion = createHash('sha256')
      .update('{"summary":{"status":"active","title":"Synthetic summary"}}')
      .digest('hex')
      .slice(0, mockProviderBehaviour.versionPrefixHexadecimalCharacters);
    expect(computeProviderVersion(sections)).toBe(expectedVersion);
    expect(computeProviderVersion(sections)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when any section value changes', () => {
    expect(computeProviderVersion(sections)).not.toBe(
      computeProviderVersion({ summary: { title: 'Synthetic summary', status: 'closed' } }),
    );
  });
});
