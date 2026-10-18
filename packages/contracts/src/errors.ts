import { z } from 'zod';
import { invalidFieldReasons, type InvalidField } from './invalid-fields';

// Spec 00 §3.6.

export const ErrorCodeSchema = z.enum([
  'validation-failed',
  'idempotency-key-required',
  'unauthorised',
  'forbidden',
  'not-found',
  'idempotency-key-reused',
  'throttled',
  'internal',
  'not-implemented',
  'all-sources-unavailable',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const errorCodeDefinitions: Record<
  ErrorCode,
  { readonly status: number; readonly title: string }
> = {
  'validation-failed': { status: 400, title: 'The request is not valid' },
  'idempotency-key-required': { status: 400, title: 'An idempotency key is required' },
  unauthorised: { status: 401, title: 'The request is not authenticated' },
  forbidden: { status: 403, title: 'The request lacks the required scope' },
  'not-found': { status: 404, title: 'The resource does not exist' },
  'idempotency-key-reused': {
    status: 422,
    title: 'The idempotency key was used for a different request',
  },
  throttled: { status: 429, title: 'Too many requests' },
  internal: { status: 500, title: 'The platform failed to answer' },
  'not-implemented': { status: 501, title: 'This route is not implemented in this stage' },
  'all-sources-unavailable': { status: 503, title: 'No provider could answer' },
};

export const problemTypeUriPrefix = 'https://errors.demo.local/';

export const ProblemDocumentSchema = z.strictObject({
  type: z.string().startsWith(problemTypeUriPrefix),
  title: z.string().min(1),
  status: z.int().min(400).max(599),
  detail: z.string().optional(),
  correlationId: z.string().min(1),
  invalidFields: z
    .array(z.strictObject({ path: z.string(), reason: z.enum(invalidFieldReasons) }))
    .optional(),
});

export type ProblemDocument = z.infer<typeof ProblemDocumentSchema>;

export interface DemoErrorOptions {
  invalidFields?: readonly InvalidField[];
  retryAfterSeconds?: number;
}

// The message is the error code and nothing else: an Error message tends to
// reach logs, and a message built from the request would carry input values
// there (datum 0.15). Why the request failed travels as reasonCategory, a
// fixed vocabulary chosen by the code that throws.
export class DemoError extends Error {
  readonly errorCode: ErrorCode;
  readonly reasonCategory: string;
  readonly invalidFields: readonly InvalidField[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(errorCode: ErrorCode, reasonCategory: string, options: DemoErrorOptions = {}) {
    super(errorCode);
    this.name = 'DemoError';
    this.errorCode = errorCode;
    this.reasonCategory = reasonCategory;
    this.invalidFields = options.invalidFields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function problemDocumentFor(demoError: DemoError, correlationId: string): ProblemDocument {
  const errorDefinition = errorCodeDefinitions[demoError.errorCode];
  return {
    type: `${problemTypeUriPrefix}${demoError.errorCode}`,
    title: errorDefinition.title,
    status: errorDefinition.status,
    correlationId,
    ...(demoError.invalidFields === undefined
      ? {}
      : { invalidFields: [...demoError.invalidFields] }),
  };
}
