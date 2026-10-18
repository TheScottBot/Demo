import { env as processEnvironment } from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Context, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { createConfiguredWriteAdapters } from '../adapters/write-adapters';
import { createSqsMessageVisibility } from '../command-queue';
import { createJournalStore } from '../journal-store';
import { parseWriteFunctionConfiguration } from '../write-function-configuration';
import { createPowertoolsWriteObservability } from '../write-path-observability';
import { createWorkerHandler } from './worker-handler';

// The bundled entry point of the worker function. Configuration is read and
// checked once, at cold start (Spec 00 §2.3). Each provider's API key is read
// from Secrets Manager on first use and kept for the life of the execution
// environment.

const configuration = parseWriteFunctionConfiguration(processEnvironment);
const observability = createPowertoolsWriteObservability({
  stage: configuration.stage,
  component: 'write-worker',
});
const secretsManager = new SecretsManagerClient({});
const sqsClient = new SQSClient({});

async function readSecret(secretArn: string): Promise<string> {
  const secret = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (secret.SecretString === undefined || secret.SecretString === '') {
    throw new Error('provider-api-key-missing');
  }
  return secret.SecretString;
}

const workerHandler = createWorkerHandler({
  journalStore: createJournalStore({
    documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    tableName: configuration.journalTableName,
    log: observability.journalLog,
    metrics: observability.journalMetrics,
    now: () => new Date(),
  }),
  writeAdapters: createConfiguredWriteAdapters(
    processEnvironment,
    readSecret,
    observability.adapterMetrics,
  ),
  messageVisibility: createSqsMessageVisibility({
    sqsClient,
    queueUrl: configuration.commandQueueUrl,
  }),
  workerLog: observability.workerLog,
  workerMetrics: observability.workerMetrics,
  now: () => new Date(),
  monotonicNow: () => performance.now(),
  randomFraction: () => Math.random(),
});

export const handler = (event: SQSEvent, lambdaContext: Context): Promise<SQSBatchResponse> => {
  observability.logger.addContext(lambdaContext);
  return workerHandler(event);
};
