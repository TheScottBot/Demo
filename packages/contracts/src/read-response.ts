import { z } from 'zod';
import { ProviderVersionSchema, RecordIdentifierSchema, TimestampSchema } from './grammars';
import { ProviderIdentifierSchema } from './routing';
import { SectionsPartialSchema } from './sections';

// Spec 00 §3.8.

export const ProviderOutcomeStatusSchema = z.enum([
  'ok',
  'not-modified',
  'timeout',
  'error',
  'not-found',
]);

export const ProviderErrorReasonSchema = z.enum([
  'transport',
  'http-status',
  'version-mismatch',
  'body-too-large',
  'header-invalid',
  'schema-invalid',
]);

export type ProviderOutcomeStatus = z.infer<typeof ProviderOutcomeStatusSchema>;
export type ProviderErrorReason = z.infer<typeof ProviderErrorReasonSchema>;

const nonNegativeWholeNumberSchema = z.int().min(0);

// §3.8 states that the error reason is present only on an error, and that a
// provider version exists only when the provider answered ok or not-modified.
// Both are enforced here so no consumer has to repeat the rule.
export const SourceProvenanceSchema = z
  .strictObject({
    providerId: ProviderIdentifierSchema,
    status: ProviderOutcomeStatusSchema,
    errorReason: ProviderErrorReasonSchema.optional(),
    version: ProviderVersionSchema.optional(),
    fetchedAt: TimestampSchema,
    ttlSeconds: nonNegativeWholeNumberSchema,
    latencyMilliseconds: nonNegativeWholeNumberSchema,
  })
  .superRefine((provenance, refinementContext) => {
    if ((provenance.status === 'error') !== (provenance.errorReason !== undefined)) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['errorReason'],
        params: {
          invalidFieldReason: provenance.status === 'error' ? 'missing' : 'not-allowed-value',
        },
      });
    }
    const versionAllowed = provenance.status === 'ok' || provenance.status === 'not-modified';
    if (!versionAllowed && provenance.version !== undefined) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['version'],
        params: { invalidFieldReason: 'not-allowed-value' },
      });
    }
  });

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

export const SectionSourcesSchema = z.strictObject({
  summary: ProviderIdentifierSchema.optional(),
  tasks: ProviderIdentifierSchema.optional(),
  schedule: ProviderIdentifierSchema.optional(),
  notes: ProviderIdentifierSchema.optional(),
  preferences: ProviderIdentifierSchema.optional(),
});

export const DemoRecordSchema = z.strictObject({
  recordId: RecordIdentifierSchema,
  sections: SectionsPartialSchema,
  sectionSources: SectionSourcesSchema,
  updatedAt: TimestampSchema,
});

export type DemoRecord = z.infer<typeof DemoRecordSchema>;

export const ReadResponseSchema = z.strictObject({
  record: DemoRecordSchema,
  partial: z.boolean(),
  sources: z.array(SourceProvenanceSchema),
  servedFrom: z.enum(['live', 'server-cache']),
});

export type ReadResponse = z.infer<typeof ReadResponseSchema>;
