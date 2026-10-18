import {
  CommandRequestSchema,
  operationStateKind,
  type ApplyOutcome,
  type OperationState,
  type ProviderIdentifier,
  type WriteAdapter,
} from '@demo/contracts';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import {
  parseCommandMessage,
  type CommandMessageParse,
  type MessageVisibility,
} from '../command-queue';
import type { JournalStore, OperationDetail, StoredOperation } from '../journal-store';
import { retryVisibilitySeconds } from '../retry-backoff';
import { writePathSettings } from '../write-path-settings';

// Spec 03 §6.3: the worker. It applies each command once to its owning
// provider and records what happened. Delivery is at least once; the effect
// is at most once, because every attempt carries the same Idempotency-Key and
// If-Match (§2). An unexpected failure is thrown, so it counts as a function
// error (§11 WorkerErrors); every provider answer is an outcome instead.

export interface WorkerLog {
  // §11: operationId, providerId and attempts on every line once known.
  bindOperation(keys: { operationId: string; providerId: string; attempts: number }): void;
  recordMessageRejected(
    reason: Extract<CommandMessageParse, { outcome: 'rejected' }>['reason'],
  ): void;
  recordOperationMissing(operationId: string): void;
  recordDuplicateDelivery(operationId: string, state: OperationState): void;
  // Once per retry: what is retried, and why (datum 0.15).
  recordRetry(details: { reason: string; visibilitySeconds: number; receiveCount: number }): void;
}

// Spec 03 §11.
export interface WorkerMetrics {
  countQueueMessageRejected(
    reason: Extract<CommandMessageParse, { outcome: 'rejected' }>['reason'],
  ): void;
  countDuplicateDelivery(): void;
  // ApplyOutcome and ApplyLatency.
  recordApplyOutcome(details: {
    providerId: ProviderIdentifier;
    outcome: ApplyOutcome['kind'];
    reason: string | undefined;
    latencyMilliseconds: number;
  }): void;
  recordTimeToTerminalState(state: OperationState, milliseconds: number): void;
}

export interface WorkerHandlerDependencies {
  readonly journalStore: Pick<
    JournalStore,
    'readOperation' | 'transitionOperation' | 'recordLastErrorReason'
  >;
  // One per provider, in routing table order.
  readonly writeAdapters: readonly WriteAdapter[];
  readonly messageVisibility: MessageVisibility;
  readonly workerLog: WorkerLog;
  readonly workerMetrics: WorkerMetrics;
  readonly now: () => Date;
  readonly monotonicNow: () => number;
  // In [0, 1); the backoff's jitter (§6.4).
  readonly randomFraction: () => number;
  // WU15's per call abort; AbortSignal.timeout unless a test supplies one.
  readonly createCallSignal?: (timeoutMilliseconds: number) => AbortSignal;
}

type MessageResult = 'acknowledge' | 'report-failed';

function outcomeReason(outcome: ApplyOutcome): string | undefined {
  return outcome.kind === 'applied' ? undefined : outcome.reason;
}

export function createWorkerHandler(
  dependencies: WorkerHandlerDependencies,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  const { journalStore, workerLog, workerMetrics } = dependencies;
  const createCallSignal =
    dependencies.createCallSignal ??
    ((timeoutMilliseconds) => AbortSignal.timeout(timeoutMilliseconds));

  function adapterFor(providerId: ProviderIdentifier): WriteAdapter {
    const writeAdapter = dependencies.writeAdapters.find(
      (candidate) => candidate.providerId === providerId,
    );
    if (writeAdapter === undefined) {
      throw new Error(`write-adapter-missing: ${providerId}`);
    }
    return writeAdapter;
  }

  async function finish(
    operation: StoredOperation,
    targetState: OperationState,
    detail: OperationDetail,
  ): Promise<void> {
    const transition = await journalStore.transitionOperation({
      operationId: operation.operationId,
      targetState,
      origin: 'worker',
      detail,
    });
    if (transition.outcome === 'transitioned' && operationStateKind(targetState) === 'terminal') {
      workerMetrics.recordTimeToTerminalState(
        targetState,
        dependencies.now().getTime() - new Date(operation.createdAt).getTime(),
      );
    }
  }

  async function processMessage(messageRecord: SQSRecord): Promise<MessageResult> {
    // Step 1.
    const message = parseCommandMessage(messageRecord.body);
    if (message.outcome === 'rejected') {
      workerLog.recordMessageRejected(message.reason);
      workerMetrics.countQueueMessageRejected(message.reason);
      // Reported failed, so after its receives it reaches the dead letter
      // queue, where a person sees it.
      return 'report-failed';
    }
    // Step 2.
    const storedOperation = await journalStore.readOperation(message.operationId);
    if (storedOperation === undefined) {
      workerLog.recordOperationMissing(message.operationId);
      return 'acknowledge';
    }
    // Step 3.
    if (operationStateKind(storedOperation.state) === 'terminal') {
      workerLog.recordDuplicateDelivery(storedOperation.operationId, storedOperation.state);
      workerMetrics.countDuplicateDelivery();
      return 'acknowledge';
    }
    // Step 4. A stale move (an operation awaiting an operator, or moved by
    // another delivery) has been logged and counted by the store; stop.
    const applying = await journalStore.transitionOperation({
      operationId: storedOperation.operationId,
      targetState: 'APPLYING',
      origin: 'worker',
    });
    if (applying.outcome !== 'transitioned') {
      return 'acknowledge';
    }
    const operation = applying.operation;
    workerLog.bindOperation({
      operationId: operation.operationId,
      providerId: operation.providerId,
      attempts: operation.attempts,
    });
    // Step 5. Deviation entry 11: the client's own key, the provider wire's
    // grammar, the same on every attempt and redrive.
    const command = CommandRequestSchema.parse({
      type: operation.commandType,
      recordId: operation.recordId,
      section: operation.section,
      baseVersion: operation.baseVersion,
      payload: operation.payload,
    });
    const startedAt = dependencies.monotonicNow();
    const outcome = await adapterFor(operation.providerId).apply(
      { tenantId: operation.tenantId, command, idempotencyKey: operation.idempotencyKey },
      {
        abortSignal: createCallSignal(writePathSettings.workerCallTimeoutMilliseconds),
        // The operation names the request in the provider's own logs.
        correlationId: operation.operationId,
      },
    );
    workerMetrics.recordApplyOutcome({
      providerId: operation.providerId,
      outcome: outcome.kind,
      reason: outcomeReason(outcome),
      latencyMilliseconds: dependencies.monotonicNow() - startedAt,
    });
    // Step 6.
    switch (outcome.kind) {
      case 'applied':
        await finish(operation, 'SUCCEEDED', {
          result: { providerVersion: outcome.providerVersion },
        });
        return 'acknowledge';
      case 'conflict':
        await finish(operation, 'CONFLICT', {
          conflict: {
            reason: outcome.reason,
            ...(outcome.currentVersion === undefined
              ? {}
              : { currentVersion: outcome.currentVersion }),
          },
        });
        return 'acknowledge';
      case 'rejected':
        await finish(operation, 'FAILED', {
          failure: { code: outcome.code, reason: outcome.reason },
        });
        return 'acknowledge';
      case 'retryable': {
        // WU16: the receive count is SQS's own.
        const receiveCount = Number(messageRecord.attributes.ApproximateReceiveCount);
        if (receiveCount >= writePathSettings.commandMaximumReceives) {
          await finish(operation, 'DEAD_LETTERED', {
            failure: { code: 'retries-exhausted', reason: outcome.reason },
          });
          return 'report-failed';
        }
        await journalStore.recordLastErrorReason(operation.operationId, outcome.reason);
        const visibilitySeconds = retryVisibilitySeconds({
          receiveCount,
          ...(outcome.retryAfterMilliseconds === undefined
            ? {}
            : { retryAfterMilliseconds: outcome.retryAfterMilliseconds }),
          randomFraction: dependencies.randomFraction(),
        });
        workerLog.recordRetry({ reason: outcome.reason, visibilitySeconds, receiveCount });
        await dependencies.messageVisibility.setVisibilityTimeout(
          messageRecord.receiptHandle,
          visibilitySeconds,
        );
        return 'report-failed';
      }
    }
  }

  return async (event) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const [recordIndex, messageRecord] of event.Records.entries()) {
      if ((await processMessage(messageRecord)) === 'report-failed') {
        // A FIFO queue keeps order only if nothing after a failure is
        // processed, so the rest are reported failed unprocessed. With a
        // batch size of 1 there is never a rest (§6.2).
        batchItemFailures.push(
          ...event.Records.slice(recordIndex).map((failedRecord) => ({
            itemIdentifier: failedRecord.messageId,
          })),
        );
        break;
      }
    }
    return { batchItemFailures };
  };
}
