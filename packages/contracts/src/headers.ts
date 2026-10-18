// Spec 00 §3.4 and the provider facing headers of §4.3: every header name the
// family uses, declared once. The gateway's CORS lists (Spec 01) and every
// handler and adapter derive from these.

export interface HeaderDefinition {
  // The canonical name, as written on responses and in CORS lists.
  readonly wireName: string;
  readonly direction: 'request' | 'response' | 'both';
  readonly boundary: 'public-api' | 'provider';
}

export const httpHeaders = {
  authorization: { wireName: 'Authorization', direction: 'request', boundary: 'public-api' },
  contentType: { wireName: 'Content-Type', direction: 'both', boundary: 'public-api' },
  correlationIdentifier: {
    wireName: 'X-Correlation-Id',
    direction: 'both',
    boundary: 'public-api',
  },
  idempotencyKey: { wireName: 'Idempotency-Key', direction: 'request', boundary: 'public-api' },
  ifNoneMatch: { wireName: 'If-None-Match', direction: 'request', boundary: 'public-api' },
  entityTag: { wireName: 'ETag', direction: 'response', boundary: 'public-api' },
  location: { wireName: 'Location', direction: 'response', boundary: 'public-api' },
  idempotentReplayed: {
    wireName: 'Idempotent-Replayed',
    direction: 'response',
    boundary: 'public-api',
  },
  retryAfter: { wireName: 'Retry-After', direction: 'response', boundary: 'public-api' },
  cacheControl: { wireName: 'Cache-Control', direction: 'response', boundary: 'public-api' },
  vary: { wireName: 'Vary', direction: 'response', boundary: 'public-api' },
  providerApiKey: { wireName: 'X-Api-Key', direction: 'request', boundary: 'provider' },
  ifMatch: { wireName: 'If-Match', direction: 'request', boundary: 'provider' },
  providerContract: {
    wireName: 'Demo-Provider-Contract',
    direction: 'response',
    boundary: 'provider',
  },
} as const satisfies Record<string, HeaderDefinition>;

export const headerValues = {
  jsonMediaType: 'application/json',
  problemMediaType: 'application/problem+json',
  // §3.4: command and status routes must not be cached anywhere.
  noStore: 'no-store',
  idempotentReplayed: 'true',
} as const;

// Payload format 2.0 delivers every header name in lower case (CU3).
export function headerLookupKey(headerDefinition: HeaderDefinition): string {
  return headerDefinition.wireName.toLowerCase();
}

export function readRequestHeader(
  requestHeaders: Readonly<Record<string, string | undefined>>,
  headerDefinition: HeaderDefinition,
): string | undefined {
  return requestHeaders[headerLookupKey(headerDefinition)];
}
