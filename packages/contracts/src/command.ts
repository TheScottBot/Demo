import { z } from 'zod';
import { contractBounds } from './bounds';
import { ProviderVersionSchema, RecordIdentifierSchema } from './grammars';
import { invalidFieldsFromZodError, type InvalidField } from './invalid-fields';
import { parseJsonBodyWithinBound } from './json-body';
import { commandTypes } from './routing';
import {
  NotesAppendPayloadSchema,
  PreferencesSectionSchema,
  ScheduleSectionSchema,
  SummarySectionSchema,
  TasksSectionSchema,
} from './sections';

// Spec 00 §3.9. Each section accepts exactly one command type (§4.2), so the
// section alone selects the variant, and the payload is checked against that
// section's own shape (§3.7) in the same pass.
function replaceCommandSchema<Section extends string, Payload extends z.ZodType>(
  section: Section,
  payloadSchema: Payload,
) {
  return z.strictObject({
    type: z.literal(commandTypes.sectionReplace),
    recordId: RecordIdentifierSchema,
    section: z.literal(section),
    baseVersion: ProviderVersionSchema,
    payload: payloadSchema,
  });
}

export const CommandRequestSchema = z.discriminatedUnion('section', [
  replaceCommandSchema('summary', SummarySectionSchema),
  replaceCommandSchema('tasks', TasksSectionSchema),
  replaceCommandSchema('schedule', ScheduleSectionSchema),
  replaceCommandSchema('preferences', PreferencesSectionSchema),
  z.strictObject({
    type: z.literal(commandTypes.notesAppend),
    recordId: RecordIdentifierSchema,
    section: z.literal('notes'),
    baseVersion: ProviderVersionSchema,
    payload: NotesAppendPayloadSchema,
  }),
]);

export type CommandRequest = z.infer<typeof CommandRequestSchema>;

export type CommandRequestBodyParse =
  | { readonly outcome: 'accepted'; readonly command: CommandRequest }
  | { readonly outcome: 'rejected'; readonly reason: 'body-too-large' | 'body-not-json' }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'schema-invalid';
      readonly invalidFields: InvalidField[];
    };

export function parseCommandRequestBody(rawBody: string): CommandRequestBodyParse {
  const jsonBody = parseJsonBodyWithinBound(rawBody, contractBounds.commandRequestBodyMaximumBytes);
  if (jsonBody.outcome === 'too-large') {
    return { outcome: 'rejected', reason: 'body-too-large' };
  }
  if (jsonBody.outcome === 'not-json') {
    return { outcome: 'rejected', reason: 'body-not-json' };
  }
  const parsedCommand = CommandRequestSchema.safeParse(jsonBody.value);
  if (!parsedCommand.success) {
    return {
      outcome: 'rejected',
      reason: 'schema-invalid',
      invalidFields: invalidFieldsFromZodError(parsedCommand.error, jsonBody.value),
    };
  }
  return { outcome: 'accepted', command: parsedCommand.data };
}
