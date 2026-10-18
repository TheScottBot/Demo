import { env as processEnvironment } from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Context, DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import { createSqsCommandQueueSender } from '../command-queue';
import { createJournalStore } from '../journal-store';
import { parseWriteFunctionConfiguration } from '../write-function-configuration';
import { createPowertoolsWriteObservability } from '../write-path-observability';
import { createRelayHandler } from './relay-handler';

// The bundled entry point of the relay function. Configuration is read and
// checked once, at cold start; a bad environment fails here rather than per
// batch (Spec 00 §2.3).

const configuration = parseWriteFunctionConfiguration(processEnvironment);
const observability = createPowertoolsWriteObservability({
  stage: configuration.stage,
  component: 'write-relay',
});

const relayHandler = createRelayHandler({
  commandQueue: createSqsCommandQueueSender({
    sqsClient: new SQSClient({}),
    queueUrl: configuration.commandQueueUrl,
  }),
  journalStore: createJournalStore({
    documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    tableName: configuration.journalTableName,
    log: observability.journalLog,
    metrics: observability.journalMetrics,
    now: () => new Date(),
  }),
  relayLog: observability.relayLog,
  relayMetrics: observability.relayMetrics,
});

export const handler = (
  event: DynamoDBStreamEvent,
  lambdaContext: Context,
): Promise<DynamoDBBatchResponse> => {
  observability.logger.addContext(lambdaContext);
  return relayHandler(event);
};
