// Spec 03 §5.2 and WE3: enqueueOperation, shared by the relay and the sweep,
// and the SQS sender behind it.
import { createHash } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { contractBounds } from '@demo/contracts';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqsCommandQueueSender } from '../src/command-queue';
import { enqueueOperation } from '../src/enqueue-operation';
import { createJournalStore, type JournalStore } from '../src/journal-store';
import { messageGroupFor } from '../src/message-group';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';
import { createRecordingCommandQueue, newOperation } from './support/write-path-fixtures';

let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
const staleTransitions: unknown[] = [];

beforeEach(async () => {
  journalTable = createFakeCommandJournalTable();
  staleTransitions.length = 0;
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: (details) => staleTransitions.push(details) },
    metrics: { countStaleTransition: () => undefined, countJournalItemRejected: () => undefined },
    now: () => new Date('2026-10-18T09:30:00.000Z'),
  });
  await journalStore.createOperation(newOperation());
});

afterEach(() => {
  journalTable.restore();
});

const operationKeys = {
  operationId: '01JB0000000000000000000101',
  tenantId: 'tenant-1',
  recordId: 'record-0001',
};

describe('messageGroupFor (§5.2, WU22)', () => {
  it('is the SHA-256, in hexadecimal, of tenantId, # and recordId, within the 128 character limit', () => {
    const messageGroupId = messageGroupFor('tenant-1', 'record-0001');
    expect(messageGroupId).toBe(
      createHash('sha256').update('tenant-1#record-0001', 'utf8').digest('hex'),
    );
    expect(messageGroupId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives each record its own group, and another tenant another group for the same record', () => {
    expect(messageGroupFor('tenant-1', 'record-0001')).not.toBe(
      messageGroupFor('tenant-1', 'record-0002'),
    );
    expect(messageGroupFor('tenant-1', 'record-0001')).not.toBe(
      messageGroupFor('tenant-2', 'record-0001'),
    );
  });
});

describe('enqueueOperation (§5.2)', () => {
  it('sends a body of messageVersion and operationId only, grouped by record, deduplicated by operationId', async () => {
    const commandQueue = createRecordingCommandQueue();
    await enqueueOperation({ commandQueue, journalStore }, operationKeys, 'relay');
    expect(commandQueue.sent).toHaveLength(1);
    const [sentMessage] = commandQueue.sent;
    expect(JSON.parse(String(sentMessage?.body))).toEqual({
      messageVersion: 1,
      operationId: '01JB0000000000000000000101',
    });
    expect(Buffer.byteLength(String(sentMessage?.body), 'utf8')).toBeLessThanOrEqual(
      contractBounds.queueMessageBodyMaximumBytes,
    );
    expect(sentMessage?.messageGroupId).toBe(messageGroupFor('tenant-1', 'record-0001'));
    expect(sentMessage?.messageDeduplicationId).toBe('01JB0000000000000000000101');
  });

  it.each(['relay', 'sweep'] as const)(
    'then moves the operation to QUEUED with origin %s',
    async (origin) => {
      const commandQueue = createRecordingCommandQueue();
      expect(await enqueueOperation({ commandQueue, journalStore }, operationKeys, origin)).toBe(
        'queued',
      );
      expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toMatchObject({
        state: 'QUEUED',
        lastTransitionOrigin: origin,
      });
    },
  );

  it('tolerates a stale transition after a successful send: the worker may have it already', async () => {
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    const commandQueue = createRecordingCommandQueue();
    expect(await enqueueOperation({ commandQueue, journalStore }, operationKeys, 'sweep')).toBe(
      'already-moved',
    );
    expect(commandQueue.sent).toHaveLength(1);
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toMatchObject({
      state: 'APPLYING',
    });
    expect(staleTransitions).toHaveLength(1);
  });

  it('leaves the operation ACCEPTED when the send fails, so the sweep sends again', async () => {
    const sendFailure = new Error('QueueDoesNotExist');
    const commandQueue = createRecordingCommandQueue({ failWith: sendFailure });
    await expect(
      enqueueOperation({ commandQueue, journalStore }, operationKeys, 'relay'),
    ).rejects.toBe(sendFailure);
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toMatchObject({
      state: 'ACCEPTED',
    });
  });
});

describe('createSqsCommandQueueSender', () => {
  const sqsMock = mockClient(SQSClient);

  afterEach(() => {
    sqsMock.reset();
  });

  it('sends each message to the commands queue with its group and deduplication identifier', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'synthetic-message' });
    const commandQueue = createSqsCommandQueueSender({
      sqsClient: new SQSClient({ region: 'eu-west-2' }),
      queueUrl: 'https://sqs.eu-west-2.amazonaws.com/000000000000/demo-dev-commands.fifo',
    });
    await commandQueue.sendCommandMessage({
      body: '{"messageVersion":1,"operationId":"01JB0000000000000000000101"}',
      messageGroupId: 'a'.repeat(64),
      messageDeduplicationId: '01JB0000000000000000000101',
    });
    expect(sqsMock.commandCalls(SendMessageCommand).map((call) => call.args[0].input)).toEqual([
      {
        QueueUrl: 'https://sqs.eu-west-2.amazonaws.com/000000000000/demo-dev-commands.fifo',
        MessageBody: '{"messageVersion":1,"operationId":"01JB0000000000000000000101"}',
        MessageGroupId: 'a'.repeat(64),
        MessageDeduplicationId: '01JB0000000000000000000101',
      },
    ]);
  });
});
