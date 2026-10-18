import { env as processEnvironment } from 'node:process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { DemoHttpHandler } from '@demo/contracts';
import { createConfiguredReadAdapters } from './adapters/read-adapters';
import { disabledReadCachePolicy } from './read-cache-policy';
import { parseReadPathConfiguration } from './read-path-configuration';
import {
  createPowertoolsReadPathObservability,
  traceReadAdapters,
} from './read-path-observability';
import { createReadHandler } from './read-handler';

// The bundled entry point of the read function. Configuration is read and
// checked once, at cold start; a bad environment fails here rather than per
// request (Spec 00 §2.3). Each provider's API key is read from Secrets Manager
// on first use and kept for the life of the execution environment.

const configuration = parseReadPathConfiguration(processEnvironment);
const observability = createPowertoolsReadPathObservability({ stage: configuration.stage });
const secretsManager = new SecretsManagerClient({});

async function readSecret(secretArn: string): Promise<string> {
  const secret = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (secret.SecretString === undefined || secret.SecretString === '') {
    throw new Error('provider-api-key-missing');
  }
  return secret.SecretString;
}

const readHandler = createReadHandler({
  readAdapters: traceReadAdapters(
    createConfiguredReadAdapters(processEnvironment, readSecret),
    observability.traceSubsegmentSource,
  ),
  problemLog: observability.problemLog,
  problemMetrics: observability.problemMetrics,
  readLog: observability.readLog,
  readMetrics: observability.readMetrics,
  readCachePolicy: disabledReadCachePolicy,
  timing: configuration.timing,
  now: () => new Date(),
  monotonicNow: () => performance.now(),
});

export const handler: DemoHttpHandler = (event, lambdaContext) => {
  observability.logger.addContext(lambdaContext);
  observability.tracer.annotateColdStart();
  observability.tracer.addServiceNameAnnotation();
  return readHandler(event, lambdaContext);
};
