// Spec 03 §5.3 and WE3: the recovery sweep, over the fake journal table.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSweepHandler,
  type SweepLog,
  type SweepMetrics,
} from '../src/handlers/sweep-handler';
import { createJournalStore, type JournalStore } from '../src/journal-store';
import { writePathSettings } from '../src/write-path-settings';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';
import { createRecordingCommandQueue, newOperation } from './support/write-path-fixtures';

class RecordingSweep implements SweepLog, SweepMetrics {
  readonly events: unknown[][] = [];
  recordAbsentSubsystem(subsystem: string, reason: string): void {
    this.events.push(['absent', subsystem, reason]);
  }
  recordRecovery(): void {
    this.events.push(['recoveryLog']);
  }
  countSweepRecovered(): void {
    this.events.push(['SweepRecovered']);
  }
  countSweepLimitReached(limit: 'batch' | 'time'): void {
    this.events.push(['SweepLimitReached', limit]);
  }
  named(eventName: string): unknown[][] {
    return this.events.filter((recordedEvent) => recordedEvent[0] === eventName);
  }
}

const startedAt = new Date('2026-10-18T09:30:00.000Z');
let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
let recorder: RecordingSweep;
let currentTime: Date;

beforeEach(() => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingSweep();
  currentTime = startedAt;
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: () => undefined },
    metrics: { countStaleTransition: () => undefined, countJournalItemRejected: () => undefined },
    now: () => currentTime,
  });
});

afterEach(() => {
  journalTable.restore();
});

async function acceptOperation(ordinal: number): Promise<void> {
  await journalStore.createOperation(
    newOperation({
      operationId: `01JB000000000000000000010${String(ordinal)}`,
      idempotencyKey: `00000000-0000-4000-8000-00000000010${String(ordinal)}`,
      recordId: `record-000${String(ordinal)}`,
    }),
  );
}

function laterBy(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

function stateOf(ordinal: number): unknown {
  return journalTable.itemAt(`OP#01JB000000000000000000010${String(ordinal)}`, 'OP')?.['state'];
}

describe('the sweep (§5.3)', () => {
  it('sends only operations still ACCEPTED and past the grace period, moving them to QUEUED', async () => {
    await acceptOperation(1);
    await acceptOperation(2);
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000102',
      targetState: 'QUEUED',
      origin: 'relay',
    });
    laterBy(writePathSettings.sweepGracePeriodSeconds * 1_000 - 10_000);
    // Within the grace period when the sweep runs.
    await acceptOperation(3);
    laterBy(10_001);
    const commandQueue = createRecordingCommandQueue();
    await createSweepHandler({
      journalStore,
      commandQueue,
      sweepLog: recorder,
      sweepMetrics: recorder,
      relayEnabled: true,
      now: () => currentTime,
      monotonicNow: () => 0,
    })();
    expect(commandQueue.sent.map((message) => message.messageDeduplicationId)).toEqual([
      '01JB0000000000000000000101',
    ]);
    expect([stateOf(1), stateOf(2), stateOf(3)]).toEqual(['QUEUED', 'QUEUED', 'ACCEPTED']);
    expect(
      journalTable.itemAt('OP#01JB0000000000000000000101', 'OP')?.['lastTransitionOrigin'],
    ).toBe('sweep');
    expect(recorder.named('SweepRecovered')).toHaveLength(1);
  });

  it('skips a listed operation that has moved on since the index was read', async () => {
    await acceptOperation(1);
    // Still in the index, as an eventually consistent index can be, but QUEUED.
    journalTable.putItem({
      ...journalTable.itemAt('OP#01JB0000000000000000000101', 'OP'),
      state: 'QUEUED',
    });
    laterBy(120_000);
    const commandQueue = createRecordingCommandQueue();
    await createSweepHandler({
      journalStore,
      commandQueue,
      sweepLog: recorder,
      sweepMetrics: recorder,
      relayEnabled: true,
      now: () => currentTime,
      monotonicNow: () => 0,
    })();
    expect(commandQueue.sent).toEqual([]);
    expect(recorder.events).toEqual([]);
  });

  it('logs once per run that it is recovering, however many it sends, and not at all when none', async () => {
    await acceptOperation(1);
    await acceptOperation(2);
    laterBy(120_000);
    const sweep = createSweepHandler({
      journalStore,
      commandQueue: createRecordingCommandQueue(),
      sweepLog: recorder,
      sweepMetrics: recorder,
      relayEnabled: true,
      now: () => currentTime,
      monotonicNow: () => 0,
    });
    await sweep();
    expect(recorder.named('recoveryLog')).toHaveLength(1);
    expect(recorder.named('SweepRecovered')).toHaveLength(2);
    await sweep();
    expect(recorder.named('recoveryLog')).toHaveLength(1);
  });

  it('stops at its batch limit, and counts the run', async () => {
    for (const ordinal of [1, 2, 3]) {
      await acceptOperation(ordinal);
    }
    laterBy(120_000);
    const commandQueue = createRecordingCommandQueue();
    await createSweepHandler({
      journalStore,
      commandQueue,
      sweepLog: recorder,
      sweepMetrics: recorder,
      relayEnabled: true,
      now: () => currentTime,
      monotonicNow: () => 0,
      limits: {
        batchLimit: 2,
        timeLimitMilliseconds: writePathSettings.sweepTimeLimitMilliseconds,
      },
    })();
    expect(commandQueue.sent).toHaveLength(2);
    expect(recorder.named('SweepLimitReached')).toEqual([['SweepLimitReached', 'batch']]);
  });

  it('stops at its time limit, and counts the run, not the batch limit as well', async () => {
    for (const ordinal of [1, 2, 3]) {
      await acceptOperation(ordinal);
    }
    laterBy(120_000);
    let elapsed = 0;
    const commandQueue = createRecordingCommandQueue();
    await createSweepHandler({
      journalStore,
      commandQueue,
      sweepLog: recorder,
      sweepMetrics: recorder,
      relayEnabled: true,
      now: () => currentTime,
      // Each look at the clock finds 30 seconds gone.
      monotonicNow: () => {
        const reading = elapsed;
        elapsed += 30_000;
        return reading;
      },
      limits: { batchLimit: 3, timeLimitMilliseconds: 50_000 },
    })();
    // The clock reads 0 at the start, 30 seconds before the first operation
    // and 60 before the second, past the 50 second limit.
    expect(commandQueue.sent).toHaveLength(1);
    expect(recorder.named('SweepLimitReached')).toEqual([['SweepLimitReached', 'time']]);
  });

  it('logs the absent relay at cold start when relayEnabled is false, and not otherwise (Spec 00 §5.1)', () => {
    const dependencies = {
      journalStore,
      commandQueue: createRecordingCommandQueue(),
      sweepLog: recorder,
      sweepMetrics: recorder,
      now: () => currentTime,
      monotonicNow: () => 0,
    };
    createSweepHandler({ ...dependencies, relayEnabled: true });
    expect(recorder.named('absent')).toEqual([]);
    createSweepHandler({ ...dependencies, relayEnabled: false });
    expect(recorder.named('absent')).toEqual([['absent', 'relay', expect.any(String) as string]]);
  });

  it('runs on the 2 minute schedule with the grace and limits WU9 and WU10 give it', () => {
    expect(writePathSettings).toMatchObject({
      sweepIntervalMinutes: 2,
      sweepGracePeriodSeconds: 60,
      sweepBatchLimit: 100,
      sweepTimeLimitMilliseconds: 50_000,
    });
  });
});
