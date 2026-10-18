import { describe, expect, it } from 'vitest';
import {
  NotesAppendPayloadSchema,
  ReplaceableSectionNameSchema,
  SectionNameSchema,
  SectionsPartialSchema,
  sectionSchemasBySectionName,
} from '../src/index';
import { syntheticSections, syntheticTimestamp, syntheticUlid } from './support/synthetic-values';

describe('section names', () => {
  it('are exactly the five Spec 00 §3.7 sections', () => {
    expect(SectionNameSchema.options).toEqual([
      'summary',
      'tasks',
      'schedule',
      'notes',
      'preferences',
    ]);
  });

  it('make every section replaceable except notes', () => {
    expect(ReplaceableSectionNameSchema.options).toEqual([
      'summary',
      'tasks',
      'schedule',
      'preferences',
    ]);
  });
});

describe.each(SectionNameSchema.options)('the %s section schema', (sectionName) => {
  const sectionSchema = sectionSchemasBySectionName[sectionName];
  const validSection = syntheticSections[sectionName];

  it('accepts the synthetic section', () => {
    expect(sectionSchema.safeParse(validSection).success).toBe(true);
  });

  it('refuses an unknown key', () => {
    expect(sectionSchema.safeParse({ ...validSection, unexpected: true }).success).toBe(false);
  });

  it('refuses a missing required field', () => {
    expect(sectionSchema.safeParse({}).success).toBe(false);
  });
});

function repeatedEntries<T>(entry: T, count: number): T[] {
  return Array.from({ length: count }, () => entry);
}

const taskEntry = syntheticSections.tasks.entries[0];
const scheduleEntry = syntheticSections.schedule.entries[0];
const noteEntry = syntheticSections.notes.entries[0];

describe('section bounds', () => {
  it.each([
    ['summary title at 200', { title: 'x'.repeat(200), status: 'active' }, true],
    ['summary title at 201', { title: 'x'.repeat(201), status: 'active' }, false],
    ['summary title empty', { title: '', status: 'active' }, false],
    ['summary status outside the set', { title: 'Title', status: 'archived' }, false],
  ])('summary: %s', (_caseName, candidate, expected) => {
    expect(sectionSchemasBySectionName.summary.safeParse(candidate).success).toBe(expected);
  });

  it.each([
    ['50 entries', { entries: repeatedEntries(taskEntry, 50) }, true],
    ['51 entries', { entries: repeatedEntries(taskEntry, 51) }, false],
    ['no entries', { entries: [] }, true],
    ['taskId at 65', { entries: [{ ...taskEntry, taskId: 'x'.repeat(65) }] }, false],
    ['taskId empty', { entries: [{ ...taskEntry, taskId: '' }] }, false],
    ['label at 201', { entries: [{ ...taskEntry, label: 'x'.repeat(201) }] }, false],
    ['done not a boolean', { entries: [{ ...taskEntry, done: 'false' }] }, false],
    ['an unknown key in an entry', { entries: [{ ...taskEntry, priority: 1 }] }, false],
  ])('tasks: %s', (_caseName, candidate, expected) => {
    expect(sectionSchemasBySectionName.tasks.safeParse(candidate).success).toBe(expected);
  });

  it.each([
    ['50 entries', { entries: repeatedEntries(scheduleEntry, 50) }, true],
    ['51 entries', { entries: repeatedEntries(scheduleEntry, 51) }, false],
    ['label at 201', { entries: [{ ...scheduleEntry, label: 'x'.repeat(201) }] }, false],
    [
      'startsAt without milliseconds',
      { entries: [{ ...scheduleEntry, startsAt: '2026-10-18T09:30:00Z' }] },
      false,
    ],
  ])('schedule: %s', (_caseName, candidate, expected) => {
    expect(sectionSchemasBySectionName.schedule.safeParse(candidate).success).toBe(expected);
  });

  it.each([
    ['100 entries', { entries: repeatedEntries(noteEntry, 100) }, true],
    ['101 entries', { entries: repeatedEntries(noteEntry, 101) }, false],
    ['text at 1,000', { entries: [{ ...noteEntry, text: 'x'.repeat(1_000) }] }, true],
    ['text at 1,001', { entries: [{ ...noteEntry, text: 'x'.repeat(1_001) }] }, false],
    ['noteId not a ULID', { entries: [{ ...noteEntry, noteId: 'note-1' }] }, false],
    [
      'writtenAt not a timestamp',
      { entries: [{ noteId: syntheticUlid, writtenAt: 'yesterday', text: 'x' }] },
      false,
    ],
  ])('notes: %s', (_caseName, candidate, expected) => {
    expect(sectionSchemasBySectionName.notes.safeParse(candidate).success).toBe(expected);
  });

  it.each([
    ['language en-GB', 'en-GB', true],
    ['language zh-Hant-TW', 'zh-Hant-TW', true],
    ['language at 35 characters', 'en-' + 'abcdefgh-'.repeat(3) + 'abcde', true],
    ['language at 36 characters', 'en-' + 'abcdefgh-'.repeat(3) + 'abcdef', false],
    ['language of one character', 'e', false],
    ['language with an underscore', 'en_GB', false],
    ['language with a trailing hyphen', 'en-', false],
    ['language with an empty subtag', 'en--GB', false],
    ['language starting with digits', '123', false],
    ['language with a nine character subtag', 'en-abcdefghi', false],
  ])('preferences: %s', (_caseName, language, expected) => {
    expect(
      sectionSchemasBySectionName.preferences.safeParse({ contactWindow: 'evening', language })
        .success,
    ).toBe(expected);
  });

  it('preferences: refuses a contact window outside the set', () => {
    expect(
      sectionSchemasBySectionName.preferences.safeParse({ contactWindow: 'night', language: 'en' })
        .success,
    ).toBe(false);
  });
});

describe('the partial sections object', () => {
  it('accepts any subset of sections', () => {
    expect(SectionsPartialSchema.safeParse({}).success).toBe(true);
    expect(SectionsPartialSchema.safeParse({ summary: syntheticSections.summary }).success).toBe(
      true,
    );
    expect(SectionsPartialSchema.safeParse(syntheticSections).success).toBe(true);
  });

  it('refuses a section name outside the five', () => {
    expect(SectionsPartialSchema.safeParse({ attachments: {} }).success).toBe(false);
  });
});

describe('NotesAppendPayload', () => {
  it.each([
    ['one character', { text: 'x' }, true],
    ['1,000 characters', { text: 'x'.repeat(1_000) }, true],
    ['1,001 characters', { text: 'x'.repeat(1_001) }, false],
    ['empty text', { text: '' }, false],
    ['missing text', {}, false],
    ['an unknown key', { text: 'x', writtenAt: syntheticTimestamp }, false],
  ])('%s', (_caseName, candidate, expected) => {
    expect(NotesAppendPayloadSchema.safeParse(candidate).success).toBe(expected);
  });
});
