// Spec 03 §8.1 and WE7: the inspect and resolve scripts, which only print
// what the decisions return and pass on the operator's answers.
import { describe, expect, it } from 'vitest';
import type { OperatorAction } from '../src/operator/dead-letter-decisions';
import type { DeadLetterOperator } from '../src/operator/dead-letter-operator';
import {
  parseOperatorStage,
  runDeadLetterInspection,
} from '../src/operator/dead-letter-inspect-script';
import { runDeadLetterResolution } from '../src/operator/dead-letter-resolve-script';

const deadLetteredView = {
  kind: 'operation' as const,
  messageId: 'm1',
  operationId: '01JB0000000000000000000801',
  tenantId: 'tenant-1',
  recordId: 'record-0001',
  providerId: 'provider-a' as const,
  state: 'DEAD_LETTERED' as const,
  attempts: 5,
  redriveCount: 0,
  lastErrorReason: 'server-error',
  createdAt: '2026-10-18T09:30:00.000Z',
  flagged: false,
};

function fakeOperator(views: unknown[]) {
  const resolved: [string, OperatorAction][] = [];
  const operator = {
    inspect: () => Promise.resolve(views),
    inspectMessages: () =>
      Promise.resolve(
        views.map((view, index) => ({
          message: {
            messageId: `m${String(index + 1)}`,
            receiptHandle: `r${String(index + 1)}`,
            body: '{}',
          },
          view,
        })),
      ),
    resolve: (message: { messageId: string }, action: OperatorAction) => {
      resolved.push([message.messageId, action]);
      return Promise.resolve(
        action === 'skip' ? 'skipped' : action === 'redrive' ? 'redriven' : 'discarded',
      );
    },
  } as unknown as DeadLetterOperator;
  return { operator, resolved };
}

describe('the scripts take a stage of dev, test or demo (§8.1)', () => {
  it.each(['dev', 'test', 'demo'] as const)('accepts %s', (stage) => {
    expect(parseOperatorStage(stage)).toBe(stage);
  });

  it.each(['stub', 'prod', undefined])('refuses %s', (stage) => {
    expect(() => parseOperatorStage(stage)).toThrow();
  });
});

describe('runDeadLetterInspection', () => {
  it('prints one line per dead letter and a count, and resolves nothing', async () => {
    const printed: string[] = [];
    const { operator, resolved } = fakeOperator([
      deadLetteredView,
      { ...deadLetteredView, messageId: 'm2', state: 'APPLYING', flagged: true },
    ]);
    await runDeadLetterInspection({ operator, print: (line) => printed.push(line) });
    expect(printed).toHaveLength(3);
    expect(printed[1]).toContain('NOT DEAD_LETTERED');
    expect(printed[2]).toBe('2 dead letters, 1 flagged');
    expect(resolved).toEqual([]);
  });
});

describe('runDeadLetterInspection, with a message it cannot read', () => {
  it('counts a message without an operation as flagged', async () => {
    const printed: string[] = [];
    const { operator } = fakeOperator([
      deadLetteredView,
      { kind: 'unreadable', messageId: 'm2', reason: 'not-json' },
    ]);
    await runDeadLetterInspection({ operator, print: (line) => printed.push(line) });
    expect(printed.at(-1)).toBe('2 dead letters, 1 flagged');
  });
});

describe('runDeadLetterResolution', () => {
  it('asks for each message, asks again on an answer it cannot use, and acts on each answer', async () => {
    const printed: string[] = [];
    const answers = ['maybe', 'r', 's'];
    const { operator, resolved } = fakeOperator([
      deadLetteredView,
      { ...deadLetteredView, messageId: 'm2' },
    ]);
    await runDeadLetterResolution({
      operator,
      print: (line) => printed.push(line),
      ask: () => Promise.resolve(answers.shift() ?? ''),
    });
    expect(resolved).toEqual([
      ['m1', 'redrive'],
      ['m2', 'skip'],
    ]);
    expect(printed.filter((line) => line.startsWith('unrecognised answer'))).toHaveLength(1);
    expect(
      printed.filter((line) => /^m[0-9]: (redriven|discarded|skipped|stopped)$/.test(line)),
    ).toEqual(['m1: redriven', 'm2: skipped']);
  });

  it('does not accept redrive for a message without an operation', async () => {
    const printed: string[] = [];
    const answers = ['r', 'd'];
    const { operator, resolved } = fakeOperator([
      { kind: 'unreadable', messageId: 'm1', reason: 'not-json' },
    ]);
    await runDeadLetterResolution({
      operator,
      print: (line) => printed.push(line),
      ask: () => Promise.resolve(answers.shift() ?? ''),
    });
    expect(resolved).toEqual([['m1', 'discard']]);
    expect(printed.some((line) => line.startsWith('unrecognised answer'))).toBe(true);
  });
});
