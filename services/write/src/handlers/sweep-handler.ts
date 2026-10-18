import type { CommandQueueSender } from '../command-queue';
import { enqueueOperation } from '../enqueue-operation';
import type { JournalStore } from '../journal-store';
import { writePathSettings } from '../write-path-settings';

// Spec 03 §5.3: the recovery sweep. It finds operations the relay has not
// moved, past a grace period, and sends them itself. It is the reason a 202
// holds even when the relay fails or is absent.

export interface SweepLog {
  // Spec 00 §5.1: an absent optional subsystem is a fact at cold start.
  recordAbsentSubsystem(subsystem: 'relay', reason: string): void;
  // Once per run that sends anything: what is retried, and why (datum 0.15).
  recordRecovery(): void;
}

// Spec 03 §11.
export interface SweepMetrics {
  countSweepRecovered(): void;
  countSweepLimitReached(limit: 'batch' | 'time'): void;
}

export interface SweepHandlerDependencies {
  readonly journalStore: Pick<
    JournalStore,
    'listPendingOperations' | 'readOperation' | 'transitionOperation'
  >;
  readonly commandQueue: CommandQueueSender;
  readonly sweepLog: SweepLog;
  readonly sweepMetrics: SweepMetrics;
  readonly relayEnabled: boolean;
  readonly now: () => Date;
  readonly monotonicNow: () => number;
  // WU10 unless a caller narrows them.
  readonly limits?: { readonly batchLimit: number; readonly timeLimitMilliseconds: number };
}

export function createSweepHandler(dependencies: SweepHandlerDependencies): () => Promise<void> {
  const { journalStore, sweepLog, sweepMetrics } = dependencies;
  const limits = dependencies.limits ?? {
    batchLimit: writePathSettings.sweepBatchLimit,
    timeLimitMilliseconds: writePathSettings.sweepTimeLimitMilliseconds,
  };
  if (!dependencies.relayEnabled) {
    sweepLog.recordAbsentSubsystem('relay', 'relayEnabled is false in this stage');
  }

  return async () => {
    const startedAt = dependencies.monotonicNow();
    const pendingBefore = new Date(
      dependencies.now().getTime() - writePathSettings.sweepGracePeriodSeconds * 1_000,
    );
    const pendingOperations = await journalStore.listPendingOperations({
      pendingBefore,
      limit: limits.batchLimit,
    });
    let recovered = 0;
    let stoppedByTime = false;
    for (const pendingOperation of pendingOperations) {
      if (dependencies.monotonicNow() - startedAt >= limits.timeLimitMilliseconds) {
        stoppedByTime = true;
        break;
      }
      // The index is eventually consistent, so the operation itself decides.
      const operation = await journalStore.readOperation(pendingOperation.operationId);
      if (operation?.state !== 'ACCEPTED') {
        continue;
      }
      if (recovered === 0) {
        sweepLog.recordRecovery();
      }
      await enqueueOperation(dependencies, operation, 'sweep');
      recovered += 1;
      sweepMetrics.countSweepRecovered();
    }
    if (stoppedByTime) {
      sweepMetrics.countSweepLimitReached('time');
    } else if (pendingOperations.length === limits.batchLimit) {
      // A full page: more may be waiting for the next run.
      sweepMetrics.countSweepLimitReached('batch');
    }
  };
}
