import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { env as processEnvironment } from 'node:process';
import { ProviderIdentifierSchema } from '@demo/contracts';
import { ulid } from 'ulid';
import { z } from 'zod';
import { createDynamoDbProviderStore } from './dynamodb-provider-store';
import { createMockProviderHandler } from './mock-provider-handler';

// The bundled entry point of each mock provider Lambda. Configuration comes
// only from the environment, checked at cold start (Spec 00 §2.3); the API key
// is not in it, but read from Secrets Manager once per execution environment.

const MockProviderEnvironmentSchema = z.strictObject({
  DEMO_STAGE: z.enum(['dev', 'stub', 'test', 'demo']),
  DEMO_PROVIDER_ID: ProviderIdentifierSchema,
  DEMO_STORE_TABLE_NAME: z.string().min(1),
  DEMO_API_KEY_SECRET_ARN: z.string().startsWith('arn:'),
});

const configuration = MockProviderEnvironmentSchema.parse({
  DEMO_STAGE: processEnvironment['DEMO_STAGE'],
  DEMO_PROVIDER_ID: processEnvironment['DEMO_PROVIDER_ID'],
  DEMO_STORE_TABLE_NAME: processEnvironment['DEMO_STORE_TABLE_NAME'],
  DEMO_API_KEY_SECRET_ARN: processEnvironment['DEMO_API_KEY_SECRET_ARN'],
});

const logger = new Logger({
  serviceName: 'mock-provider',
  persistentKeys: { component: configuration.DEMO_PROVIDER_ID, stage: configuration.DEMO_STAGE },
});

const secretsManager = new SecretsManagerClient({});

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // An idempotency entry with no completed response yet has that field
  // undefined, which DynamoDB cannot store.
  marshallOptions: { removeUndefinedValues: true },
});

export const handler = createMockProviderHandler({
  providerId: configuration.DEMO_PROVIDER_ID,
  readApiKey: async () => {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: configuration.DEMO_API_KEY_SECRET_ARN }),
    );
    if (secret.SecretString === undefined || secret.SecretString === '') {
      throw new Error('mock-provider-api-key-missing');
    }
    return secret.SecretString;
  },
  store: createDynamoDbProviderStore({
    documentClient,
    tableName: configuration.DEMO_STORE_TABLE_NAME,
  }),
  now: () => new Date(),
  mintUlid: () => ulid(),
  sleep: async (milliseconds) => {
    await sleepFor(milliseconds);
  },
  log: {
    recordRequest: (requestLine) => {
      logger.info('provider-request', requestLine);
    },
  },
});
