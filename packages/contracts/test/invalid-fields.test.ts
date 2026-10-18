import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TimestampSchema, invalidFieldsFromZodError } from '../src/index';
import { plantedSecretValue } from './support/synthetic-values';

const exampleSchema = z.strictObject({
  title: z.string().min(1).max(5),
  tags: z.array(z.string()).max(1),
  count: z.int().max(3),
  status: z.enum(['active', 'closed']),
  nested: z.strictObject({ writtenAt: TimestampSchema }),
});

function invalidFieldsFor(candidate: unknown) {
  const parsed = exampleSchema.safeParse(candidate);
  if (parsed.success) {
    throw new Error('expected the candidate to be refused');
  }
  return invalidFieldsFromZodError(parsed.error, candidate);
}

const validCandidate = {
  title: 'abc',
  tags: [],
  count: 1,
  status: 'active',
  nested: { writtenAt: '2026-10-18T09:30:00.000Z' },
};

describe('invalidFieldsFromZodError', () => {
  // WE2 finding: zod already puts the discriminator in an invalid_union
  // issue's path, so the field is named once, at the top level and nested.
  it('names an unknown discriminator by its own path, once', () => {
    const variantSchema = z.discriminatedUnion('section', [
      z.strictObject({ section: z.literal('summary') }),
      z.strictObject({ section: z.literal('notes') }),
    ]);
    const topLevel = variantSchema.safeParse({ section: plantedSecretValue });
    const nested = z.strictObject({ command: variantSchema }).safeParse({
      command: { section: plantedSecretValue },
    });
    if (topLevel.success || nested.success) {
      throw new Error('expected both candidates to be refused');
    }
    expect(invalidFieldsFromZodError(topLevel.error, { section: plantedSecretValue })).toEqual([
      { path: 'section', reason: 'no-matching-variant' },
    ]);
    expect(
      invalidFieldsFromZodError(nested.error, { command: { section: plantedSecretValue } }),
    ).toEqual([{ path: 'command.section', reason: 'no-matching-variant' }]);
  });

  it('reports an unknown key at its enclosing path, never by its own name', () => {
    const invalidFields = invalidFieldsFor({
      ...validCandidate,
      nested: { ...validCandidate.nested, [plantedSecretValue]: 1 },
    });
    expect(invalidFields).toEqual([{ path: 'nested', reason: 'unknown-field' }]);
  });

  it('tells a missing field from a field of the wrong type', () => {
    expect(invalidFieldsFor({ ...validCandidate, title: undefined })).toEqual([
      { path: 'title', reason: 'missing' },
    ]);
    expect(invalidFieldsFor({ ...validCandidate, title: 7 })).toEqual([
      { path: 'title', reason: 'wrong-type' },
    ]);
  });

  it.each([
    ['a string over its maximum', { title: 'abcdef' }, { path: 'title', reason: 'too-long' }],
    ['a string under its minimum', { title: '' }, { path: 'title', reason: 'too-short' }],
    ['a list over its maximum', { tags: ['a', 'b'] }, { path: 'tags', reason: 'too-many' }],
    ['a number over its maximum', { count: 4 }, { path: 'count', reason: 'too-large' }],
    [
      'a value outside its set',
      { status: 'archived' },
      { path: 'status', reason: 'not-allowed-value' },
    ],
    [
      'a nested grammar breach',
      { nested: { writtenAt: '2026-02-30T00:00:00.000Z' } },
      { path: 'nested.writtenAt', reason: 'grammar' },
    ],
    ['a list element of the wrong type', { tags: [5] }, { path: 'tags.0', reason: 'wrong-type' }],
  ])('reports %s', (_caseName, override, expected) => {
    expect(invalidFieldsFor({ ...validCandidate, ...override })).toEqual([expected]);
  });

  it('prefixes every path when given a root path', () => {
    const parsed = exampleSchema.safeParse({ ...validCandidate, title: 'abcdef' });
    if (parsed.success) {
      throw new Error('expected the candidate to be refused');
    }
    expect(
      invalidFieldsFromZodError(parsed.error, { ...validCandidate, title: 'abcdef' }, 'payload'),
    ).toEqual([{ path: 'payload.title', reason: 'too-long' }]);
  });

  it('never carries an input value', () => {
    const invalidFields = invalidFieldsFor({
      title: plantedSecretValue,
      tags: [plantedSecretValue, plantedSecretValue],
      count: plantedSecretValue,
      status: plantedSecretValue,
      nested: { writtenAt: plantedSecretValue },
    });
    expect(invalidFields.length).toBeGreaterThan(0);
    expect(JSON.stringify(invalidFields)).not.toContain(plantedSecretValue);
  });
});
