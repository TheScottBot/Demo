import { env as processEnvironment } from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { createSqsCommandQueueSender } from '../command-queue';
import { createJournalStore } from '../journal-store';
import { parseWriteFunctionConfiguration } from '../write-function-configuration';
import { createPowertoolsWriteObservability } from '../write-path-observability';
import { createSweepHandler } from './sweep-handler';

// The bundled entry point of the sweep function, run on its schedule (WU9).
// The scheduled event carries nothing the sweep reads, so it is not parsed.

const configuration = parseWriteFunctionConfiguration(processEnvironment);
const observability = createPowertoolsWriteObservability({
  stage: configuration.stage,
  component: 'write-sweep',
});

const sweepHandler = createSweepHandler({
  journalStore: createJournalStore({
    documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    tableName: configuration.journalTableName,
    log: observability.journalLog,
    metrics: observability.journalMetrics,
    now: () => new Date(),
  }),
  commandQueue: createSqsCommandQueueSender({
    sqsClient: new SQSClient({}),
    queueUrl: configuration.commandQueueUrl,
  }),
  sweepLog: observability.sweepLog,
  sweepMetrics: observability.sweepMetrics,
  relayEnabled: configuration.relayEnabled,
  now: () => new Date(),
  monotonicNow: () => performance.now(),
});

export const handler = (_scheduledEvent: unknown, lambdaContext: Context): Promise<void> => {
  observability.logger.addContext(lambdaContext);
  return sweepHandler();
};
