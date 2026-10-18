import { createHash } from 'node:crypto';
import { mockProviderBehaviour, type SectionsBySectionName } from '@demo/contracts';

// CQ7.6, decided 18 October 2026: the canonical form a mock provider hashes
// for its version. Object keys are sorted at every level so the same sections
// always give the same text, whatever order they were written in; list order
// is kept because it carries meaning (task and note order).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((element: unknown) => canonicalJson(element)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .sort(([firstKey], [secondKey]) => (firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0))
      .map(([fieldKey, fieldValue]) => `${JSON.stringify(fieldKey)}:${canonicalJson(fieldValue)}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

// Spec 00 §4.3: a hexadecimal prefix of the SHA-256 of the provider's own
// sections in canonical form, prefix length CU11.
export function computeProviderVersion(sections: Partial<SectionsBySectionName>): string {
  return createHash('sha256')
    .update(canonicalJson(sections))
    .digest('hex')
    .slice(0, mockProviderBehaviour.versionPrefixHexadecimalCharacters);
}
