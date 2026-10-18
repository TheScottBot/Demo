import { describe, expect, it } from 'vitest';
import { CommandRequestSchema, parseCommandRequestBody } from '../src/index';
import {
  plantedSecretValue,
  syntheticAppendCommand,
  syntheticReplaceCommand,
  syntheticSections,
} from './support/synthetic-values';

describe('CommandRequest', () => {
  it.each(['summary', 'tasks', 'schedule', 'preferences'] as const)(
    'accepts a replace of the %s section with that section shape',
    (sectionName) => {
      const command = {
        ...syntheticReplaceCommand(),
        section: sectionName,
        payload: syntheticSections[sectionName],
      };
      expect(CommandRequestSchema.safeParse(command).success).toBe(true);
    },
  );

  it('accepts a notes append', () => {
    expect(CommandRequestSchema.safeParse(syntheticAppendCommand()).success).toBe(true);
  });

  it.each([
    [
      'a replace of the notes section',
      { ...syntheticReplaceCommand(), section: 'notes', payload: { text: 'x' } },
    ],
    ['an append to the summary section', { ...syntheticAppendCommand(), section: 'summary' }],
    [
      'a payload shaped for another section',
      { ...syntheticReplaceCommand(), payload: syntheticSections.tasks },
    ],
    ['an unknown command type', { ...syntheticReplaceCommand(), type: 'record.section.delete' }],
    ['an unknown section', { ...syntheticReplaceCommand(), section: 'attachments' }],
    ['an unknown top level key', { ...syntheticReplaceCommand(), priority: 'high' }],
    [
      'an unknown payload key',
      { ...syntheticReplaceCommand(), payload: { title: 'x', status: 'active', colour: 'red' } },
    ],
    ['a missing baseVersion', { ...syntheticReplaceCommand(), baseVersion: undefined }],
    [
      'a baseVersion of 129 characters',
      { ...syntheticReplaceCommand(), baseVersion: 'v'.repeat(129) },
    ],
    ['a quoted baseVersion', { ...syntheticReplaceCommand(), baseVersion: '"0123"' }],
    ['a recordId of 129 characters', { ...syntheticReplaceCommand(), recordId: 'r'.repeat(129) }],
    ['a missing payload', { ...syntheticAppendCommand(), payload: undefined }],
  ])('refuses %s', (_caseName, candidate) => {
    expect(CommandRequestSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('parseCommandRequestBody', () => {
  it('accepts a valid body', () => {
    const parsed = parseCommandRequestBody(JSON.stringify(syntheticReplaceCommand()));
    expect(parsed).toEqual({ outcome: 'accepted', command: syntheticReplaceCommand() });
  });

  it('refuses a body one byte over 65,536 before parsing it', () => {
    const oversizeBody = ' '.repeat(65_537);
    expect(parseCommandRequestBody(oversizeBody)).toEqual({
      outcome: 'rejected',
      reason: 'body-too-large',
    });
  });

  it('measures the bound in bytes, not characters', () => {
    const multibyteBody = 'é'.repeat(32_769);
    expect(parseCommandRequestBody(multibyteBody)).toEqual({
      outcome: 'rejected',
      reason: 'body-too-large',
    });
  });

  it('parses a body of exactly 65,536 bytes', () => {
    const command = JSON.stringify(syntheticReplaceCommand());
    const paddedBody = command + ' '.repeat(65_536 - command.length);
    expect(parseCommandRequestBody(paddedBody).outcome).toBe('accepted');
  });

  it('refuses a body that is not JSON', () => {
    expect(parseCommandRequestBody('{"type":')).toEqual({
      outcome: 'rejected',
      reason: 'body-not-json',
    });
  });

  it('refuses a schema breach and names the fields without their values', () => {
    const command = {
      ...syntheticReplaceCommand(),
      recordId: `${plantedSecretValue}/not-a-record`,
      [plantedSecretValue]: plantedSecretValue,
    };
    const parsed = parseCommandRequestBody(JSON.stringify(command));
    expect(parsed.outcome).toBe('rejected');
    if (parsed.outcome !== 'rejected' || parsed.reason !== 'schema-invalid') {
      throw new Error('expected a schema-invalid rejection');
    }
    expect(parsed.invalidFields).toEqual(
      expect.arrayContaining([
        { path: 'recordId', reason: 'grammar' },
        { path: '', reason: 'unknown-field' },
      ]),
    );
    expect(JSON.stringify(parsed)).not.toContain(plantedSecretValue);
  });
});
