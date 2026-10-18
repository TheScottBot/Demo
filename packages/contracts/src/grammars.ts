import { z } from 'zod';
import { contractBounds } from './bounds';

// Each grammar states its maximum before its pattern, so the length is checked
// first. The patterns are anchored and contain no nested repetition, so no
// input can make them backtrack.

const identifierCharacters = /^[A-Za-z0-9_-]+$/;

export const RecordIdentifierSchema = z
  .string()
  .max(contractBounds.recordIdentifierMaximumCharacters)
  .min(1)
  .regex(identifierCharacters);

export const TenantIdentifierSchema = z
  .string()
  .max(contractBounds.tenantIdentifierMaximumCharacters)
  .min(1)
  .regex(identifierCharacters);

// Crockford base 32, upper case only: the canonical ULID form. The first
// character is at most 7 because a ULID's 48 bit time cannot exceed it.
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const UlidSchema = z
  .string()
  .max(contractBounds.operationIdentifierCharacters)
  .regex(ulidPattern);

export const OperationIdentifierSchema = UlidSchema;

// RFC 9562 permits either case on input, so both are accepted.
const uuidPattern = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const uuidVersion4Pattern =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/;

export const CorrelationIdentifierSchema = z
  .string()
  .max(contractBounds.correlationIdentifierMaximumCharacters)
  .refine((candidate) => ulidPattern.test(candidate) || uuidPattern.test(candidate), {
    params: { invalidFieldReason: 'grammar' },
  });

export const IdempotencyKeySchema = z
  .string()
  .max(contractBounds.idempotencyKeyCharacters)
  .regex(uuidVersion4Pattern);

// The unquoted provider version. It travels quoted, as an entity tag, on the
// wire (see provider-headers.ts); the quotes are never part of the value.
export const ProviderVersionSchema = z
  .string()
  .max(contractBounds.providerVersionMaximumCharacters)
  .min(1)
  .regex(/^[A-Za-z0-9._-]+$/);

// Spec 00 §2.3: ISO 8601 UTC with milliseconds. The pattern fixes the form;
// the round trip through Date refuses a well formed but impossible date such
// as 30 February, which the pattern alone would let through.
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const TimestampSchema = z
  .string()
  .max(24)
  .regex(timestampPattern)
  .refine(
    (candidate) => {
      const parsedTime = Date.parse(candidate);
      return !Number.isNaN(parsedTime) && new Date(parsedTime).toISOString() === candidate;
    },
    { params: { invalidFieldReason: 'grammar' } },
  );

// RFC 6749 §3.3 scope-token: printable ASCII except space, quotation mark and
// backslash.
export const scopeNamePattern = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
