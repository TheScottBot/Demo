import { createHash } from 'node:crypto';

// Spec 03 §3.1 step 6 and WD2: requestHash is the SHA-256, in hexadecimal, of
// the tenant and the body as JSON with object keys sorted at every depth, list
// order kept and no whitespace. Key order is the client's serialiser's choice
// and never a different command; any value change is. This module is pure.
//
// The mock providers' version (CQ7.6, packages/test-doubles) uses the same
// canonical form. It is deliberately not shared: that is a provider wire rule
// and this is intake's own, and they would change for different reasons
// (datum 0.7).

function canonicalJson(jsonValue: unknown): string {
  if (Array.isArray(jsonValue)) {
    return `[${jsonValue.map((element: unknown) => canonicalJson(element)).join(',')}]`;
  }
  if (typeof jsonValue === 'object' && jsonValue !== null) {
    const sortedEntries = Object.entries(jsonValue).sort(([firstKey], [secondKey]) =>
      firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0,
    );
    return `{${sortedEntries
      .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${canonicalJson(entryValue)}`)
      .join(',')}}`;
  }
  // A string, number, boolean or null: JSON's own form. A body is parsed
  // JSON, so nothing else can reach here.
  return JSON.stringify(jsonValue);
}

export function computeRequestHash(tenantId: string, body: unknown): string {
  return createHash('sha256').update(canonicalJson({ body, tenantId }), 'utf8').digest('hex');
}
