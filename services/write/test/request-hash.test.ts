// Spec 03 §3.1 step 6, WD2 and WE2: requestHash over the canonical form of the
// tenant and the body.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { computeRequestHash } from '../src/request-hash';

// Rebuilds a JSON value with every object's keys in a shuffled order, using
// the given permutation seed, so two values differ only in key order.
function reorderedKeys(jsonValue: unknown, seed: number): unknown {
  if (Array.isArray(jsonValue)) {
    return jsonValue.map((element) => reorderedKeys(element, seed));
  }
  if (typeof jsonValue === 'object' && jsonValue !== null) {
    const entries = Object.entries(jsonValue);
    const rotation = entries.length === 0 ? 0 : seed % entries.length;
    const rotated = [...entries.slice(rotation), ...entries.slice(0, rotation)].reverse();
    return Object.fromEntries(rotated.map(([key, value]) => [key, reorderedKeys(value, seed)]));
  }
  return jsonValue;
}

describe('computeRequestHash (WD2)', () => {
  it('is the SHA-256, in hexadecimal, of the tenant and body as JSON with sorted keys and no whitespace', () => {
    const expectedCanonicalForm =
      '{"body":{"baseVersion":"0123456789abcdef","payload":{"status":"active","title":"T"},"recordId":"record-0001"},"tenantId":"tenant-1"}';
    expect(
      computeRequestHash('tenant-1', {
        recordId: 'record-0001',
        payload: { title: 'T', status: 'active' },
        baseVersion: '0123456789abcdef',
      }),
    ).toBe(createHash('sha256').update(expectedCanonicalForm, 'utf8').digest('hex'));
  });

  it('keeps list order, so reordering a list changes the hash', () => {
    expect(computeRequestHash('tenant-1', { entries: [1, 2] })).not.toBe(
      computeRequestHash('tenant-1', { entries: [2, 1] }),
    );
  });

  it('binds the tenant, so the same body from another tenant hashes differently', () => {
    expect(computeRequestHash('tenant-1', { recordId: 'record-0001' })).not.toBe(
      computeRequestHash('tenant-2', { recordId: 'record-0001' }),
    );
  });

  test.prop([fc.jsonValue(), fc.nat()])(
    'never changes with key order, at any depth',
    (jsonValue, seed) => {
      expect(computeRequestHash('tenant-1', reorderedKeys(jsonValue, seed))).toBe(
        computeRequestHash('tenant-1', jsonValue),
      );
    },
  );

  test.prop([fc.jsonValue(), fc.jsonValue()])(
    'always changes when any value changes',
    (firstValue, secondValue) => {
      // Compared as JSON reads them back: a body arrives as JSON text, in which
      // -0 and 0 are the same number.
      fc.pre(
        !isDeepStrictEqual(
          JSON.parse(JSON.stringify(firstValue)),
          JSON.parse(JSON.stringify(secondValue)),
        ),
      );
      expect(computeRequestHash('tenant-1', firstValue)).not.toBe(
        computeRequestHash('tenant-1', secondValue),
      );
    },
  );
});
