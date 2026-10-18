import { formatCommandMessage, type CommandQueueSender } from './command-queue';
import type { JournalStore } from './journal-store';
import { messageGroupFor } from './message-group';

// Spec 03 §5.2, shared by the relay and the sweep: send, then move to QUEUED.
// Sending first means a failure between the two leaves the operation ACCEPTED,
// where the sweep finds it and sends again; within the deduplication window
// SQS drops that duplicate (WU8), and after it the worker's state check makes
// it harmless (§6.3).

export interface EnqueueDependencies {
  readonly commandQueue: CommandQueueSender;
  readonly journalStore: Pick<JournalStore, 'transitionOperation'>;
}

export interface EnqueuedOperation {
  readonly operationId: string;
  readonly tenantId: string;
  readonly recordId: string;
}

export async function enqueueOperation(
  dependencies: EnqueueDependencies,
  operation: EnqueuedOperation,
  origin: 'relay' | 'sweep',
): Promise<'queued' | 'already-moved'> {
  await dependencies.commandQueue.sendCommandMessage({
    body: formatCommandMessage(operation.operationId),
    messageGroupId: messageGroupFor(operation.tenantId, operation.recordId),
    messageDeduplicationId: operation.operationId,
  });
  const transition = await dependencies.journalStore.transitionOperation({
    operationId: operation.operationId,
    targetState: 'QUEUED',
    origin,
  });
  // A stale transition is expected here: the worker may already have the
  // message. The store has logged and counted it once (§4.3).
  return transition.outcome === 'transitioned' ? 'queued' : 'already-moved';
}
