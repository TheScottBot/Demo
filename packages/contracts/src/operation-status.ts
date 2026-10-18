import { z } from 'zod';
import {
  OperationIdentifierSchema,
  ProviderVersionSchema,
  RecordIdentifierSchema,
  TimestampSchema,
} from './grammars';
import { ProviderIdentifierSchema } from './routing';

// Spec 00 §3.10. Spec 03 §7 owns the transitions; this module owns the names
// and what each tells a client.

export const OperationStateSchema = z.enum([
  'ACCEPTED',
  'QUEUED',
  'APPLYING',
  'SUCCEEDED',
  'CONFLICT',
  'FAILED',
  'DEAD_LETTERED',
]);

export type OperationState = z.infer<typeof OperationStateSchema>;

export type OperationStateKind = 'in-progress' | 'awaiting-operator' | 'terminal';

const operationStateKinds: Record<OperationState, OperationStateKind> = {
  ACCEPTED: 'in-progress',
  QUEUED: 'in-progress',
  APPLYING: 'in-progress',
  DEAD_LETTERED: 'awaiting-operator',
  SUCCEEDED: 'terminal',
  CONFLICT: 'terminal',
  FAILED: 'terminal',
};

export function operationStateKind(state: OperationState): OperationStateKind {
  return operationStateKinds[state];
}

// Which detail object belongs to which state. Each detail appears exactly
// when its state does, so a client can rely on it being there.
const detailFieldForState: Partial<Record<OperationState, 'result' | 'conflict' | 'failure'>> = {
  SUCCEEDED: 'result',
  CONFLICT: 'conflict',
  FAILED: 'failure',
  DEAD_LETTERED: 'failure',
};

// Exported so the journal (Spec 03 §4.3) sets and clears details by the same
// rule the status schema checks them by.
export function operationDetailField(
  state: OperationState,
): 'result' | 'conflict' | 'failure' | undefined {
  return detailFieldForState[state];
}

export const OperationStatusSchema = z
  .strictObject({
    operationId: OperationIdentifierSchema,
    state: OperationStateSchema,
    recordId: RecordIdentifierSchema,
    providerId: ProviderIdentifierSchema,
    attempts: z.int().min(0),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    result: z.strictObject({ providerVersion: ProviderVersionSchema }).optional(),
    conflict: z
      .strictObject({ currentVersion: ProviderVersionSchema.optional(), reason: z.string().min(1) })
      .optional(),
    failure: z.strictObject({ code: z.string().min(1), reason: z.string().min(1) }).optional(),
  })
  .superRefine((operationStatus, refinementContext) => {
    const expectedDetailField = detailFieldForState[operationStatus.state];
    for (const detailField of ['result', 'conflict', 'failure'] as const) {
      const detailPresent = operationStatus[detailField] !== undefined;
      if (detailPresent !== (detailField === expectedDetailField)) {
        refinementContext.addIssue({
          code: 'custom',
          path: [detailField],
          params: { invalidFieldReason: detailPresent ? 'not-allowed-value' : 'missing' },
        });
      }
    }
  });

export type OperationStatus = z.infer<typeof OperationStatusSchema>;
