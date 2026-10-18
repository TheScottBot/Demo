// Spec 03 §8 and WE7: every operator decision, held in one pure module.
import { describe, expect, it } from 'vitest';
import type { StoredOperation } from '../src/journal-store';
import {
  allowedOperatorActions,
  describeDeadLetter,
  formatDeadLetterLine,
  operatorDiscardFailure,
  operatorStepsFor,
  parseOperatorAnswer,
  redriveDeduplicationId,
} from '../src/operator/dead-letter-decisions';

const deadLetteredOperation: StoredOperation = {
  schemaVersion: 1,
  operationId: '01JB0000000000000000000801',
  tenantId: 'tenant-1',
  recordId: 'record-0001',
  providerId: 'provider-a',
  section: 'summary',
  commandType: 'record.section.replace',
  baseVersion: '0123456789abcdef',
  payload: { title: 'Synthetic summary', status: 'active' },
  idempotencyKey: '00000000-0000-4000-8000-000000000801',
  requestHash: 'a'.repeat(64),
  state: 'DEAD_LETTERED',
  attempts: 5,
  redriveCount: 0,
  createdAt: '2026-10-18T09:30:00.000Z',
  updatedAt: '2026-10-18T09:40:00.000Z',
  lastTransitionOrigin: 'worker',
  lastErrorReason: 'server-error',
  failure: { code: 'retries-exhausted', reason: 'server-error' },
  expiresAt: 1_794_907_800,
};

describe('describeDeadLetter (§8.1)', () => {
  it('shows the §8.1 fields of the operation a message names, flagging none when DEAD_LETTERED', () => {
    expect(
      describeDeadLetter(
        'synthetic-message-1',
        { outcome: 'accepted', operationId: '01JB0000000000000000000801' },
        deadLetteredOperation,
      ),
    ).toEqual({
      kind: 'operation',
      messageId: 'synthetic-message-1',
      operationId: '01JB0000000000000000000801',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
      providerId: 'provider-a',
      state: 'DEAD_LETTERED',
      attempts: 5,
      redriveCount: 0,
      lastErrorReason: 'server-error',
      createdAt: '2026-10-18T09:30:00.000Z',
      flagged: false,
    });
  });

  it('flags an operation in any other state, such as APPLYING after a timeout on the last receive (WU18)', () => {
    const view = describeDeadLetter(
      'synthetic-message-1',
      { outcome: 'accepted', operationId: '01JB0000000000000000000801' },
      { ...deadLetteredOperation, state: 'APPLYING', failure: undefined },
    );
    expect(view).toMatchObject({ kind: 'operation', state: 'APPLYING', flagged: true });
  });

  it('describes a message it cannot read, and one whose operation is gone', () => {
    expect(
      describeDeadLetter(
        'synthetic-message-1',
        { outcome: 'rejected', reason: 'not-json' },
        undefined,
      ),
    ).toEqual({ kind: 'unreadable', messageId: 'synthetic-message-1', reason: 'not-json' });
    expect(
      describeDeadLetter(
        'synthetic-message-1',
        { outcome: 'accepted', operationId: '01JB0000000000000000000899' },
        undefined,
      ),
    ).toEqual({
      kind: 'missing',
      messageId: 'synthetic-message-1',
      operationId: '01JB0000000000000000000899',
    });
  });

  it('prints one line per message, with no command field', () => {
    const line = formatDeadLetterLine(
      describeDeadLetter(
        'synthetic-message-1',
        { outcome: 'accepted', operationId: '01JB0000000000000000000801' },
        { ...deadLetteredOperation, state: 'APPLYING', failure: undefined },
      ),
    );
    for (const shown of [
      '01JB0000000000000000000801',
      'tenant-1',
      'record-0001',
      'provider-a',
      'APPLYING',
      'attempts 5',
      'redrives 0',
      'server-error',
      '2026-10-18T09:30:00.000Z',
      'NOT DEAD_LETTERED',
    ]) {
      expect(line).toContain(shown);
    }
    expect(line).not.toContain('Synthetic summary');
    expect(line).not.toContain('\n');
  });
});

describe('the operator actions (§8.2)', () => {
  it.each([
    ['r', 'redrive'],
    ['redrive', 'redrive'],
    [' D ', 'discard'],
    ['s', 'skip'],
  ] as const)('reads the answer %j as %s', (answer, action) => {
    expect(parseOperatorAnswer(answer)).toBe(action);
  });

  it.each(['', 'yes', 'delete', 'rd'])('refuses the answer %j', (answer) => {
    expect(parseOperatorAnswer(answer)).toBeUndefined();
  });

  it('offers redrive only for an operation, since a message without one has nothing to apply', () => {
    expect(
      allowedOperatorActions(
        describeDeadLetter(
          'm',
          { outcome: 'accepted', operationId: deadLetteredOperation.operationId },
          deadLetteredOperation,
        ),
      ),
    ).toEqual(['redrive', 'discard', 'skip']);
    expect(
      allowedOperatorActions({ kind: 'unreadable', messageId: 'm', reason: 'not-json' }),
    ).toEqual(['discard', 'skip']);
  });

  it('redrives in §8.2 order: move to QUEUED, send a new message, delete the dead letter', () => {
    expect(operatorStepsFor('redrive', 'operation')).toEqual([
      'move-to-queued',
      'send-redrive-message',
      'delete-dead-letter',
    ]);
  });

  it('discards in §8.2 order: move to FAILED, then delete the dead letter', () => {
    expect(operatorStepsFor('discard', 'operation')).toEqual([
      'move-to-failed',
      'delete-dead-letter',
    ]);
    expect(operatorDiscardFailure).toEqual({
      code: 'operator-discarded',
      reason: expect.any(String) as string,
    });
  });

  it('discards a message with no operation by deleting it alone, and skips by doing nothing', () => {
    expect(operatorStepsFor('discard', 'unreadable')).toEqual(['delete-dead-letter']);
    expect(operatorStepsFor('discard', 'missing')).toEqual(['delete-dead-letter']);
    expect(operatorStepsFor('skip', 'operation')).toEqual([]);
  });

  it('names a redrive message by operationId, #r and the stored redrive count, so a rerun sends the same one', () => {
    expect(redriveDeduplicationId('01JB0000000000000000000801', 1)).toBe(
      '01JB0000000000000000000801#r1',
    );
    expect(redriveDeduplicationId('01JB0000000000000000000801', 2)).toBe(
      '01JB0000000000000000000801#r2',
    );
  });
});
