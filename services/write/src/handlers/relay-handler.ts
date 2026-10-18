import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import type { CommandQueueSender } from '../command-queue';
import { enqueueOperation } from '../enqueue-operation';
import type { JournalItemKind, JournalStore } from '../journal-store';

// Spec 03 §5.1: the relay, triggered by the journal's stream, filtered to
// inserts of operation items and to removals by time to live (WU6). It sends
// each new operation to the commands queue and counts each expiry (§4.5).

export interface RelayLog {
  // Once per batch with failed records, saying the event source will retry
  // them, so a correct retry is not read as a failure (datum 0.15).
  recordBatchFailed(details: { failedRecordCount: number }): void;
}

// Spec 03 §11.
export interface RelayMetrics {
  countRelayEnqueued(): void;
  countRelayBatchFailed(): void;
  countJournalItemExpired(itemKind: JournalItemKind): void;
}

export interface RelayHandlerDependencies {
  readonly commandQueue: CommandQueueSender;
  readonly journalStore: Pick<JournalStore, 'transitionOperation' | 'readOperationImage'>;
  readonly relayLog: RelayLog;
  readonly relayMetrics: RelayMetrics;
}

// WU5: a removal by time to live carries the service's own identity.
function isTimeToLiveRemoval(streamRecord: DynamoDBRecord): boolean {
  const userIdentity = streamRecord.userIdentity as
    { type?: unknown; principalId?: unknown } | undefined;
  return (
    streamRecord.eventName === 'REMOVE' &&
    userIdentity?.type === 'Service' &&
    userIdentity.principalId === 'dynamodb.amazonaws.com'
  );
}

type StreamImage = NonNullable<NonNullable<DynamoDBRecord['dynamodb']>['NewImage']>;

// The stream's attribute value types are DefinitelyTyped's; their shape is
// DynamoDB's own, which unmarshall reads.
function itemFromImage(image: StreamImage): Record<string, unknown> {
  return unmarshall(image as Parameters<typeof unmarshall>[0]);
}

function expiredItemKind(streamRecord: DynamoDBRecord): JournalItemKind | undefined {
  const oldImage = streamRecord.dynamodb?.OldImage;
  const sortKey = oldImage === undefined ? undefined : itemFromImage(oldImage)['sortKey'];
  if (sortKey === 'OP') {
    return 'operation';
  }
  return sortKey === 'IDEM' ? 'idempotency' : undefined;
}

export function createRelayHandler(
  dependencies: RelayHandlerDependencies,
): (event: DynamoDBStreamEvent) => Promise<DynamoDBBatchResponse> {
  const { relayMetrics } = dependencies;

  async function relayRecord(streamRecord: DynamoDBRecord): Promise<void> {
    if (isTimeToLiveRemoval(streamRecord)) {
      const itemKind = expiredItemKind(streamRecord);
      if (itemKind !== undefined) {
        relayMetrics.countJournalItemExpired(itemKind);
      }
      return;
    }
    const newImage = streamRecord.dynamodb?.NewImage;
    if (streamRecord.eventName !== 'INSERT' || newImage === undefined) {
      // Outside the mapping's filter (WU6): a removal by anyone but the time
      // to live process, or a change, is no business of the relay's.
      return;
    }
    const newItem = itemFromImage(newImage);
    if (newItem['sortKey'] !== 'OP') {
      return;
    }
    // Checked as a table read is: another schemaVersion is refused and
    // counted, and the record fails rather than being sent.
    const operation = dependencies.journalStore.readOperationImage(newItem);
    await enqueueOperation(dependencies, operation, 'relay');
    relayMetrics.countRelayEnqueued();
  }

  return async (event) => {
    const sequenceNumbers = event.Records.map((streamRecord) => {
      const sequenceNumber = streamRecord.dynamodb?.SequenceNumber;
      if (sequenceNumber === undefined) {
        // Without it no failure can be reported for this record, so the
        // whole batch fails and the event source retries it.
        throw new Error('stream-record-without-sequence-number');
      }
      return sequenceNumber;
    });
    let firstFailedIndex: number | undefined;
    for (const [recordIndex, streamRecord] of event.Records.entries()) {
      try {
        await relayRecord(streamRecord);
      } catch {
        firstFailedIndex = recordIndex;
        break;
      }
    }
    if (firstFailedIndex === undefined) {
      return { batchItemFailures: [] };
    }
    // A stream resumes from the first failure, so every later record is
    // reported too, and none is sent ahead of it.
    const failedSequenceNumbers = sequenceNumbers.slice(firstFailedIndex);
    dependencies.relayLog.recordBatchFailed({ failedRecordCount: failedSequenceNumbers.length });
    relayMetrics.countRelayBatchFailed();
    return {
      batchItemFailures: failedSequenceNumbers.map((sequenceNumber) => ({
        itemIdentifier: sequenceNumber,
      })),
    };
  };
}
