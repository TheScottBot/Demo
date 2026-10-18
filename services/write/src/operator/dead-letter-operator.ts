import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import {
  formatCommandMessage,
  parseCommandMessage,
  type CommandQueueSender,
} from '../command-queue';
import type { JournalStore } from '../journal-store';
import { messageGroupFor } from '../message-group';
import {
  allowedOperatorActions,
  describeDeadLetter,
  operatorDiscardFailure,
  operatorStepsFor,
  redriveDeduplicationId,
  type DeadLetterView,
  type OperatorAction,
} from './dead-letter-decisions';

// Spec 03 §8.2: carries out what dead-letter-decisions.ts decides, with the
// operator's own credentials. Redrive and discard each delete a message, so
// they are destructive operations (datum 0.14): explicit, safe to rerun,
// logged without personal data, and recorded with origin operator.

export interface DeadLetterMessage {
  readonly messageId: string;
  readonly receiptHandle: string;
  readonly body: string;
}

export interface DeadLetterQueue {
  receiveMessages(): Promise<DeadLetterMessage[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
}

export type OperatorOutcome = 'redriven' | 'discarded' | 'skipped' | 'stopped';

export interface OperatorLog {
  // §8.2: each action with operationId, the action and the outcome.
  recordOperatorAction(details: {
    operationId: string | undefined;
    action: OperatorAction;
    outcome: OperatorOutcome;
  }): void;
}

export interface OperatorMetrics {
  countOperatorAction(action: OperatorAction, outcome: OperatorOutcome): void;
}

export interface DeadLetterOperatorDependencies {
  readonly journalStore: Pick<JournalStore, 'readOperation' | 'transitionOperation'>;
  readonly commandQueue: CommandQueueSender;
  readonly deadLetterQueue: DeadLetterQueue;
  readonly operatorLog: OperatorLog;
  readonly operatorMetrics: OperatorMetrics;
}

export interface DeadLetterOperator {
  inspect(): Promise<DeadLetterView[]>;
  inspectMessages(): Promise<{ message: DeadLetterMessage; view: DeadLetterView }[]>;
  resolve(message: DeadLetterMessage, action: OperatorAction): Promise<OperatorOutcome>;
}

// Holds each message for half a minute while it is shown, so a single listing
// does not return the same message twice; it reappears after.
const inspectionVisibilitySeconds = 30;
const receiveBatchSize = 10;

export function createSqsDeadLetterQueue(options: {
  sqsClient: SQSClient;
  queueUrl: string;
}): DeadLetterQueue {
  return {
    receiveMessages: async () => {
      const received = await options.sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: options.queueUrl,
          MaxNumberOfMessages: receiveBatchSize,
          VisibilityTimeout: inspectionVisibilitySeconds,
        }),
      );
      return (received.Messages ?? []).map((message) => ({
        messageId: message.MessageId ?? '',
        receiptHandle: message.ReceiptHandle ?? '',
        body: message.Body ?? '',
      }));
    },
    deleteMessage: async (receiptHandle) => {
      await options.sqsClient.send(
        new DeleteMessageCommand({ QueueUrl: options.queueUrl, ReceiptHandle: receiptHandle }),
      );
    },
  };
}

export function createDeadLetterOperator(
  dependencies: DeadLetterOperatorDependencies,
): DeadLetterOperator {
  const { journalStore } = dependencies;

  async function viewOf(message: DeadLetterMessage): Promise<DeadLetterView> {
    const parsedMessage = parseCommandMessage(message.body);
    const operation =
      parsedMessage.outcome === 'accepted'
        ? await journalStore.readOperation(parsedMessage.operationId)
        : undefined;
    return describeDeadLetter(message.messageId, parsedMessage, operation);
  }

  async function carryOut(
    message: DeadLetterMessage,
    view: DeadLetterView,
    action: OperatorAction,
  ): Promise<OperatorOutcome> {
    let redriveCount: number | undefined;
    for (const step of operatorStepsFor(action, view.kind)) {
      switch (step) {
        case 'move-to-queued':
        case 'move-to-failed': {
          if (view.kind !== 'operation') {
            throw new Error('operator-step-needs-an-operation');
          }
          const transition = await journalStore.transitionOperation({
            operationId: view.operationId,
            targetState: step === 'move-to-queued' ? 'QUEUED' : 'FAILED',
            origin: 'operator',
            ...(step === 'move-to-failed'
              ? { detail: { failure: { ...operatorDiscardFailure } } }
              : {}),
          });
          if (transition.outcome === 'stopped' || transition.outcome === 'stale') {
            return 'stopped';
          }
          // Transitioned now, or on an earlier run: either way the stored
          // count is the one this redrive uses (§8.2).
          redriveCount = transition.operation.redriveCount;
          break;
        }
        case 'send-redrive-message':
          if (view.kind !== 'operation' || redriveCount === undefined) {
            throw new Error('operator-step-out-of-order');
          }
          await dependencies.commandQueue.sendCommandMessage({
            body: formatCommandMessage(view.operationId),
            messageGroupId: messageGroupFor(view.tenantId, view.recordId),
            messageDeduplicationId: redriveDeduplicationId(view.operationId, redriveCount),
          });
          break;
        case 'delete-dead-letter':
          await dependencies.deadLetterQueue.deleteMessage(message.receiptHandle);
          break;
      }
    }
    return { redrive: 'redriven', discard: 'discarded', skip: 'skipped' }[
      action
    ] as OperatorOutcome;
  }

  return {
    inspect: async () => {
      const messages = await dependencies.deadLetterQueue.receiveMessages();
      return Promise.all(messages.map((message) => viewOf(message)));
    },
    inspectMessages: async () => {
      const messages = await dependencies.deadLetterQueue.receiveMessages();
      return Promise.all(
        messages.map(async (message) => ({ message, view: await viewOf(message) })),
      );
    },
    resolve: async (message, action) => {
      const view = await viewOf(message);
      if (!allowedOperatorActions(view).includes(action)) {
        throw new Error(`operator-action-not-allowed: ${action} for ${view.kind}`);
      }
      const outcome = await carryOut(message, view, action);
      const operationId = view.kind === 'unreadable' ? undefined : view.operationId;
      dependencies.operatorLog.recordOperatorAction({ operationId, action, outcome });
      dependencies.operatorMetrics.countOperatorAction(action, outcome);
      return outcome;
    },
  };
}
