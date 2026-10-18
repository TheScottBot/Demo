// Spec 00 §3.3 is the only statement of these bounds (CU10, adopted by the
// author on 18 October 2026). Every service imports them from here and checks
// each one before the input is copied, decoded or parsed (datum 0.10).
export const contractBounds = {
  commandRequestBodyMaximumBytes: 65_536,
  providerResponseBodyMaximumBytes: 262_144,
  recordIdentifierMaximumCharacters: 128,
  tenantIdentifierMaximumCharacters: 64,
  scopeClaimMaximumCharacters: 1_024,
  operationIdentifierCharacters: 26,
  correlationIdentifierMaximumCharacters: 64,
  idempotencyKeyCharacters: 36,
  ifNoneMatchMaximumCharacters: 1_024,
  providerVersionMaximumCharacters: 128,
  providerRetryAfterMaximumSeconds: 3_600,
  providerCacheMaxAgeMaximumSeconds: 86_400,
  queueMessageBodyMaximumBytes: 256,
} as const;

// Not in the §3.3 table as drafted: the author set this bound on 18 October
// 2026 (CU10), so it is kept apart from the table it does not appear in.
export const authenticationClaimBounds = {
  subjectClaimMaximumCharacters: 255,
} as const;

const utf8Encoder = new TextEncoder();

// Body bounds are stated in bytes as received, so a body of multibyte
// characters reaches its bound sooner than its length suggests.
export function measureUtf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength;
}

export function isWithinByteBound(text: string, maximumBytes: number): boolean {
  // A UTF-8 encoding is never shorter than the UTF-16 length, so a string
  // already longer than the bound is refused without encoding it.
  if (text.length > maximumBytes) {
    return false;
  }
  return measureUtf8ByteLength(text) <= maximumBytes;
}
