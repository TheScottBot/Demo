import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { OperationIdentifierSchema, contractVersions } from '@demo/contracts';
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
