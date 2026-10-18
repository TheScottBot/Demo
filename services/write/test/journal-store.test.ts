// Spec 03 §4 and WE1: the journal store, the only module that touches the
// command journal table, run against the fake table behind
// aws-sdk-client-mock.
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJournalStore,
  JournalItemRejectedError,
  type JournalLog,
  type JournalMetrics,
  type JournalStore,
} from '../src/journal-store';
import type { TransitionOrigin } from '../src/operation-state-machine';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';
import { newOperation } from './support/write-path-fixtures';

const createdAt = new Date('2026-10-18T09:30:00.000Z');
const secondsPerDay = 86_400;

class RecordingJournal implements JournalLog, JournalMetrics {
  readonly events: unknown[][] = [];
  recordStaleTransition(details: {
    operationId: string;
    origin: TransitionOrigin;
    targetState: string;
    currentState: string | undefined;
  }): void {
    this.events.push([
      'staleLog',
      details.operationId,
      details.origin,
      details.targetState,
      details.currentState ?? null,
    ]);
  }
  countStaleTransition(origin: TransitionOrigin): void {
    this.events.push(['StaleTransition', origin]);
  }
  countJournalItemRejected(reason: string, itemKind: string): void {
    this.events.push(['JournalItemRejected', reason, itemKind]);
  }
}

let journalTable: FakeCommandJournalTable;
let recorder: RecordingJournal;
let journalStore: JournalStore;
let currentTime: Date;

beforeEach(() => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingJournal();
  currentTime = createdAt;
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: recorder,
    metrics: recorder,
    now: () => currentTime,
  });
});

afterEach(() => {
  journalTable.restore();
});

function laterBy(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

describe('createOperation (§3.1 step 7, §4.1)', () => {
  it('writes the operation and its idempotency entry in one transaction, each only if new', async () => {
    const created = await journalStore.createOperation(newOperation());
    expect(created.outcome).toBe('created');
    expect(journalTable.calls.map((call) => call.command)).toEqual(['TransactWrite']);
    const createdAtSeconds = createdAt.getTime() / 1_000;
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toEqual({
      partitionKey: 'OP#01JB0000000000000000000101',
      sortKey: 'OP',
      schemaVersion: 1,
      operationId: '01JB0000000000000000000101',
      tenantId: 'tenant-1',
      recordId: 'record-0001',
      providerId: 'provider-a',
      section: 'summary',
      commandType: 'record.section.replace',
      baseVersion: '0123456789abcdef',
      payload: { title: 'Synthetic summary', status: 'active' },
      idempotencyKey: '00000000-0000-4000-8000-000000000101',
      requestHash: 'a'.repeat(64),
      state: 'ACCEPTED',
      attempts: 0,
      redriveCount: 0,
      createdAt: '2026-10-18T09:30:00.000Z',
      updatedAt: '2026-10-18T09:30:00.000Z',
      lastTransitionOrigin: 'intake',
      pendingBucket: 'PENDING',
      pendingSince: '2026-10-18T09:30:00.000Z',
      // WD3: operations are kept 30 days.
      expiresAt: createdAtSeconds + 30 * secondsPerDay,
    });
    expect(
      journalTable.itemAt('IDEM#tenant-1#00000000-0000-4000-8000-000000000101', 'IDEM'),
    ).toEqual({
      partitionKey: 'IDEM#tenant-1#00000000-0000-4000-8000-000000000101',
      sortKey: 'IDEM',
      schemaVersion: 1,
      operationId: '01JB0000000000000000000101',
      requestHash: 'a'.repeat(64),
      createdAt: '2026-10-18T09:30:00.000Z',
      // WD3: idempotency entries are kept 7 days.
      expiresAt: createdAtSeconds + 7 * secondsPerDay,
    });
  });

  it('reports an existing idempotency entry from the cancelled transaction itself (WU2)', async () => {
    await journalStore.createOperation(newOperation());
    const repeated = await journalStore.createOperation(
      newOperation({ operationId: '01JB0000000000000000000102', requestHash: 'b'.repeat(64) }),
    );
    expect(repeated).toEqual({
      outcome: 'idempotency-entry-exists',
      idempotencyEntry: {
        operationId: '01JB0000000000000000000101',
        requestHash: 'a'.repeat(64),
        createdAt: '2026-10-18T09:30:00.000Z',
      },
    });
    expect(journalTable.calls.map((call) => call.command)).toEqual([
      'TransactWrite',
      'TransactWrite',
    ]);
    expect(journalTable.itemAt('OP#01JB0000000000000000000102', 'OP')).toBeUndefined();
  });

  it('lets any other transaction failure through, so intake answers 500 (§3.2)', async () => {
    const conflictFailure = new TransactionCanceledException({
      message: 'Transaction cancelled',
      $metadata: {},
      CancellationReasons: [{ Code: 'TransactionConflict' }, { Code: 'None' }],
    });
    journalTable.failNext('TransactWrite', conflictFailure);
    await expect(journalStore.createOperation(newOperation())).rejects.toBe(conflictFailure);
    const throttled = new Error('ProvisionedThroughputExceededException');
    journalTable.failNext('TransactWrite', throttled);
    await expect(journalStore.createOperation(newOperation())).rejects.toBe(throttled);
  });
});

describe('readOperation and readIdempotencyEntry (§4.1)', () => {
  it('reads strongly consistently, and answers undefined for an absent item', async () => {
    await journalStore.createOperation(newOperation());
    const operation = await journalStore.readOperation('01JB0000000000000000000101');
    expect(operation?.state).toBe('ACCEPTED');
    expect(operation?.payload).toEqual({ title: 'Synthetic summary', status: 'active' });
    expect(await journalStore.readOperation('01JB0000000000000000000199')).toBeUndefined();
    expect(
      await journalStore.readIdempotencyEntry('tenant-1', '00000000-0000-4000-8000-000000000101'),
    ).toEqual({
      operationId: '01JB0000000000000000000101',
      requestHash: 'a'.repeat(64),
      createdAt: '2026-10-18T09:30:00.000Z',
    });
    expect(
      await journalStore.readIdempotencyEntry('tenant-2', '00000000-0000-4000-8000-000000000101'),
    ).toBeUndefined();
    expect(
      journalTable.calls
        .filter((call) => call.command === 'Get')
        .every((call) => call.input['ConsistentRead'] === true),
    ).toBe(true);
  });

  it('refuses and counts an operation item of another schemaVersion', async () => {
    await journalStore.createOperation(newOperation());
    const storedItem = journalTable.itemAt('OP#01JB0000000000000000000101', 'OP');
    journalTable.putItem({ ...storedItem, schemaVersion: 2 });
    await expect(journalStore.readOperation('01JB0000000000000000000101')).rejects.toBeInstanceOf(
      JournalItemRejectedError,
    );
    expect(recorder.events).toEqual([['JournalItemRejected', 'version-mismatch', 'operation']]);
  });

  it('refuses and counts an idempotency item of another schemaVersion', async () => {
    await journalStore.createOperation(newOperation());
    const storedItem = journalTable.itemAt(
      'IDEM#tenant-1#00000000-0000-4000-8000-000000000101',
      'IDEM',
    );
    journalTable.putItem({ ...storedItem, schemaVersion: 0 });
    await expect(
      journalStore.readIdempotencyEntry('tenant-1', '00000000-0000-4000-8000-000000000101'),
    ).rejects.toBeInstanceOf(JournalItemRejectedError);
    expect(recorder.events).toEqual([['JournalItemRejected', 'version-mismatch', 'idempotency']]);
  });

  it('refuses and counts an item that breaks its schema, such as an unknown attribute', async () => {
    await journalStore.createOperation(newOperation());
    const storedItem = journalTable.itemAt('OP#01JB0000000000000000000101', 'OP');
    journalTable.putItem({ ...storedItem, unexpectedAttribute: 'synthetic' });
    await expect(journalStore.readOperation('01JB0000000000000000000101')).rejects.toBeInstanceOf(
      JournalItemRejectedError,
    );
    expect(recorder.events).toEqual([['JournalItemRejected', 'schema-invalid', 'operation']]);
  });
});

describe('transitionOperation (§4.3, §7)', () => {
  beforeEach(async () => {
    await journalStore.createOperation(newOperation());
    laterBy(1_000);
  });

  it('moves the state by a conditional update on its allowed sources, and leaves the pending index', async () => {
    const queued = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'QUEUED',
      origin: 'relay',
    });
    expect(queued.outcome).toBe('transitioned');
    const updateCall = journalTable.calls.find((call) => call.command === 'Update');
    expect(updateCall?.input['ConditionExpression']).toBe('#state IN (:sourceState0)');
    expect(updateCall?.input['ExpressionAttributeValues']).toMatchObject({
      ':sourceState0': 'ACCEPTED',
    });
    const storedItem = journalTable.itemAt('OP#01JB0000000000000000000101', 'OP');
    expect(storedItem).toMatchObject({
      state: 'QUEUED',
      updatedAt: '2026-10-18T09:30:01.000Z',
      lastTransitionOrigin: 'relay',
      attempts: 0,
    });
    expect(storedItem).not.toHaveProperty('pendingBucket');
    expect(storedItem).not.toHaveProperty('pendingSince');
  });

  it('adds an attempt on each move to APPLYING, from ACCEPTED, QUEUED or APPLYING (§6.3 step 4)', async () => {
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    const again = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    expect(again.outcome === 'transitioned' ? again.operation.attempts : undefined).toBe(2);
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).not.toHaveProperty(
      'pendingBucket',
    );
  });

  it('sets the detail its target state carries, and clears any other', async () => {
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'DEAD_LETTERED',
      origin: 'worker',
      detail: { failure: { code: 'provider-unavailable', reason: 'retries exhausted' } },
    });
    const redriven = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'QUEUED',
      origin: 'operator',
    });
    expect(redriven.outcome).toBe('transitioned');
    const storedItem = journalTable.itemAt('OP#01JB0000000000000000000101', 'OP');
    expect(storedItem).toMatchObject({ state: 'QUEUED', redriveCount: 1, attempts: 1 });
    expect(storedItem).not.toHaveProperty('failure');
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    const succeeded = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'SUCCEEDED',
      origin: 'worker',
      detail: { result: { providerVersion: 'fedcba9876543210' } },
    });
    expect(succeeded.outcome === 'transitioned' ? succeeded.operation : undefined).toMatchObject({
      state: 'SUCCEEDED',
      result: { providerVersion: 'fedcba9876543210' },
      attempts: 2,
      redriveCount: 1,
    });
  });

  it('cannot be called without an origin (datum 0.14)', async () => {
    await expect(
      journalStore.transitionOperation(
        // @ts-expect-error: the origin is a required argument.
        { operationId: '01JB0000000000000000000101', targetState: 'QUEUED' },
      ),
    ).rejects.toThrow('transition-origin-required');
    await expect(
      journalStore.transitionOperation({
        operationId: '01JB0000000000000000000101',
        targetState: 'QUEUED',
        origin: 'somebody' as TransitionOrigin,
      }),
    ).rejects.toThrow('transition-origin-required');
    expect(journalTable.calls.filter((call) => call.command === 'Update')).toEqual([]);
  });

  it('refuses, without a request, a transition the state machine does not hold, or a missing detail', async () => {
    await expect(
      journalStore.transitionOperation({
        operationId: '01JB0000000000000000000101',
        targetState: 'SUCCEEDED',
        origin: 'relay',
        detail: { result: { providerVersion: 'fedcba9876543210' } },
      }),
    ).rejects.toThrow('transition-not-in-state-machine');
    await expect(
      journalStore.transitionOperation({
        operationId: '01JB0000000000000000000101',
        targetState: 'ACCEPTED',
        origin: 'intake',
      }),
    ).rejects.toThrow('transition-not-in-state-machine');
    await expect(
      journalStore.transitionOperation({
        operationId: '01JB0000000000000000000101',
        targetState: 'SUCCEEDED',
        origin: 'worker',
      }),
    ).rejects.toThrow('transition-detail-mismatch');
    await expect(
      journalStore.transitionOperation({
        operationId: '01JB0000000000000000000101',
        targetState: 'QUEUED',
        origin: 'relay',
        detail: { failure: { code: 'synthetic', reason: 'synthetic' } },
      }),
    ).rejects.toThrow('transition-detail-mismatch');
    expect(journalTable.calls.filter((call) => call.command === 'Update')).toEqual([]);
  });

  it.each(['relay', 'sweep', 'worker'] as const)(
    'on a stale condition for %s, logs and counts StaleTransition once, and stops',
    async (origin) => {
      // Moved on already, so none of these origins' sources holds.
      journalTable.putItem({
        ...journalTable.itemAt('OP#01JB0000000000000000000101', 'OP'),
        state: 'SUCCEEDED',
        result: { providerVersion: 'fedcba9876543210' },
      });
      const before = structuredClone(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP'));
      const stale = await journalStore.transitionOperation({
        operationId: '01JB0000000000000000000101',
        targetState: origin === 'worker' ? 'APPLYING' : 'QUEUED',
        origin,
      });
      expect(stale).toEqual({ outcome: 'stale', currentState: 'SUCCEEDED' });
      expect(recorder.events).toEqual([
        [
          'staleLog',
          '01JB0000000000000000000101',
          origin,
          origin === 'worker' ? 'APPLYING' : 'QUEUED',
          'SUCCEEDED',
        ],
        ['StaleTransition', origin],
      ]);
      expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toEqual(before);
      expect(journalTable.calls.filter((call) => call.command === 'Update')).toHaveLength(1);
    },
  );

  it('treats a stale condition on a missing operation as stale too', async () => {
    const stale = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000199',
      targetState: 'QUEUED',
      origin: 'sweep',
    });
    expect(stale).toEqual({ outcome: 'stale', currentState: undefined });
    expect(recorder.events).toEqual([
      ['staleLog', '01JB0000000000000000000199', 'sweep', 'QUEUED', null],
      ['StaleTransition', 'sweep'],
    ]);
  });

  it('reports done when an operator transition finds its target already set, keeping redriveCount (§8.2)', async () => {
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'DEAD_LETTERED',
      origin: 'worker',
      detail: { failure: { code: 'provider-unavailable', reason: 'retries exhausted' } },
    });
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'QUEUED',
      origin: 'operator',
    });
    const rerun = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'QUEUED',
      origin: 'operator',
    });
    expect(rerun.outcome).toBe('already-done');
    expect(rerun.outcome === 'already-done' ? rerun.operation.redriveCount : undefined).toBe(1);
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toMatchObject({
      redriveCount: 1,
    });
    expect(recorder.events).toEqual([]);
  });

  it('stops an operator transition that finds any other state, without a stale count', async () => {
    const stopped = await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'FAILED',
      origin: 'operator',
      detail: { failure: { code: 'operator-discarded', reason: 'discarded by an operator' } },
    });
    expect(stopped).toEqual({ outcome: 'stopped', currentState: 'ACCEPTED' });
    expect(recorder.events).toEqual([]);
  });
});

describe('recordLastErrorReason (§6.3, the WE1 finding)', () => {
  beforeEach(async () => {
    await journalStore.createOperation(newOperation());
  });

  it('saves the reason on an APPLYING operation, changing nothing else', async () => {
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000101',
      targetState: 'APPLYING',
      origin: 'worker',
    });
    const before = structuredClone(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP'));
    expect(
      await journalStore.recordLastErrorReason('01JB0000000000000000000101', 'server-error'),
    ).toBe('recorded');
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).toEqual({
      ...before,
      lastErrorReason: 'server-error',
    });
  });

  it('saves nothing on an operation no longer APPLYING', async () => {
    expect(
      await journalStore.recordLastErrorReason('01JB0000000000000000000101', 'server-error'),
    ).toBe('not-applying');
    expect(journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')).not.toHaveProperty(
      'lastErrorReason',
    );
  });
});

describe('listPendingOperations (§4.2, §5.3)', () => {
  it('lists operations still pending since before the cutoff, oldest first, up to the limit', async () => {
    for (const ordinal of [1, 2, 3, 4]) {
      await journalStore.createOperation(
        newOperation({
          operationId: `01JB000000000000000000010${String(ordinal)}`,
          idempotencyKey: `00000000-0000-4000-8000-00000000010${String(ordinal)}`,
          tenantId: ordinal === 3 ? 'tenant-2' : 'tenant-1',
        }),
      );
      laterBy(10_000);
    }
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000102',
      targetState: 'QUEUED',
      origin: 'relay',
    });
    const cutoff = new Date('2026-10-18T09:30:25.000Z');
    expect(await journalStore.listPendingOperations({ pendingBefore: cutoff, limit: 10 })).toEqual([
      { operationId: '01JB0000000000000000000101', tenantId: 'tenant-1' },
      { operationId: '01JB0000000000000000000103', tenantId: 'tenant-2' },
    ]);
    expect(await journalStore.listPendingOperations({ pendingBefore: cutoff, limit: 1 })).toEqual([
      { operationId: '01JB0000000000000000000101', tenantId: 'tenant-1' },
    ]);
  });

  it('follows pages until the limit is reached', async () => {
    for (const ordinal of [1, 2, 3]) {
      await journalStore.createOperation(
        newOperation({
          operationId: `01JB000000000000000000010${String(ordinal)}`,
          idempotencyKey: `00000000-0000-4000-8000-00000000010${String(ordinal)}`,
        }),
      );
      laterBy(1_000);
    }
    const pending = await journalStore.listPendingOperations({
      pendingBefore: currentTime,
      limit: 3,
      pageSize: 2,
    });
    expect(pending.map((pendingOperation) => pendingOperation.operationId)).toEqual([
      '01JB0000000000000000000101',
      '01JB0000000000000000000102',
      '01JB0000000000000000000103',
    ]);
    expect(journalTable.calls.filter((call) => call.command === 'Query')).toHaveLength(2);
  });
});
