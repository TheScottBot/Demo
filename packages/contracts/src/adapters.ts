import { z } from 'zod';
import type { CommandRequest } from './command';
import { ProviderVersionSchema, TimestampSchema } from './grammars';
import { ProviderErrorReasonSchema } from './read-response';
import type { ProviderIdentifier } from './routing';
import { SectionsPartialSchema } from './sections';

// Spec 00 §4.1. The results are data and so are zod schemas; the adapters
// themselves are behaviour and so are interfaces, implemented in Specs 02
// and 03. An adapter maps every HTTP response to a result and never throws
// for one.

export const ProviderReadResultSchema = z
  .strictObject({
    outcome: z.enum(['ok', 'not-modified', 'not-found', 'error']),
    errorReason: ProviderErrorReasonSchema.optional(),
    version: ProviderVersionSchema.optional(),
    updatedAt: TimestampSchema.optional(),
    ttlSeconds: z.int().min(0),
    sections: SectionsPartialSchema.optional(),
  })
  .superRefine((readResult, refinementContext) => {
    if ((readResult.outcome === 'error') !== (readResult.errorReason !== undefined)) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['errorReason'],
        params: {
          invalidFieldReason: readResult.outcome === 'error' ? 'missing' : 'not-allowed-value',
        },
      });
    }
  });

export type ProviderReadResult = z.infer<typeof ProviderReadResultSchema>;

export const ApplyOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('applied'), providerVersion: ProviderVersionSchema }),
  z.strictObject({
    kind: z.literal('conflict'),
    currentVersion: ProviderVersionSchema.optional(),
    reason: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('rejected'),
    code: z.string().min(1),
    reason: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('retryable'),
    retryAfterMilliseconds: z.int().min(0).optional(),
    reason: z.string().min(1),
  }),
]);

export type ApplyOutcome = z.infer<typeof ApplyOutcomeSchema>;

export interface ProviderCallOptions {
  abortSignal: AbortSignal;
  correlationId: string;
}

export interface ReadAdapter {
  readonly providerId: ProviderIdentifier;
  read(
    readRequest: { tenantId: string; recordId: string; ifNoneMatchVersion?: string },
    callOptions: ProviderCallOptions,
  ): Promise<ProviderReadResult>;
}

export interface WriteAdapter {
  readonly providerId: ProviderIdentifier;
  apply(
    applyRequest: { tenantId: string; command: CommandRequest; idempotencyKey: string },
    callOptions: ProviderCallOptions,
  ): Promise<ApplyOutcome>;
}
