import { z } from 'zod';
import { TimestampSchema, UlidSchema } from './grammars';

// Spec 00 §3.7, adopted as written under CD6. Lengths are counted the way
// JavaScript counts them, in UTF-16 code units, which never admits more
// characters than the bound states (recorded in CONTRACT.md).

const sectionLabelSchema = z.string().min(1).max(200);

export const SummarySectionSchema = z.strictObject({
  title: z.string().min(1).max(200),
  status: z.enum(['active', 'paused', 'closed']),
});

export const TasksSectionSchema = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        taskId: z.string().min(1).max(64),
        label: sectionLabelSchema,
        done: z.boolean(),
      }),
    )
    .max(50),
});

export const ScheduleSectionSchema = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        startsAt: TimestampSchema,
        endsAt: TimestampSchema,
        label: sectionLabelSchema,
      }),
    )
    .max(50),
});

const noteTextSchema = z.string().min(1).max(1_000);

export const NotesSectionSchema = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        noteId: UlidSchema,
        writtenAt: TimestampSchema,
        text: noteTextSchema,
      }),
    )
    .max(100),
});

// A BCP 47 language tag, checked for shape only: a primary language of two or
// three letters, then subtags of one to eight letters or digits. Full RFC 5646
// validation needs the IANA registry, which a pure module cannot hold, and the
// platform relays the tag rather than interpreting it.
export const PreferencesSectionSchema = z.strictObject({
  contactWindow: z.enum(['morning', 'afternoon', 'evening']),
  language: z
    .string()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/),
});

export const NotesAppendPayloadSchema = z.strictObject({
  text: noteTextSchema,
});

export const SectionNameSchema = z.enum(['summary', 'tasks', 'schedule', 'notes', 'preferences']);

export const ReplaceableSectionNameSchema = SectionNameSchema.exclude(['notes']);

export const sectionSchemasBySectionName = {
  summary: SummarySectionSchema,
  tasks: TasksSectionSchema,
  schedule: ScheduleSectionSchema,
  notes: NotesSectionSchema,
  preferences: PreferencesSectionSchema,
} as const satisfies Record<SectionName, z.ZodType>;

export const SectionsPartialSchema = z.strictObject({
  summary: SummarySectionSchema.optional(),
  tasks: TasksSectionSchema.optional(),
  schedule: ScheduleSectionSchema.optional(),
  notes: NotesSectionSchema.optional(),
  preferences: PreferencesSectionSchema.optional(),
});

export type SectionName = z.infer<typeof SectionNameSchema>;
export type ReplaceableSectionName = z.infer<typeof ReplaceableSectionNameSchema>;
export type NotesAppendPayload = z.infer<typeof NotesAppendPayloadSchema>;
export type SummarySection = z.infer<typeof SummarySectionSchema>;
export type TasksSection = z.infer<typeof TasksSectionSchema>;
export type ScheduleSection = z.infer<typeof ScheduleSectionSchema>;
export type NotesSection = z.infer<typeof NotesSectionSchema>;
export type PreferencesSection = z.infer<typeof PreferencesSectionSchema>;

export interface SectionsBySectionName {
  summary: SummarySection;
  tasks: TasksSection;
  schedule: ScheduleSection;
  notes: NotesSection;
  preferences: PreferencesSection;
}
