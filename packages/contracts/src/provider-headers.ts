import { contractBounds } from './bounds';
import { ProviderVersionSchema } from './grammars';

// Provider response headers are untrusted (Spec 00 §4.1). Each parser here
// returns a result rather than throwing, refuses rather than truncates a value
// over its §3.3 bound, and is the one grammar both the adapters (parsing) and
// the mock providers (formatting) use, so the two cannot drift (datum 0.7).

export type HeaderParse<Value> =
  | ({ readonly outcome: 'valid' } & Value)
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'invalid' };

// A strong entity tag holding one provider version. Weak tags and lists are
// refused: the version is compared exactly in If-Match, so a weak tag would
// promise an equivalence the provider never offered.
export function formatEntityTag(providerVersion: string): string {
  if (!ProviderVersionSchema.safeParse(providerVersion).success) {
    throw new Error('provider-version-outside-grammar');
  }
  return `"${providerVersion}"`;
}

const maximumEntityTagCharacters = contractBounds.providerVersionMaximumCharacters + 2;

export function parseEntityTag(headerValue: string | undefined): HeaderParse<{ version: string }> {
  if (headerValue === undefined) {
    return { outcome: 'absent' };
  }
  if (
    headerValue.length > maximumEntityTagCharacters ||
    !headerValue.startsWith('"') ||
    !headerValue.endsWith('"')
  ) {
    return { outcome: 'invalid' };
  }
  const providerVersion = headerValue.slice(1, -1);
  return ProviderVersionSchema.safeParse(providerVersion).success
    ? { outcome: 'valid', version: providerVersion }
    : { outcome: 'invalid' };
}

// Whole seconds only. The HTTP date form of Retry-After is refused because
// §3.3 states the grammar as whole seconds.
const wholeSecondsPattern = /^\d{1,10}$/;

function parseWholeSecondsWithinBound(
  candidate: string,
  maximumSeconds: number,
): number | undefined {
  if (!wholeSecondsPattern.test(candidate)) {
    return undefined;
  }
  const seconds = Number(candidate);
  return seconds <= maximumSeconds ? seconds : undefined;
}

export function parseRetryAfterSeconds(
  headerValue: string | undefined,
): HeaderParse<{ seconds: number }> {
  if (headerValue === undefined) {
    return { outcome: 'absent' };
  }
  const seconds = parseWholeSecondsWithinBound(
    headerValue,
    contractBounds.providerRetryAfterMaximumSeconds,
  );
  return seconds === undefined ? { outcome: 'invalid' } : { outcome: 'valid', seconds };
}

// RFC 9111 directive names are case insensitive. A quoted max-age and a
// repeated max-age are both refused: RFC 9111 tells senders not to quote it,
// and two values leave no single answer to cache by.
export function parseCacheControlMaxAge(
  headerValue: string | undefined,
): HeaderParse<{ seconds: number }> {
  if (headerValue === undefined) {
    return { outcome: 'absent' };
  }
  const maxAgeValues = headerValue
    .split(',')
    .map((directive) => directive.trim())
    .filter((directive) => /^max-age(?:\s*=|$)/i.test(directive))
    .map((directive) => directive.slice('max-age'.length).replace(/^\s*=\s*/, ''));
  if (maxAgeValues.length === 0) {
    return { outcome: 'absent' };
  }
  const [maxAgeValue] = maxAgeValues;
  if (maxAgeValues.length > 1 || maxAgeValue === undefined) {
    return { outcome: 'invalid' };
  }
  const seconds = parseWholeSecondsWithinBound(
    maxAgeValue,
    contractBounds.providerCacheMaxAgeMaximumSeconds,
  );
  return seconds === undefined ? { outcome: 'invalid' } : { outcome: 'valid', seconds };
}
