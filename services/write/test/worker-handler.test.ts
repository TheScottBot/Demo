// Spec 03 §6.3 and WE5: the worker, given SQS events, over the fake journal
// table, calling the real write adapters against the Spec 00 msw doubles.
import {
  contractBounds,
  type ApplyOutcome,
  type ProviderIdentifier,
  type WriteAdapter,
} from '@demo/contracts';
import {
  computeProviderVersion,
  startProviderDoubles,
  syntheticProviderApiKey,
  syntheticProviderConnections,
  type ProviderDoubles,
} from '@demo/test-doubles';
import type { SQSRecord } from 'aws-lambda';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHttpWriteAdapter } from '../src/adapters/http-write-adapter';
import { formatCommandMessage } from '../src/command-queue';
import {
  createWorkerHandler,
  type WorkerLog,
  type WorkerMetrics,
} from '../src/handlers/worker-handler';
import { createJournalStore, type JournalStore, type NewOperation } from '../src/journal-store';
import { writePathSettings } from '../src/write-path-settings';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';
import { newOperation } from './support/write-path-fixtures';

class RecordingWorker implements WorkerLog, WorkerMetrics {
  readonly events: unknown[][] = [];
  bindOperation(keys: { operationId: string; providerId: string; attempts: number }): void {
    this.events.push(['bindOperation', keys.operationId, keys.providerId, keys.attempts]);
  }
  recordMessageRejected(reason: string): void {
    this.events.push(['messageRejectedLog', reason]);
  }
  recordOperationMissing(operationId: string): void {
    this.events.push(['OperationMissing', operationId]);
  }
  recordDuplicateDelivery(operationId: string, state: string): void {
    this.events.push(['duplicateLog', operationId, state]);
  }
  recordRetry(details: { reason: string; visibilitySeconds: number; receiveCount: number }): void {
    this.events.push(['retryLog', details.reason, details.visibilitySeconds, details.receiveCount]);
  }
  countQueueMessageRejected(reason: string): void {
    this.events.push(['QueueMessageRejected', reason]);
  }
  countDuplicateDelivery(): void {
    this.events.push(['DuplicateDelivery']);
  }
  recordApplyOutcome(details: {
    providerId: ProviderIdentifier;
    outcome: ApplyOutcome['kind'];
    reason: string | undefined;
    latencyMilliseconds: number;
  }): void {
    this.events.push(['ApplyOutcome', details.providerId, details.outcome, details.reason ?? null]);
  }
  recordTimeToTerminalState(state: string, milliseconds: number): void {
    this.events.push(['TimeToTerminalState', state, milliseconds]);
  }
  named(eventName: string): unknown[][] {
    return this.events.filter((recordedEvent) => recordedEvent[0] === eventName);
  }
}

let providerDoubles: ProviderDoubles;
let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
let recorder: RecordingWorker;
let visibilityChanges: [string, number][];
let callTimeouts: number[];
let currentTime: Date;
const providerCalls: {
  providerId: ProviderIdentifier;
  idempotencyKey: string;
  correlationId: string;
}[] = [];
const staleTransitions: unknown[] = [];

beforeAll(() => {
  providerDoubles = startProviderDoubles();
});

afterAll(() => {
  providerDoubles.stop();
});

beforeEach(() => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingWorker();
  visibilityChanges = [];
  callTimeouts = [];
  providerCalls.length = 0;
  staleTransitions.length = 0;
  currentTime = new Date('2026-10-18T09:30:00.000Z');
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: (details) => staleTransitions.push(details) },
    metrics: { countStaleTransition: () => undefined, countJournalItemRejected: () => undefined },
    now: () => currentTime,
  });
});

afterEach(() => {
  providerDoubles.reset();
  journalTable.restore();
});

// The real adapters, recording each call's key and correlation (entry 11).
function writeAdapters(): WriteAdapter[] {
  return syntheticProviderConnections.map((connection) => {
    const adapter = createHttpWriteAdapter({
      providerId: connection.providerId,
      baseUrl: connection.baseUrl,
      readApiKey: () => Promise.resolve(syntheticProviderApiKey(connection.providerId)),
      metrics: { countRetryAfterIgnored: () => undefined },
    });
    return {
      providerId: adapter.providerId,
      apply: (applyRequest, callOptions) => {
        providerCalls.push({
          providerId: adapter.providerId,
          idempotencyKey: applyRequest.idempotencyKey,
          correlationId: callOptions.correlationId,
        });
        return adapter.apply(applyRequest, callOptions);
      },
    };
  });
}

function workerWith(adapters: readonly WriteAdapter[] = writeAdapters()) {
  return createWorkerHandler({
    journalStore,
    writeAdapters: adapters,
    messageVisibility: {
      setVisibilityTimeout: (receiptHandle, visibilitySeconds) => {
        visibilityChanges.push([receiptHandle, visibilitySeconds]);
        return Promise.resolve();
      },
    },
    workerLog: recorder,
    workerMetrics: recorder,
    now: () => currentTime,
    monotonicNow: () => 0,
    randomFraction: () => 0,
    createCallSignal: (timeoutMilliseconds) => {
      callTimeouts.push(timeoutMilliseconds);
      return new AbortController().signal;
    },
  });
}

function sqsRecord(body: string, receiveCount = 1, messageId = 'synthetic-message-1'): SQSRecord {
  return {
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body,
    attributes: {
      ApproximateReceiveCount: String(receiveCount),
      SentTimestamp: '1792316200000',
      SenderId: 'synthetic-sender',
      ApproximateFirstReceiveTimestamp: '1792316200000',
    },
    messageAttributes: {},
    md5OfBody: 'synthetic',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-west-2:000000000000:demo-dev-commands.fifo',
    awsRegion: 'eu-west-2',
  };
}

async function providerVersion(providerId: ProviderIdentifier, recordId: string): Promise<string> {
  const storedRecord = await providerDoubles.store.readRecord({
    providerId,
    tenantId: 'tenant-1',
    recordId,
  });
  if (storedRecord === undefined) {
    throw new Error(`no ${recordId} at ${providerId}`);
  }
  return computeProviderVersion(storedRecord.sections);
}

async function queuedOperation(overrides: Partial<NewOperation>): Promise<string> {
  const operation = newOperation(overrides);
  await journalStore.createOperation(operation);
  await journalStore.transitionOperation({
    operationId: operation.operationId,
    targetState: 'QUEUED',
    origin: 'relay',
  });
  return operation.operationId;
}

async function summaryOperation(recordId: string, ordinal = 1): Promise<string> {
  return queuedOperation({
    operationId: `01JB000000000000000000050${String(ordinal)}`,
    idempotencyKey: `00000000-0000-4000-8000-00000000050${String(ordinal)}`,
    recordId,
    baseVersion:
      recordId === 'record-9999'
        ? '0123456789abcdef'
        : await providerVersion('provider-a', recordId),
    payload: { title: `Synthetic worker summary ${String(ordinal)}`, status: 'paused' },
  });
}

function operationItem(operationId: string) {
  return journalTable.itemAt(`OP#${operationId}`, 'OP');
}

describe('the outcomes (§6.3 step 6)', () => {
  it('records applied as SUCCEEDED with the result, and acknowledges', async () => {
    const operationId = await summaryOperation('record-0001');
    const response = await workerWith()({
      Records: [sqsRecord(formatCommandMessage(operationId))],
    });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(operationItem(operationId)).toMatchObject({
      state: 'SUCCEEDED',
      attempts: 1,
      lastTransitionOrigin: 'worker',
      result: { providerVersion: await providerVersion('provider-a', 'record-0001') },
    });
    expect(recorder.named('ApplyOutcome')).toEqual([
      ['ApplyOutcome', 'provider-a', 'applied', null],
    ]);
    expect(recorder.named('TimeToTerminalState')).toEqual([
      ['TimeToTerminalState', 'SUCCEEDED', 0],
    ]);
    expect(recorder.named('bindOperation')).toEqual([
      ['bindOperation', operationId, 'provider-a', 1],
    ]);
  });

  it("sends the client's own Idempotency-Key and the operation as correlation, aborting at WU15 (entry 11)", async () => {
    const operationId = await summaryOperation('record-0001');
    await workerWith()({ Records: [sqsRecord(formatCommandMessage(operationId))] });
    expect(providerCalls).toEqual([
      {
        providerId: 'provider-a',
        idempotencyKey: '00000000-0000-4000-8000-000000000501',
        correlationId: operationId,
      },
    ]);
    expect(callTimeouts).toEqual([writePathSettings.workerCallTimeoutMilliseconds]);
    expect(writePathSettings.workerCallTimeoutMilliseconds).toBe(8_000);
  });

  it('records conflict as CONFLICT with its detail, and acknowledges', async () => {
    const operationId = await summaryOperation('conflict-0001');
    expect(await workerWith()({ Records: [sqsRecord(formatCommandMessage(operationId))] })).toEqual(
      {
        batchItemFailures: [],
      },
    );
    expect(operationItem(operationId)).toMatchObject({
      state: 'CONFLICT',
      conflict: { reason: 'precondition-failed' },
    });
  });

  it('records rejected as FAILED with its failure, and acknowledges', async () => {
    const operationId = await summaryOperation('record-9999');
    expect(await workerWith()({ Records: [sqsRecord(formatCommandMessage(operationId))] })).toEqual(
      {
        batchItemFailures: [],
      },
    );
    expect(operationItem(operationId)).toMatchObject({
      state: 'FAILED',
      failure: { code: 'provider-not-held', reason: 'not-held' },
    });
  });

  it('keeps a retryable outcome below the last receive: saves the reason, sets the backoff, logs once, reports failed', async () => {
    const operationId = await summaryOperation('poison-0001');
    const response = await workerWith()({
      Records: [sqsRecord(formatCommandMessage(operationId), 1)],
    });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'synthetic-message-1' }] });
    expect(operationItem(operationId)).toMatchObject({
      state: 'APPLYING',
      attempts: 1,
      lastErrorReason: 'server-error',
    });
    expect(visibilityChanges).toEqual([['receipt-synthetic-message-1', 5]]);
    expect(recorder.named('retryLog')).toEqual([['retryLog', 'server-error', 5, 1]]);
  });

  it("sets the provider's Retry-After as the visibility when it gives one (§6.4)", async () => {
    const operationId = await summaryOperation('throttle-0001');
    await workerWith()({ Records: [sqsRecord(formatCommandMessage(operationId), 1)] });
    expect(visibilityChanges).toEqual([['receipt-synthetic-message-1', 2]]);
  });

  it('dead letters a retryable outcome at the last receive, reporting the message failed', async () => {
    const operationId = await summaryOperation('poison-0001');
    const response = await workerWith()({
      Records: [
        sqsRecord(formatCommandMessage(operationId), writePathSettings.commandMaximumReceives),
      ],
    });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'synthetic-message-1' }] });
    expect(operationItem(operationId)).toMatchObject({
      state: 'DEAD_LETTERED',
      failure: { code: 'retries-exhausted', reason: 'server-error' },
    });
    expect(visibilityChanges).toEqual([]);
    expect(recorder.named('TimeToTerminalState')).toEqual([]);
  });

  it('applies on a later receive after retryable ones, counting every attempt', async () => {
    const operationId = await summaryOperation('flaky-0001');
    const worker = workerWith();
    for (const receiveCount of [1, 2, 3]) {
      await worker({ Records: [sqsRecord(formatCommandMessage(operationId), receiveCount)] });
    }
    expect(operationItem(operationId)).toMatchObject({ state: 'SUCCEEDED', attempts: 3 });
    expect(new Set(providerCalls.map((call) => call.idempotencyKey)).size).toBe(1);
  });
});

describe('before the provider is called (§6.3 steps 1 to 4)', () => {
  it.each([
    ['a body that is not JSON', '{"messageVersion":', 'not-json'],
    [
      'another messageVersion',
      JSON.stringify({ messageVersion: 2, operationId: '01JB0000000000000000000501' }),
      'version-mismatch',
    ],
    [
      'an unknown field',
      JSON.stringify({
        messageVersion: 1,
        operationId: '01JB0000000000000000000501',
        tenantId: 'tenant-1',
      }),
      'schema-invalid',
    ],
    [
      'a body over the bound',
      'x'.repeat(contractBounds.queueMessageBodyMaximumBytes + 1),
      'body-too-large',
    ],
  ])(
    'rejects %s: logged, counted and reported failed, with nothing read',
    async (_caseName, body, reason) => {
      const response = await workerWith()({ Records: [sqsRecord(body)] });
      expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'synthetic-message-1' }] });
      expect(recorder.events).toEqual([
        ['messageRejectedLog', reason],
        ['QueueMessageRejected', reason],
      ]);
      expect(journalTable.calls).toEqual([]);
    },
  );

  it('acknowledges a message for an operation that is not there, logging OperationMissing', async () => {
    const response = await workerWith()({
      Records: [sqsRecord(formatCommandMessage('01JB0000000000000000000599'))],
    });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(recorder.events).toEqual([['OperationMissing', '01JB0000000000000000000599']]);
  });

  it('acknowledges a duplicate delivery of a terminal operation, logged and counted, without a call', async () => {
    const operationId = await summaryOperation('record-0001');
    const worker = workerWith();
    await worker({ Records: [sqsRecord(formatCommandMessage(operationId))] });
    providerCalls.length = 0;
    const response = await worker({ Records: [sqsRecord(formatCommandMessage(operationId), 2)] });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(providerCalls).toEqual([]);
    expect(recorder.named('duplicateLog')).toEqual([['duplicateLog', operationId, 'SUCCEEDED']]);
    expect(recorder.named('DuplicateDelivery')).toHaveLength(1);
  });

  it('stops, without a call, when the operation awaits an operator: the move to APPLYING is stale', async () => {
    const operationId = await summaryOperation('poison-0001');
    const worker = workerWith();
    await worker({
      Records: [
        sqsRecord(formatCommandMessage(operationId), writePathSettings.commandMaximumReceives),
      ],
    });
    providerCalls.length = 0;
    const response = await worker({ Records: [sqsRecord(formatCommandMessage(operationId), 6)] });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(providerCalls).toEqual([]);
    expect(staleTransitions).toHaveLength(1);
  });

  it('lets an unexpected failure throw, so it counts as a function error (§11 WorkerErrors)', async () => {
    const operationId = await summaryOperation('record-0001');
    journalTable.failNext('Get', new Error('ProvisionedThroughputExceededException'));
    await expect(
      workerWith()({ Records: [sqsRecord(formatCommandMessage(operationId))] }),
    ).rejects.toThrow('ProvisionedThroughputExceededException');
  });
});

describe("WD1's covering tests (deviation entry 9)", () => {
  it('ends CONFLICT, with attempts of 1, a command applied after its record changed', async () => {
    const operationId = await summaryOperation('record-0001');
    // Another writer changes the record between acceptance and apply.
    const storedRecord = await providerDoubles.store.readRecord({
      providerId: 'provider-a',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
    });
    await providerDoubles.store.writeRecord(
      { providerId: 'provider-a', tenantId: 'tenant-1', recordId: 'record-0001' },
      {
        sections: {
          ...storedRecord?.sections,
          summary: { title: 'Changed meanwhile', status: 'active' },
        },
        updatedAt: '2026-10-18T09:31:00.000Z',
      },
    );
    await workerWith()({ Records: [sqsRecord(formatCommandMessage(operationId))] });
    expect(operationItem(operationId)).toMatchObject({ state: 'CONFLICT', attempts: 1 });
    const unchanged = await providerDoubles.store.readRecord({
      providerId: 'provider-a',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
    });
    expect(unchanged?.sections.summary).toEqual({ title: 'Changed meanwhile', status: 'active' });
  });

  it('applies five commands for one record in submission order, each written against the one before', async () => {
    const storedRecord = await providerDoubles.store.readRecord({
      providerId: 'provider-a',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
    });
    let sections = { ...storedRecord?.sections };
    const operationIds: string[] = [];
    for (const ordinal of [1, 2, 3, 4, 5]) {
      const summary = { title: `Synthetic ordered ${String(ordinal)}`, status: 'active' as const };
      operationIds.push(
        await queuedOperation({
          operationId: `01JB000000000000000000060${String(ordinal)}`,
          idempotencyKey: `00000000-0000-4000-8000-00000000060${String(ordinal)}`,
          baseVersion: computeProviderVersion(sections),
          payload: summary,
        }),
      );
      sections = { ...sections, summary };
    }
    const worker = workerWith();
    for (const [position, operationId] of operationIds.entries()) {
      await worker({
        Records: [
          sqsRecord(formatCommandMessage(operationId), 1, `synthetic-message-${String(position)}`),
        ],
      });
    }
    expect(operationIds.map((operationId) => operationItem(operationId)?.['state'])).toEqual([
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
    ]);
    const finalRecord = await providerDoubles.store.readRecord({
      providerId: 'provider-a',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
    });
    expect(finalRecord?.sections.summary).toEqual({
      title: 'Synthetic ordered 5',
      status: 'active',
    });
  });

  it('ends a command CONFLICT when it reaches the provider ahead of the one it was written after', async () => {
    const storedRecord = await providerDoubles.store.readRecord({
      providerId: 'provider-a',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
    });
    const firstSummary = { title: 'Synthetic first', status: 'active' as const };
    const first = await queuedOperation({
      operationId: '01JB0000000000000000000701',
      idempotencyKey: '00000000-0000-4000-8000-000000000701',
      baseVersion: computeProviderVersion({ ...storedRecord?.sections }),
      payload: firstSummary,
    });
    const second = await queuedOperation({
      operationId: '01JB0000000000000000000702',
      idempotencyKey: '00000000-0000-4000-8000-000000000702',
      baseVersion: computeProviderVersion({ ...storedRecord?.sections, summary: firstSummary }),
      payload: { title: 'Synthetic second', status: 'active' },
    });
    const worker = workerWith();
    await worker({ Records: [sqsRecord(formatCommandMessage(second))] });
    await worker({ Records: [sqsRecord(formatCommandMessage(first), 1, 'synthetic-message-2')] });
    // Why §5.2 groups a record's commands: out of order, If-Match refuses
    // the later one rather than letting it overwrite.
    expect([operationItem(second)?.['state'], operationItem(first)?.['state']]).toEqual([
      'CONFLICT',
      'SUCCEEDED',
    ]);
  });
});
