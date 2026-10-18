// Spec 03 §8.2 and WE7: the operator actions against the journal (the fake
// table behind aws-sdk-client-mock) and the queues, including a partial
// failure after each step and the rerun that finishes it.
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatCommandMessage } from '../src/command-queue';
import { createJournalStore, type JournalStore } from '../src/journal-store';
import { messageGroupFor } from '../src/message-group';
import {
  createDeadLetterOperator,
  createSqsDeadLetterQueue,
  type DeadLetterMessage,
  type DeadLetterQueue,
  type OperatorLog,
  type OperatorMetrics,
} from '../src/operator/dead-letter-operator';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';
import {
  createRecordingCommandQueue,
  newOperation,
  type RecordingCommandQueue,
} from './support/write-path-fixtures';

class RecordingOperator implements OperatorLog, OperatorMetrics {
  readonly events: unknown[][] = [];
  recordOperatorAction(details: {
    operationId: string | undefined;
    action: string;
    outcome: string;
  }): void {
    this.events.push(['actionLog', details.operationId ?? null, details.action, details.outcome]);
  }
  countOperatorAction(action: string, outcome: string): void {
    this.events.push(['OperatorAction', action, outcome]);
  }
}

// A dead letter queue that keeps its messages, and can fail a delete once.
function createRecordingDeadLetterQueue(messages: DeadLetterMessage[]) {
  const deleted: string[] = [];
  let failNextDelete: Error | undefined;
  const queue: DeadLetterQueue = {
    receiveMessages: () => Promise.resolve([...messages]),
    deleteMessage: (receiptHandle) => {
      if (failNextDelete !== undefined) {
        const failure = failNextDelete;
        failNextDelete = undefined;
        return Promise.reject(failure);
      }
      deleted.push(receiptHandle);
      return Promise.resolve();
    },
  };
  return {
    queue,
    deleted,
    failNextDelete: (failure: Error) => {
      failNextDelete = failure;
    },
  };
}

const operationId = '01JB0000000000000000000101';
let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
let recorder: RecordingOperator;

beforeEach(async () => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingOperator();
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: () => undefined },
    metrics: { countStaleTransition: () => undefined, countJournalItemRejected: () => undefined },
    now: () => new Date('2026-10-18T09:30:00.000Z'),
  });
  await journalStore.createOperation(newOperation());
  await journalStore.transitionOperation({
    operationId,
    targetState: 'APPLYING',
    origin: 'worker',
  });
  await journalStore.transitionOperation({
    operationId,
    targetState: 'APPLYING',
    origin: 'worker',
  });
  await journalStore.transitionOperation({
    operationId,
    targetState: 'DEAD_LETTERED',
    origin: 'worker',
    detail: { failure: { code: 'retries-exhausted', reason: 'server-error' } },
  });
});

afterEach(() => {
  journalTable.restore();
});

const deadLetter: DeadLetterMessage = {
  messageId: 'synthetic-dead-letter-1',
  receiptHandle: 'receipt-dead-letter-1',
  body: formatCommandMessage(operationId),
};

function operatorWith(commandQueue: RecordingCommandQueue, deadLetterQueue: DeadLetterQueue) {
  return createDeadLetterOperator({
    journalStore,
    commandQueue,
    deadLetterQueue,
    operatorLog: recorder,
    operatorMetrics: recorder,
  });
}

function storedOperation() {
  return journalTable.itemAt(`OP#${operationId}`, 'OP');
}

describe('inspect (§8.1)', () => {
  it('lists the dead letters with their operations, deleting none', async () => {
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    const views = await operatorWith(
      createRecordingCommandQueue(),
      deadLetterQueue.queue,
    ).inspect();
    expect(views).toEqual([
      expect.objectContaining({
        kind: 'operation',
        operationId,
        state: 'DEAD_LETTERED',
        attempts: 2,
        flagged: false,
      }),
    ]);
    expect(deadLetterQueue.deleted).toEqual([]);
    expect(recorder.events).toEqual([]);
  });
});

describe('redrive (§8.2)', () => {
  it('moves to QUEUED with origin operator, sends a new message, then deletes the dead letter', async () => {
    const commandQueue = createRecordingCommandQueue();
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    expect(
      await operatorWith(commandQueue, deadLetterQueue.queue).resolve(deadLetter, 'redrive'),
    ).toBe('redriven');
    expect(storedOperation()).toMatchObject({
      state: 'QUEUED',
      lastTransitionOrigin: 'operator',
      redriveCount: 1,
      // §8.2: attempts are never reset.
      attempts: 2,
    });
    expect(commandQueue.sent).toEqual([
      {
        body: formatCommandMessage(operationId),
        messageGroupId: messageGroupFor('tenant-1', 'record-0001'),
        messageDeduplicationId: `${operationId}#r1`,
      },
    ]);
    expect(deadLetterQueue.deleted).toEqual(['receipt-dead-letter-1']);
    // §8.2: each action logged once, with operationId, action and outcome.
    expect(recorder.events).toEqual([
      ['actionLog', operationId, 'redrive', 'redriven'],
      ['OperatorAction', 'redrive', 'redriven'],
    ]);
  });

  it('finishes on a rerun after the send failed, reusing the stored redrive count', async () => {
    const failingQueue = createRecordingCommandQueue({
      failWith: new Error('ThrottlingException'),
    });
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    await expect(
      operatorWith(failingQueue, deadLetterQueue.queue).resolve(deadLetter, 'redrive'),
    ).rejects.toThrow('ThrottlingException');
    expect(storedOperation()).toMatchObject({ state: 'QUEUED', redriveCount: 1 });
    expect(deadLetterQueue.deleted).toEqual([]);
    const commandQueue = createRecordingCommandQueue();
    expect(
      await operatorWith(commandQueue, deadLetterQueue.queue).resolve(deadLetter, 'redrive'),
    ).toBe('redriven');
    expect(storedOperation()).toMatchObject({ state: 'QUEUED', redriveCount: 1, attempts: 2 });
    expect(commandQueue.sent.map((message) => message.messageDeduplicationId)).toEqual([
      `${operationId}#r1`,
    ]);
    expect(deadLetterQueue.deleted).toEqual(['receipt-dead-letter-1']);
  });

  it('finishes on a rerun after the delete failed, sending the same message again for SQS to drop', async () => {
    const firstQueue = createRecordingCommandQueue();
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    deadLetterQueue.failNextDelete(new Error('ReceiptHandleIsInvalid'));
    await expect(
      operatorWith(firstQueue, deadLetterQueue.queue).resolve(deadLetter, 'redrive'),
    ).rejects.toThrow('ReceiptHandleIsInvalid');
    const secondQueue = createRecordingCommandQueue();
    expect(
      await operatorWith(secondQueue, deadLetterQueue.queue).resolve(deadLetter, 'redrive'),
    ).toBe('redriven');
    expect(
      [...firstQueue.sent, ...secondQueue.sent].map((message) => message.messageDeduplicationId),
    ).toEqual([`${operationId}#r1`, `${operationId}#r1`]);
    expect(storedOperation()).toMatchObject({ redriveCount: 1 });
    expect(deadLetterQueue.deleted).toEqual(['receipt-dead-letter-1']);
  });

  it('accepts an operation left APPLYING, which inspect flags (WU18)', async () => {
    journalTable.putItem({
      ...Object.fromEntries(
        Object.entries(storedOperation() ?? {}).filter(
          ([attributeName]) => attributeName !== 'failure',
        ),
      ),
      state: 'APPLYING',
    });
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    const operator = operatorWith(createRecordingCommandQueue(), deadLetterQueue.queue);
    expect((await operator.inspect())[0]).toMatchObject({ state: 'APPLYING', flagged: true });
    expect(await operator.resolve(deadLetter, 'redrive')).toBe('redriven');
    expect(storedOperation()).toMatchObject({ state: 'QUEUED', redriveCount: 1 });
  });

  it('stops, deleting nothing, when the operation is in a state no operator action starts from', async () => {
    journalTable.putItem({
      ...Object.fromEntries(
        Object.entries(storedOperation() ?? {}).filter(
          ([attributeName]) => attributeName !== 'failure',
        ),
      ),
      state: 'SUCCEEDED',
      result: { providerVersion: 'fedcba9876543210' },
    });
    const commandQueue = createRecordingCommandQueue();
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    expect(
      await operatorWith(commandQueue, deadLetterQueue.queue).resolve(deadLetter, 'redrive'),
    ).toBe('stopped');
    expect(commandQueue.sent).toEqual([]);
    expect(deadLetterQueue.deleted).toEqual([]);
    expect(recorder.events).toEqual([
      ['actionLog', operationId, 'redrive', 'stopped'],
      ['OperatorAction', 'redrive', 'stopped'],
    ]);
  });
});

describe('discard (§8.2)', () => {
  it('moves to FAILED with operator-discarded and origin operator, then deletes the dead letter', async () => {
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    const commandQueue = createRecordingCommandQueue();
    expect(
      await operatorWith(commandQueue, deadLetterQueue.queue).resolve(deadLetter, 'discard'),
    ).toBe('discarded');
    expect(storedOperation()).toMatchObject({
      state: 'FAILED',
      lastTransitionOrigin: 'operator',
      failure: { code: 'operator-discarded' },
      attempts: 2,
      redriveCount: 0,
    });
    expect(commandQueue.sent).toEqual([]);
    expect(deadLetterQueue.deleted).toEqual(['receipt-dead-letter-1']);
  });

  it('finishes on a rerun after the delete failed', async () => {
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    deadLetterQueue.failNextDelete(new Error('ReceiptHandleIsInvalid'));
    const operator = operatorWith(createRecordingCommandQueue(), deadLetterQueue.queue);
    await expect(operator.resolve(deadLetter, 'discard')).rejects.toThrow('ReceiptHandleIsInvalid');
    expect(await operator.resolve(deadLetter, 'discard')).toBe('discarded');
    expect(deadLetterQueue.deleted).toEqual(['receipt-dead-letter-1']);
  });

  it('deletes, and only deletes, a dead letter it cannot read', async () => {
    const unreadable: DeadLetterMessage = {
      messageId: 'm2',
      receiptHandle: 'receipt-2',
      body: 'not json',
    };
    const deadLetterQueue = createRecordingDeadLetterQueue([unreadable]);
    expect(
      await operatorWith(createRecordingCommandQueue(), deadLetterQueue.queue).resolve(
        unreadable,
        'discard',
      ),
    ).toBe('discarded');
    expect(deadLetterQueue.deleted).toEqual(['receipt-2']);
    expect(storedOperation()).toMatchObject({ state: 'DEAD_LETTERED' });
  });

  it('refuses to redrive a dead letter it cannot read', async () => {
    const unreadable: DeadLetterMessage = {
      messageId: 'm2',
      receiptHandle: 'receipt-2',
      body: 'not json',
    };
    const deadLetterQueue = createRecordingDeadLetterQueue([unreadable]);
    await expect(
      operatorWith(createRecordingCommandQueue(), deadLetterQueue.queue).resolve(
        unreadable,
        'redrive',
      ),
    ).rejects.toThrow('operator-action-not-allowed');
    expect(deadLetterQueue.deleted).toEqual([]);
  });
});

describe('skip', () => {
  it('changes nothing, and is logged and counted as the action it is', async () => {
    const deadLetterQueue = createRecordingDeadLetterQueue([deadLetter]);
    const commandQueue = createRecordingCommandQueue();
    expect(
      await operatorWith(commandQueue, deadLetterQueue.queue).resolve(deadLetter, 'skip'),
    ).toBe('skipped');
    expect(storedOperation()).toMatchObject({ state: 'DEAD_LETTERED' });
    expect(commandQueue.sent).toEqual([]);
    expect(deadLetterQueue.deleted).toEqual([]);
    expect(recorder.events).toEqual([
      ['actionLog', operationId, 'skip', 'skipped'],
      ['OperatorAction', 'skip', 'skipped'],
    ]);
  });
});

describe('createSqsDeadLetterQueue', () => {
  const sqsMock = mockClient(SQSClient);

  afterEach(() => {
    sqsMock.reset();
  });

  it('receives up to ten at a time and deletes by receipt handle, on the queue it is given', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: formatCommandMessage(operationId) }],
    });
    sqsMock.on(DeleteMessageCommand).resolves({});
    const queueUrl = 'https://sqs.eu-west-2.amazonaws.com/000000000000/demo-dev-commands-dlq.fifo';
    const deadLetterQueue = createSqsDeadLetterQueue({
      sqsClient: new SQSClient({ region: 'eu-west-2' }),
      queueUrl,
    });
    expect(await deadLetterQueue.receiveMessages()).toEqual([
      { messageId: 'm1', receiptHandle: 'r1', body: formatCommandMessage(operationId) },
    ]);
    await deadLetterQueue.deleteMessage('r1');
    expect(sqsMock.commandCalls(ReceiveMessageCommand)[0]?.args[0].input).toMatchObject({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
    });
    expect(sqsMock.commandCalls(DeleteMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: queueUrl,
      ReceiptHandle: 'r1',
    });
  });
});
