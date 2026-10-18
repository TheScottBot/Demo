import { marshall } from '@aws-sdk/util-dynamodb';
import type { DemoHttpHandler, ProviderIdentifier, WriteAdapter } from '@demo/contracts';
import type { LocalMockProviderConnection } from '@demo/mock-providers';
import { buildLambdaContext, buildVerifiedClaimsEvent, publicRouteNamed } from '@demo/test-doubles';
import type { APIGatewayProxyStructuredResultV2, DynamoDBRecord, SQSRecord } from 'aws-lambda';
import { createHttpWriteAdapter } from '../../src/adapters/http-write-adapter';
import type { CommandQueueMessage } from '../../src/command-queue';
import { createIntakeHandler } from '../../src/handlers/intake-handler';
import { createRelayHandler } from '../../src/handlers/relay-handler';
import { createStatusHandler } from '../../src/handlers/status-handler';
import { createSweepHandler } from '../../src/handlers/sweep-handler';
import { createWorkerHandler } from '../../src/handlers/worker-handler';
import { createJournalStore } from '../../src/journal-store';
import {
  createDeadLetterOperator,
  type DeadLetterMessage,
  type DeadLetterOperator,
} from '../../src/operator/dead-letter-operator';
import { writePathSettings } from '../../src/write-path-settings';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeStreamRecord,
} from './fake-command-journal-table';

// Spec 03 WE9 under WQ1: the write path run locally. The real intake, relay,
// sweep, worker and status handlers are joined by the fake journal table and
// its stream, and by an in-memory FIFO queue with message groups, visibility,
// receive counts, deduplication and a dead letter queue, on a clock the suite
// controls. The worker's real adapters call the local mock provider servers
// over HTTP. The queue and stream are this suite's model of SQS and DynamoDB
// Streams as the Plan stage read them, not the services themselves.

// WU8.
const deduplicationWindowMilliseconds = 5 * 60 * 1_000;

interface QueuedMessage {
  readonly messageId: string;
  readonly body: string;
  readonly groupId: string;
  readonly sentAt: number;
  receiveCount: number;
  visibleAt: number;
  receiptHandle: string;
}

export interface ProviderCall {
  readonly operationId: string;
  readonly providerId: ProviderIdentifier;
  readonly at: number;
}

export interface LocalWritePath {
  submit(
    command: unknown,
    options?: { idempotencyKey?: string; tenantId?: string },
  ): Promise<APIGatewayProxyStructuredResultV2>;
  status(operationId: string, tenantId?: string): Promise<APIGatewayProxyStructuredResultV2>;
  // The relay's stream mapping delivers what the table wrote since last time.
  deliverStream(): Promise<void>;
  runSweep(): Promise<void>;
  // Delivers queued messages to the worker, moving the clock on to the next
  // visible message, until none is left but dead letters.
  drainQueue(): Promise<void>;
  // Stream, then queue, until nothing moves.
  settle(): Promise<void>;
  advanceTime(milliseconds: number): void;
  now(): number;
  operationItem(operationId: string): Record<string, unknown> | undefined;
  readonly deadLetters: QueuedMessage[];
  readonly providerCalls: ProviderCall[];
  readonly metrics: unknown[][];
  operator(): DeadLetterOperator;
  // The intake and status functions themselves, for a caller that builds its
  // own events, as the local demo's gateway stand-in does.
  readonly handlers: { readonly intake: DemoHttpHandler; readonly status: DemoHttpHandler };
  stop(): void;
}

// The relay's filter (§5.1, WU6): inserts of operation items, and removals by
// time to live, which this suite never makes.
function passesRelayFilter(streamRecord: FakeStreamRecord): boolean {
  return streamRecord.eventName === 'INSERT' && streamRecord.newImage['sortKey'] === 'OP';
}

function streamEventRecord(streamRecord: FakeStreamRecord): DynamoDBRecord {
  return {
    eventName: streamRecord.eventName,
    dynamodb: {
      NewImage: marshall(streamRecord.newImage) as never,
      SequenceNumber: streamRecord.sequenceNumber,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
}

export function createLocalWritePath(options: {
  relayEnabled: boolean;
  providerConnections: readonly LocalMockProviderConnection[];
  startAt?: Date;
  // Defaults to sequential identifiers, so a suite's operations are known in
  // advance; the local demo passes real ULIDs.
  mintOperationId?: () => string;
}): LocalWritePath {
  let currentTime = (options.startAt ?? new Date('2026-10-18T09:30:00.000Z')).getTime();
  const now = () => new Date(currentTime);
  const metrics: unknown[][] = [];
  const providerCalls: ProviderCall[] = [];
  const journalTable = createFakeCommandJournalTable();
  const journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: () => undefined },
    metrics: {
      countStaleTransition: (origin) => metrics.push(['StaleTransition', origin]),
      countJournalItemRejected: (reason) => metrics.push(['JournalItemRejected', reason]),
    },
    now,
  });

  const queued: QueuedMessage[] = [];
  const deadLetters: QueuedMessage[] = [];
  const deduplicationSeen = new Map<string, number>();
  let nextMessage = 0;
  const commandQueue = {
    sendCommandMessage: (message: CommandQueueMessage) => {
      const seenAt = deduplicationSeen.get(message.messageDeduplicationId);
      if (seenAt !== undefined && currentTime - seenAt < deduplicationWindowMilliseconds) {
        // Accepted and dropped, as SQS does within the window (WU8).
        return Promise.resolve();
      }
      deduplicationSeen.set(message.messageDeduplicationId, currentTime);
      nextMessage += 1;
      queued.push({
        messageId: `local-message-${String(nextMessage)}`,
        body: message.body,
        groupId: message.messageGroupId,
        sentAt: currentTime,
        receiveCount: 0,
        visibleAt: currentTime,
        receiptHandle: '',
      });
      return Promise.resolve();
    },
  };
  const messageVisibility = {
    setVisibilityTimeout: (receiptHandle: string, visibilitySeconds: number) => {
      const message = queued.find((candidate) => candidate.receiptHandle === receiptHandle);
      if (message !== undefined) {
        message.visibleAt = currentTime + visibilitySeconds * 1_000;
      }
      return Promise.resolve();
    },
  };

  const writeAdapters: WriteAdapter[] = options.providerConnections.map((connection) => {
    const adapter = createHttpWriteAdapter({
      providerId: connection.providerId,
      baseUrl: connection.baseUrl,
      readApiKey: () => Promise.resolve(connection.apiKey),
      metrics: { countRetryAfterIgnored: () => undefined },
    });
    return {
      providerId: adapter.providerId,
      apply: (applyRequest, callOptions) => {
        providerCalls.push({
          operationId: callOptions.correlationId,
          providerId: adapter.providerId,
          at: currentTime,
        });
        return adapter.apply(applyRequest, callOptions);
      },
    };
  });

  const problemHandling = {
    problemLog: {
      bindRequestKeys: () => undefined,
      clearRequestKeys: () => undefined,
      recordRejection: () => undefined,
      recordInternalFailure: () => undefined,
    },
    problemMetrics: { countRequestRejected: () => undefined },
  };
  let mintedOperations = 0;
  const intakeHandler = createIntakeHandler({
    journalStore,
    ...problemHandling,
    intakeLog: { bindOperation: () => undefined },
    intakeMetrics: {
      countCommandAccepted: (providerId) => metrics.push(['CommandsAccepted', providerId]),
      countIdempotentReplay: () => metrics.push(['IdempotentReplay']),
      countIdempotencyKeyReused: () => metrics.push(['IdempotencyKeyReused']),
    },
    mintOperationId:
      options.mintOperationId ??
      (() => {
        mintedOperations += 1;
        return `01JB${String(mintedOperations).padStart(22, '0')}`;
      }),
  });
  const statusHandler = createStatusHandler({
    journalStore,
    ...problemHandling,
    statusLog: { bindOperation: () => undefined },
  });
  const relayHandler = createRelayHandler({
    commandQueue,
    journalStore,
    relayLog: { recordBatchFailed: () => undefined },
    relayMetrics: {
      countRelayEnqueued: () => metrics.push(['RelayEnqueued']),
      countRelayBatchFailed: () => metrics.push(['RelayBatchFailed']),
      countJournalItemExpired: () => undefined,
    },
  });
  const sweepHandler = createSweepHandler({
    journalStore,
    commandQueue,
    sweepLog: {
      recordAbsentSubsystem: (subsystem) => metrics.push(['absent', subsystem]),
      recordRecovery: () => undefined,
    },
    sweepMetrics: {
      countSweepRecovered: () => metrics.push(['SweepRecovered']),
      countSweepLimitReached: (limit) => metrics.push(['SweepLimitReached', limit]),
    },
    relayEnabled: options.relayEnabled,
    now,
    monotonicNow: () => currentTime,
  });
  const workerHandler = createWorkerHandler({
    journalStore,
    writeAdapters,
    messageVisibility,
    workerLog: {
      bindOperation: () => undefined,
      recordMessageRejected: () => undefined,
      recordOperationMissing: () => undefined,
      recordDuplicateDelivery: () => undefined,
      recordRetry: () => undefined,
    },
    workerMetrics: {
      countQueueMessageRejected: (reason) => metrics.push(['QueueMessageRejected', reason]),
      countDuplicateDelivery: () => metrics.push(['DuplicateDelivery']),
      recordApplyOutcome: (details) =>
        metrics.push(['ApplyOutcome', details.providerId, details.outcome]),
      recordTimeToTerminalState: (state) => metrics.push(['TimeToTerminalState', state]),
    },
    now,
    monotonicNow: () => currentTime,
    // No jitter, so the backoff each retry waits is the one §6.4 states.
    randomFraction: () => 0,
  });

  // FIFO (§6.1): a group's messages go one at a time, in the order sent, and
  // a group waits while its head is invisible. SQS promises no order across
  // groups, so the most recently sent head goes first: the least kind order,
  // which shows ordering resting on the group alone.
  function nextDeliverable(): QueuedMessage | undefined {
    const groupHeads = new Map<string, QueuedMessage>();
    for (const message of queued) {
      const head = groupHeads.get(message.groupId);
      if (head === undefined || message.sentAt < head.sentAt) {
        groupHeads.set(message.groupId, message);
      }
    }
    return [...groupHeads.values()]
      .filter((head) => head.visibleAt <= currentTime)
      .sort(
        (left, right) =>
          right.sentAt - left.sentAt || right.messageId.localeCompare(left.messageId),
      )[0];
  }

  async function deliver(message: QueuedMessage): Promise<void> {
    // §6.1, WU13: past the last allowed receive, SQS moves the message to the
    // dead letter queue instead of delivering it.
    if (message.receiveCount >= writePathSettings.commandMaximumReceives) {
      queued.splice(queued.indexOf(message), 1);
      deadLetters.push(message);
      return;
    }
    message.receiveCount += 1;
    message.receiptHandle = `${message.messageId}-receipt-${String(message.receiveCount)}`;
    message.visibleAt = currentTime + writePathSettings.commandVisibilityTimeoutSeconds * 1_000;
    const sqsRecord: SQSRecord = {
      messageId: message.messageId,
      receiptHandle: message.receiptHandle,
      body: message.body,
      attributes: {
        ApproximateReceiveCount: String(message.receiveCount),
        SentTimestamp: String(message.sentAt),
        SenderId: 'local',
        ApproximateFirstReceiveTimestamp: String(message.sentAt),
      },
      messageAttributes: {},
      md5OfBody: 'local',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:eu-west-2:000000000000:demo-test-commands.fifo',
      awsRegion: 'eu-west-2',
    };
    const response = await workerHandler({ Records: [sqsRecord] });
    if (
      !response.batchItemFailures.some((failure) => failure.itemIdentifier === message.messageId)
    ) {
      // Acknowledged: Lambda deletes it.
      queued.splice(queued.indexOf(message), 1);
    }
  }

  const localWritePath: LocalWritePath = {
    submit: (command, submitOptions = {}) =>
      intakeHandler(
        buildVerifiedClaimsEvent({
          route: publicRouteNamed('submit-command'),
          headers: [
            ['Content-Type', 'application/json'],
            [
              'Idempotency-Key',
              submitOptions.idempotencyKey ?? '00000000-0000-4000-8000-000000000901',
            ],
          ],
          body: typeof command === 'string' ? command : JSON.stringify(command),
          claims: { tenantId: submitOptions.tenantId ?? 'tenant-1', scope: 'records:write' },
        }),
        buildLambdaContext(),
      ),
    status: (operationId, tenantId = 'tenant-1') =>
      statusHandler(
        buildVerifiedClaimsEvent({
          route: publicRouteNamed('read-operation'),
          pathParameters: { operationId },
          claims: { tenantId, scope: 'records:write' },
        }),
        buildLambdaContext(),
      ),
    deliverStream: async () => {
      const streamRecords = journalTable.takeStreamRecords().filter(passesRelayFilter);
      if (!options.relayEnabled || streamRecords.length === 0) {
        return;
      }
      for (let start = 0; start < streamRecords.length; start += writePathSettings.relayBatchSize) {
        const batch = streamRecords.slice(start, start + writePathSettings.relayBatchSize);
        const response = await relayHandler({ Records: batch.map(streamEventRecord) });
        if (response.batchItemFailures.length > 0) {
          throw new Error('local relay batch failed');
        }
      }
    },
    runSweep: () => sweepHandler(),
    drainQueue: async () => {
      // A bound on the loop, far beyond any scenario here.
      for (let delivery = 0; delivery < 1_000; delivery += 1) {
        if (queued.length === 0) {
          return;
        }
        const message = nextDeliverable();
        if (message === undefined) {
          currentTime = Math.min(...queued.map((candidate) => candidate.visibleAt));
          continue;
        }
        await deliver(message);
      }
      throw new Error('local queue did not drain');
    },
    settle: async () => {
      await localWritePath.deliverStream();
      await localWritePath.drainQueue();
      await localWritePath.deliverStream();
    },
    advanceTime: (milliseconds) => {
      currentTime += milliseconds;
    },
    now: () => currentTime,
    operationItem: (operationId) => journalTable.itemAt(`OP#${operationId}`, 'OP'),
    deadLetters,
    providerCalls,
    metrics,
    operator: () =>
      createDeadLetterOperator({
        journalStore,
        commandQueue,
        deadLetterQueue: {
          receiveMessages: () =>
            Promise.resolve(
              deadLetters.map((message): DeadLetterMessage => ({
                messageId: message.messageId,
                receiptHandle: message.messageId,
                body: message.body,
              })),
            ),
          deleteMessage: (receiptHandle) => {
            const index = deadLetters.findIndex((message) => message.messageId === receiptHandle);
            if (index >= 0) {
              deadLetters.splice(index, 1);
            }
            return Promise.resolve();
          },
        },
        operatorLog: { recordOperatorAction: () => undefined },
        operatorMetrics: {
          countOperatorAction: (action, outcome) =>
            metrics.push(['OperatorAction', action, outcome]),
        },
      }),
    handlers: { intake: intakeHandler, status: statusHandler },
    stop: () => {
      journalTable.restore();
    },
  };
  return localWritePath;
}
