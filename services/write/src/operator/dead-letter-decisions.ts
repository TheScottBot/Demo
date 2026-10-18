import type { OperationState, ProviderIdentifier } from '@demo/contracts';
import type { CommandMessageParse } from '../command-queue';
import type { StoredOperation } from '../journal-store';

// Spec 03 §8.2: every operator decision, so the scripts only print what this
// returns and pass on the operator's answers. A command that failed every
// attempt needs a person's decision, so nothing here acts on its own. This
// module is pure: it imports only types.

export const operatorActions = ['redrive', 'discard', 'skip'] as const;

export type OperatorAction = (typeof operatorActions)[number];

export type DeadLetterView =
  | {
      readonly kind: 'operation';
      readonly messageId: string;
      readonly operationId: string;
      readonly tenantId: string;
      readonly recordId: string;
      readonly providerId: ProviderIdentifier;
      readonly state: OperationState;
      readonly attempts: number;
      readonly redriveCount: number;
      readonly lastErrorReason: string | undefined;
      readonly createdAt: string;
      // §8.1: any operation not DEAD_LETTERED is flagged, such as one left
      // APPLYING by a timeout on its last receive (WU18).
      readonly flagged: boolean;
    }
  | {
      readonly kind: 'unreadable';
      readonly messageId: string;
      readonly reason: Extract<CommandMessageParse, { outcome: 'rejected' }>['reason'];
    }
  | { readonly kind: 'missing'; readonly messageId: string; readonly operationId: string };

export function describeDeadLetter(
  messageId: string,
  message: CommandMessageParse,
  operation: StoredOperation | undefined,
): DeadLetterView {
  if (message.outcome === 'rejected') {
    return { kind: 'unreadable', messageId, reason: message.reason };
  }
  if (operation === undefined) {
    return { kind: 'missing', messageId, operationId: message.operationId };
  }
  return {
    kind: 'operation',
    messageId,
    operationId: operation.operationId,
    tenantId: operation.tenantId,
    recordId: operation.recordId,
    providerId: operation.providerId,
    state: operation.state,
    attempts: operation.attempts,
    redriveCount: operation.redriveCount,
    lastErrorReason: operation.lastErrorReason,
    createdAt: operation.createdAt,
    flagged: operation.state !== 'DEAD_LETTERED',
  };
}

// One line per message, of §8.1's fields and nothing of the command.
export function formatDeadLetterLine(view: DeadLetterView): string {
  switch (view.kind) {
    case 'unreadable':
      return `${view.messageId}: unreadable message (${view.reason})`;
    case 'missing':
      return `${view.messageId}: operation ${view.operationId} is not in the journal`;
    case 'operation':
      return [
        `${view.messageId}: ${view.operationId}`,
        view.tenantId,
        view.recordId,
        view.providerId,
        view.state,
        `attempts ${String(view.attempts)}`,
        `redrives ${String(view.redriveCount)}`,
        view.lastErrorReason ?? 'no error reason',
        view.createdAt,
        ...(view.flagged ? ['NOT DEAD_LETTERED'] : []),
      ].join(' | ');
  }
}

const operatorAnswers: Record<string, OperatorAction> = {
  r: 'redrive',
  redrive: 'redrive',
  d: 'discard',
  discard: 'discard',
  s: 'skip',
  skip: 'skip',
};

export function parseOperatorAnswer(answer: string): OperatorAction | undefined {
  return operatorAnswers[answer.trim().toLowerCase()];
}

// A message with no operation has nothing to apply, so it can only be
// deleted or left.
export function allowedOperatorActions(view: DeadLetterView): readonly OperatorAction[] {
  return view.kind === 'operation' ? operatorActions : ['discard', 'skip'];
}

export type OperatorStep =
  'move-to-queued' | 'send-redrive-message' | 'move-to-failed' | 'delete-dead-letter';

// §8.2's orders. Each step is safe to repeat, so a rerun after a partial
// failure at any step finishes the action: the transitions find their own
// target already set (§4.3), the send reuses its deduplication identifier,
// and a delete of the message is the last thing done.
export function operatorStepsFor(
  action: OperatorAction,
  viewKind: DeadLetterView['kind'],
): readonly OperatorStep[] {
  if (action === 'skip') {
    return [];
  }
  if (viewKind !== 'operation') {
    return action === 'discard' ? ['delete-dead-letter'] : [];
  }
  return action === 'redrive'
    ? ['move-to-queued', 'send-redrive-message', 'delete-dead-letter']
    : ['move-to-failed', 'delete-dead-letter'];
}

// §8.2 step 2: the stored redrive count, not a fresh one, so a rerun sends
// the same message and SQS drops the second within its window (WU8).
export function redriveDeduplicationId(operationId: string, redriveCount: number): string {
  return `${operationId}#r${String(redriveCount)}`;
}

export const operatorDiscardFailure = {
  code: 'operator-discarded',
  reason: 'discarded by an operator after every attempt failed',
} as const;
