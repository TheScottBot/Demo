import {
  ProviderIdentifierSchema,
  ProviderVersionSchema,
  contractBounds,
  type ProviderIdentifier,
} from '@demo/contracts';

// Spec 02 §4.2: the aggregate ETag, which this specification owns. A strong
// validator: "v1." then the unpadded base64url of a JSON object mapping each
// provider to its version, keys sorted. Clients treat it as opaque.
//
// Pure (Spec 02 §2): the encoding uses the web standard btoa and atob, so the
// module needs nothing beyond the language. Every value it encodes is ASCII
// (provider identifiers and the provider version grammar), which is what btoa
// requires.

export type VersionsByProvider = Partial<Record<ProviderIdentifier, string>>;

export type AggregateEntityTagRefusal =
  | 'too-long'
  | 'wildcard'
  | 'list'
  | 'weak-validator'
  | 'unquoted'
  | 'prefix'
  | 'base64'
  | 'json'
  | 'empty'
  | 'unknown-provider'
  | 'version-grammar'
  | 'not-canonical';

export type AggregateEntityTagParse =
  | { readonly outcome: 'valid'; readonly versionsByProvider: VersionsByProvider }
  | { readonly outcome: 'invalid'; readonly reason: AggregateEntityTagRefusal };

const versionPrefix = 'v1.';
const base64UrlCharacters = /^[A-Za-z0-9_-]+$/;

function toBase64Url(asciiText: string): string {
  return btoa(asciiText).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(encodedText: string): string | undefined {
  const standardAlphabet = encodedText.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standardAlphabet.padEnd(Math.ceil(standardAlphabet.length / 4) * 4, '=');
  try {
    return atob(padded);
  } catch {
    return undefined;
  }
}

function canonicalVersionsJson(versionsByProvider: VersionsByProvider): string {
  const sortedEntries = Object.entries(versionsByProvider).sort(
    ([firstProvider], [secondProvider]) =>
      firstProvider < secondProvider ? -1 : firstProvider > secondProvider ? 1 : 0,
  );
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function formatAggregateEntityTag(versionsByProvider: VersionsByProvider): string {
  const versions = Object.values(versionsByProvider);
  // §4.2 includes only providers that returned a version, and an ETag is never
  // emitted with none, so an empty set is a caller's mistake.
  if (versions.length === 0) {
    throw new Error('aggregate-entity-tag-empty');
  }
  if (!versions.every((version) => ProviderVersionSchema.safeParse(version).success)) {
    throw new Error('aggregate-entity-tag-version-outside-grammar');
  }
  return `"${versionPrefix}${toBase64Url(canonicalVersionsJson(versionsByProvider))}"`;
}

function isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

// §4.2: anything that is not exactly one value of this grammar is refused,
// including weak validators, lists, the wildcard, and a provider the routing
// table does not name. Every check is a refusal, never a repair (datum 0.10).
export function parseAggregateEntityTag(headerValue: string): AggregateEntityTagParse {
  const refuse = (reason: AggregateEntityTagRefusal): AggregateEntityTagParse => ({
    outcome: 'invalid',
    reason,
  });
  // The bound is checked before anything else reads the value.
  if (headerValue.length > contractBounds.ifNoneMatchMaximumCharacters) {
    return refuse('too-long');
  }
  if (headerValue.trim() === '*') {
    return refuse('wildcard');
  }
  // base64url has no comma, so a comma can only separate list members.
  if (headerValue.includes(',')) {
    return refuse('list');
  }
  if (headerValue.startsWith('W/')) {
    return refuse('weak-validator');
  }
  if (headerValue.length < 2 || !headerValue.startsWith('"') || !headerValue.endsWith('"')) {
    return refuse('unquoted');
  }
  const quotedContent = headerValue.slice(1, -1);
  if (!quotedContent.startsWith(versionPrefix)) {
    return refuse('prefix');
  }
  const encodedBody = quotedContent.slice(versionPrefix.length);
  if (!base64UrlCharacters.test(encodedBody)) {
    return refuse('base64');
  }
  const decodedBody = fromBase64Url(encodedBody);
  // Re-encoding must give back the same text: that refuses trailing bits and
  // lengths no encoder produces, which a decoder would otherwise let through.
  if (decodedBody === undefined || toBase64Url(decodedBody) !== encodedBody) {
    return refuse('base64');
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(decodedBody);
  } catch {
    return refuse('json');
  }
  if (
    !isPlainObject(parsedBody) ||
    !Object.values(parsedBody).every((version) => typeof version === 'string')
  ) {
    return refuse('json');
  }
  const versionEntries = Object.entries(parsedBody as Record<string, string>);
  if (versionEntries.length === 0) {
    return refuse('empty');
  }
  if (
    !versionEntries.every(([providerId]) => ProviderIdentifierSchema.safeParse(providerId).success)
  ) {
    return refuse('unknown-provider');
  }
  if (!versionEntries.every(([, version]) => ProviderVersionSchema.safeParse(version).success)) {
    return refuse('version-grammar');
  }
  const versionsByProvider = Object.fromEntries(versionEntries) as VersionsByProvider;
  // One canonical form only: key order and spacing must be exactly what
  // formatAggregateEntityTag writes, so two spellings never mean one ETag.
  if (formatAggregateEntityTag(versionsByProvider) !== headerValue) {
    return refuse('not-canonical');
  }
  return { outcome: 'valid', versionsByProvider };
}
