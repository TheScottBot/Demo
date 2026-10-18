import {
  ChangeMessageVisibilityCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  OperationIdentifierSchema,
  contractVersions,
  isWithinByteBound,
  contractBounds,
} from '@demo/contracts';
import { z } from 'zod';

// Spec 03 §5.2: the commands queue's message. Its body holds messageVersion
// and operationId and nothing else, so no command field ever sits in SQS; the
// worker reads the rest from the journal. The worker (WE5) parses with this
// same schema, so encoder and parser share one definition (datum 0.7).
export const CommandMessageSchema = z.strictObject({
  messageVersion: z.literal(contractVersions.queueMessageVersion),
  operationId: OperationIdentifierSchema,
});

export function formatCommandMessage(operationId: string): string {
  return JSON.stringify(
    CommandMessageSchema.parse({
      messageVersion: contractVersions.queueMessageVersion,
      operationId,
    }),
  );
}

export type CommandMessageParse =
  | { readonly outcome: 'accepted'; readonly operationId: string }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'body-too-large' | 'not-json' | 'version-mismatch' | 'schema-invalid';
    };

// §6.3 step 1: the body is held to the Spec 00 §3.3 bound before it is
// parsed, and its version is checked before its shape, so a message from
// another version is named as that (Spec 00 §3.1).
export function parseCommandMessage(bodyText: string): CommandMessageParse {
  if (!isWithinByteBound(bodyText, contractBounds.queueMessageBodyMaximumBytes)) {
    return { outcome: 'rejected', reason: 'body-too-large' };
  }
  let messageValue: unknown;
  try {
    messageValue = JSON.parse(bodyText) as unknown;
  } catch {
    return { outcome: 'rejected', reason: 'not-json' };
  }
  if (
    typeof messageValue === 'object' &&
    messageValue !== null &&
    (messageValue as { messageVersion?: unknown }).messageVersion !==
      contractVersions.queueMessageVersion
  ) {
    return { outcome: 'rejected', reason: 'version-mismatch' };
  }
  const parsedMessage = CommandMessageSchema.safeParse(messageValue);
  return parsedMessage.success
    ? { outcome: 'accepted', operationId: parsedMessage.data.operationId }
    : { outcome: 'rejected', reason: 'schema-invalid' };
}

export interface CommandQueueMessage {
  readonly body: string;
  readonly messageGroupId: string;
  readonly messageDeduplicationId: string;
}

export interface CommandQueueSender {
  sendCommandMessage(message: CommandQueueMessage): Promise<void>;
}

export function createSqsCommandQueueSender(options: {
  sqsClient: SQSClient;
  queueUrl: string;
}): CommandQueueSender {
  return {
    sendCommandMessage: async (message) => {
      await options.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: options.queueUrl,
          MessageBody: message.body,
          MessageGroupId: message.messageGroupId,
          MessageDeduplicationId: message.messageDeduplicationId,
        }),
      );
    },
  };
}

// §6.3: a retryable outcome sets its message's visibility to the backoff.
export interface MessageVisibility {
  setVisibilityTimeout(receiptHandle: string, visibilitySeconds: number): Promise<void>;
}

export function createSqsMessageVisibility(options: {
  sqsClient: SQSClient;
  queueUrl: string;
}): MessageVisibility {
  return {
    setVisibilityTimeout: async (receiptHandle, visibilitySeconds) => {
      await options.sqsClient.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: options.queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: visibilitySeconds,
        }),
      );
    },
  };
}
