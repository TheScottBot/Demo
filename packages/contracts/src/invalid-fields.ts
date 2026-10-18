import type { z } from 'zod';

// Spec 00 §3.6: a problem document names the field and the reason, never the
// input value. zod's own issues are not safe to forward: an unknown key issue
// carries the caller's key names, and a message may quote the input. So every
// issue is mapped onto this fixed vocabulary, and paths are built only from
// the schema's own keys and list positions.
export const invalidFieldReasons = [
  'missing',
  'wrong-type',
  'unknown-field',
  'too-long',
  'too-short',
  'too-many',
  'too-few',
  'too-large',
  'too-small',
  'grammar',
  'not-allowed-value',
  'no-matching-variant',
  'invalid',
] as const;

export type InvalidFieldReason = (typeof invalidFieldReasons)[number];

export interface InvalidField {
  readonly path: string;
  readonly reason: InvalidFieldReason;
}

type ZodIssue = z.core.$ZodIssue;

function isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function isFieldAbsent(input: unknown, issuePath: readonly PropertyKey[]): boolean {
  let currentValue: unknown = input;
  for (const pathSegment of issuePath) {
    if (Array.isArray(currentValue) && typeof pathSegment === 'number') {
      currentValue = currentValue[pathSegment];
    } else if (isPlainObject(currentValue) && typeof pathSegment === 'string') {
      if (!Object.hasOwn(currentValue, pathSegment)) {
        return true;
      }
      currentValue = currentValue[pathSegment];
    } else {
      return false;
    }
  }
  return currentValue === undefined;
}

function sizeReason(origin: string, direction: 'over' | 'under'): InvalidFieldReason {
  if (origin === 'string') {
    return direction === 'over' ? 'too-long' : 'too-short';
  }
  if (origin === 'array' || origin === 'set') {
    return direction === 'over' ? 'too-many' : 'too-few';
  }
  return direction === 'over' ? 'too-large' : 'too-small';
}

function reasonForIssue(issue: ZodIssue, input: unknown): InvalidFieldReason {
  switch (issue.code) {
    case 'invalid_type':
      return isFieldAbsent(input, issue.path) ? 'missing' : 'wrong-type';
    case 'unrecognized_keys':
      return 'unknown-field';
    case 'too_big':
      return sizeReason(issue.origin, 'over');
    case 'too_small':
      return sizeReason(issue.origin, 'under');
    case 'invalid_format':
      return 'grammar';
    case 'invalid_value':
      return 'not-allowed-value';
    case 'invalid_union':
      return 'no-matching-variant';
    case 'custom': {
      const declaredReason: unknown = issue.params?.['invalidFieldReason'];
      return invalidFieldReasons.find((knownReason) => knownReason === declaredReason) ?? 'invalid';
    }
    default:
      return 'invalid';
  }
}

function joinPath(rootPath: string, issuePath: readonly PropertyKey[]): string {
  const segments = issuePath.map((pathSegment) => String(pathSegment));
  return [rootPath, ...segments].filter((segment) => segment.length > 0).join('.');
}

// The path of an unknown key is its enclosing object: the key's own name came
// from the caller. Every other path segment is a schema key or a list index.
// zod 4.6.7 already ends an unknown discriminator's path with the
// discriminator itself, whether the value is missing or wrong (run, 18
// October 2026), so no issue needs its path extended.
function pathForIssue(issue: ZodIssue, rootPath: string): string {
  return joinPath(rootPath, issue.path);
}

export function invalidFieldsFromZodError(
  zodError: z.ZodError,
  input: unknown,
  rootPath = '',
): InvalidField[] {
  const invalidFields: InvalidField[] = [];
  const seenFields = new Set<string>();
  for (const issue of zodError.issues) {
    const invalidField = {
      path: pathForIssue(issue, rootPath),
      reason: reasonForIssue(issue, input),
    };
    const fieldKey = `${invalidField.path}\u0000${invalidField.reason}`;
    if (!seenFields.has(fieldKey)) {
      seenFields.add(fieldKey);
      invalidFields.push(invalidField);
    }
  }
  return invalidFields;
}
