// Spec 03 §5.1, §4.5 and WE3: the relay, given DynamoDB stream events built
// from the journal's own items.
import { marshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRelayHandler,
  type RelayLog,
  type RelayMetrics,
} from '../src/handlers/relay-handler';
import { createJournalStore, type JournalItemKind, type JournalStore } from '../src/journal-store';
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

class RecordingRelay implements RelayLog, RelayMetrics {
  readonly events: unknown[][] = [];
  recordBatchFailed(details: { failedRecordCount: number }): void {
    this.events.push(['batchFailedLog', details.failedRecordCount]);
  }
  countRelayEnqueued(): void {
    this.events.push(['RelayEnqueued']);
  }
  countRelayBatchFailed(): void {
    this.events.push(['RelayBatchFailed']);
  }
  countJournalItemExpired(itemKind: JournalItemKind): void {
    this.events.push(['JournalItemExpired', itemKind]);
  }
  named(eventName: string): unknown[][] {
    return this.events.filter((recordedEvent) => recordedEvent[0] === eventName);
  }
}

let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
let recorder: RecordingRelay;
const rejectedItems: unknown[][] = [];

beforeEach(async () => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingRelay();
  rejectedItems.length = 0;
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: () => undefined },
    metrics: {
      countStaleTransition: () => undefined,
      countJournalItemRejected: (reason, itemKind) => rejectedItems.push([reason, itemKind]),
    },
    now: () => new Date('2026-10-18T09:30:00.000Z'),
  });
  for (const ordinal of [1, 2, 3]) {
    await journalStore.createOperation(
      newOperation({
        operationId: `01JB000000000000000000010${String(ordinal)}`,
        idempotencyKey: `00000000-0000-4000-8000-00000000010${String(ordinal)}`,
        recordId: `record-000${String(ordinal)}`,
      }),
    );
  }
});

afterEach(() => {
  journalTable.restore();
});

function storedItem(operationId: string): Record<string, unknown> {
  const operationItem = journalTable.itemAt(`OP#${operationId}`, 'OP');
  if (operationItem === undefined) {
    throw new Error(`no operation ${operationId}`);
  }
  return operationItem;
}

function insertRecord(
  operationItem: Record<string, unknown>,
  sequenceNumber: string,
): DynamoDBRecord {
  return {
    eventName: 'INSERT',
    dynamodb: {
      Keys: marshall({
        partitionKey: operationItem['partitionKey'],
        sortKey: operationItem['sortKey'],
      }) as never,
      NewImage: marshall(operationItem) as never,
      SequenceNumber: sequenceNumber,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
}

// WU5: a deletion by time to live carries the service's identity.
function timeToLiveRemoval(
  oldItem: Record<string, unknown>,
  sequenceNumber: string,
): DynamoDBRecord {
  return {
    eventName: 'REMOVE',
    userIdentity: { type: 'Service', principalId: 'dynamodb.amazonaws.com' },
    dynamodb: {
      Keys: marshall({
        partitionKey: oldItem['partitionKey'],
        sortKey: oldItem['sortKey'],
      }) as never,
      OldImage: marshall(oldItem) as never,
      SequenceNumber: sequenceNumber,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
}

function relayWith(commandQueue: RecordingCommandQueue) {
  return createRelayHandler({
    commandQueue,
    journalStore,
    relayLog: recorder,
    relayMetrics: recorder,
  });
}

describe('the relay (§5.1)', () => {
  it('sends each inserted operation and moves it to QUEUED, counting RelayEnqueued', async () => {
    const commandQueue = createRecordingCommandQueue();
    const response = await relayWith(commandQueue)({
      Records: [
        insertRecord(storedItem('01JB0000000000000000000101'), '100'),
        insertRecord(storedItem('01JB0000000000000000000102'), '101'),
      ],
    } satisfies DynamoDBStreamEvent);
    expect(response).toEqual({ batchItemFailures: [] });
    expect(commandQueue.sent.map((message) => message.messageDeduplicationId)).toEqual([
      '01JB0000000000000000000101',
      '01JB0000000000000000000102',
    ]);
    expect(storedItem('01JB0000000000000000000101')).toMatchObject({
      state: 'QUEUED',
      lastTransitionOrigin: 'relay',
    });
    expect(recorder.named('RelayEnqueued')).toHaveLength(2);
  });

  it('counts a TTL removal by item kind, and sends nothing for it (§4.5)', async () => {
    const commandQueue = createRecordingCommandQueue();
    const idempotencyItem = journalTable.itemAt(
      'IDEM#tenant-1#00000000-0000-4000-8000-000000000101',
      'IDEM',
    );
    const response = await relayWith(commandQueue)({
      Records: [
        timeToLiveRemoval(storedItem('01JB0000000000000000000101'), '100'),
        timeToLiveRemoval(idempotencyItem ?? {}, '101'),
      ],
    });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(commandQueue.sent).toEqual([]);
    expect(recorder.named('JournalItemExpired')).toEqual([
      ['JournalItemExpired', 'operation'],
      ['JournalItemExpired', 'idempotency'],
    ]);
  });

  it('neither counts nor sends a removal made by anyone but the time to live process', async () => {
    const commandQueue = createRecordingCommandQueue();
    const removal = timeToLiveRemoval(storedItem('01JB0000000000000000000101'), '100');
    const response = await relayWith(commandQueue)({
      Records: [{ ...removal, userIdentity: undefined }],
    });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(commandQueue.sent).toEqual([]);
    expect(recorder.events).toEqual([]);
  });

  it('passes an idempotency item insert by: neither sent, nor failed, nor counted', async () => {
    const commandQueue = createRecordingCommandQueue();
    const idempotencyItem = journalTable.itemAt(
      'IDEM#tenant-1#00000000-0000-4000-8000-000000000101',
      'IDEM',
    );
    const response = await relayWith(commandQueue)({
      Records: [insertRecord(idempotencyItem ?? {}, '100')],
    });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(commandQueue.sent).toEqual([]);
    expect(recorder.events).toEqual([]);
    expect(rejectedItems).toEqual([]);
  });

  it('reports the failing record and every later one, logging and counting the batch once', async () => {
    const commandQueue = createRecordingCommandQueue({
      failWith: new Error('ThrottlingException'),
      failForOperationId: '01JB0000000000000000000102',
    });
    const response = await relayWith(commandQueue)({
      Records: [
        insertRecord(storedItem('01JB0000000000000000000101'), '100'),
        insertRecord(storedItem('01JB0000000000000000000102'), '101'),
        insertRecord(storedItem('01JB0000000000000000000103'), '102'),
      ],
    });
    // A stream retries from the first failure, so the later records are
    // reported too and not sent ahead of it.
    expect(response).toEqual({
      batchItemFailures: [{ itemIdentifier: '101' }, { itemIdentifier: '102' }],
    });
    expect(commandQueue.sent.map((message) => message.messageDeduplicationId)).toEqual([
      '01JB0000000000000000000101',
    ]);
    expect(recorder.named('batchFailedLog')).toEqual([['batchFailedLog', 2]]);
    expect(recorder.named('RelayBatchFailed')).toHaveLength(1);
    expect(storedItem('01JB0000000000000000000103')).toMatchObject({ state: 'ACCEPTED' });
  });

  it('reports an inserted item of another schemaVersion failed, counted as rejected', async () => {
    const commandQueue = createRecordingCommandQueue();
    const response = await relayWith(commandQueue)({
      Records: [
        insertRecord({ ...storedItem('01JB0000000000000000000101'), schemaVersion: 2 }, '100'),
      ],
    });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: '100' }] });
    expect(commandQueue.sent).toEqual([]);
    expect(rejectedItems).toEqual([['version-mismatch', 'operation']]);
  });

  it('reports a record that carries no sequence number as a failure of the whole batch', async () => {
    const commandQueue = createRecordingCommandQueue();
    const unnumbered = insertRecord(storedItem('01JB0000000000000000000101'), '100');
    delete unnumbered.dynamodb?.SequenceNumber;
    await expect(relayWith(commandQueue)({ Records: [unnumbered] })).rejects.toThrow(
      'stream-record-without-sequence-number',
    );
  });
});
