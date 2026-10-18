// Spec 01 EE5 under EQ2 (IMPLEMENTATION_DEVIATIONS.md entry 14): the author's
// smoke check, run by hand with `npm run smoke:local`. One read, one command
// and one status poll pass through the real read, intake and status handlers,
// in this one process, against the mock providers running as local servers
// over HTTP. It passes through no gateway: the events are built as the
// gateway would pass them, with synthetic claims. It is a manual check, not a
// suite (Spec 00 §5.4); the author records its result in TESTING.md.
import { env as processEnvironment, exit, stdout } from 'node:process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { providerSecretName, type ProviderConnection } from '@demo/construct-contracts';
import {
  OperationStatusSchema,
  ReadResponseSchema,
  httpHeaders,
  scopeNames,
  type DemoHttpHandler,
} from '@demo/contracts';
import { startLocalMockProviders } from '@demo/mock-providers';
import { readFunctionEnvironment } from '@demo/read';
import { buildLambdaContext, buildVerifiedClaimsEvent, publicRouteNamed } from '@demo/test-doubles';
import { createLocalWritePath } from '@demo/write/test-support/local-write-path';
import { mockClient } from 'aws-sdk-client-mock';

const recordId = 'record-0001';
const tenantId = 'tenant-1';

function report(step: string, outcome: string): void {
  stdout.write(`${step}: ${outcome}\n`);
}

function secretArnFor(providerId: string): string {
  return `arn:aws:secretsmanager:eu-west-2:000000000000:secret:${providerSecretName('dev', providerId as never)}-AbCdEf`;
}

const localProviders = await startLocalMockProviders({
  ports: { 'provider-a': 0, 'provider-b': 0, 'provider-c': 0 },
});
// The one stand in: Secrets Manager hands back each provider's synthetic key.
const secretsManager = mockClient(SecretsManagerClient);
let failed = false;

try {
  const providerConnections: ProviderConnection[] = localProviders.connections.map(
    (connection) => ({
      providerId: connection.providerId,
      baseUrl: connection.baseUrl,
      secretArn: secretArnFor(connection.providerId),
    }),
  );
  for (const connection of localProviders.connections) {
    secretsManager
      .on(GetSecretValueCommand, { SecretId: secretArnFor(connection.providerId) })
      .resolves({ SecretString: connection.apiKey });
  }
  processEnvironment['AWS_REGION'] = 'eu-west-2';
  Object.assign(processEnvironment, readFunctionEnvironment('dev', providerConnections));
  // Loaded only now: the entry point reads its environment when loaded.
  const { handler: readHandler } = (await import('@demo/read/read-handler-entry')) as {
    handler: DemoHttpHandler;
  };

  // 1. One read.
  const readResponse = await readHandler(
    buildVerifiedClaimsEvent({
      route: publicRouteNamed('read-record'),
      pathParameters: { recordId },
      headers: [[httpHeaders.correlationIdentifier.wireName, '01JB0000000000000000000005']],
      claims: { subject: 'synthetic-subject-smoke', tenantId, scope: scopeNames.recordsRead },
    }),
    buildLambdaContext(),
  );
  const readBody = ReadResponseSchema.parse(JSON.parse(readResponse.body ?? 'null'));
  const summaryVersion = readBody.sources.find(
    (source) => source.providerId === 'provider-a',
  )?.version;
  report(
    'read',
    `${String(readResponse.statusCode)}, partial ${String(readBody.partial)}, sources ${readBody.sources
      .map((source) => `${source.providerId} ${source.status}`)
      .join(', ')}`,
  );
  if (readResponse.statusCode !== 200 || summaryVersion === undefined) {
    throw new Error('smoke-read-failed');
  }

  // 2. One command, against the version the read returned.
  const writePath = createLocalWritePath({
    relayEnabled: true,
    providerConnections: localProviders.connections,
  });
  try {
    const commandResponse = await writePath.submit(
      {
        type: 'record.section.replace',
        recordId,
        section: 'summary',
        baseVersion: summaryVersion,
        payload: { title: 'Synthetic smoke summary', status: 'paused' },
      },
      { tenantId },
    );
    const accepted = OperationStatusSchema.parse(JSON.parse(commandResponse.body ?? 'null'));
    report('command', `${String(commandResponse.statusCode)}, operation ${accepted.state}`);
    if (commandResponse.statusCode !== 202) {
      throw new Error('smoke-command-failed');
    }

    // 3. One status poll, once the relay and worker have run.
    await writePath.settle();
    const statusResponse = await writePath.status(accepted.operationId, tenantId);
    const finalStatus = OperationStatusSchema.parse(JSON.parse(statusResponse.body ?? 'null'));
    report('status', `${String(statusResponse.statusCode)}, operation ${finalStatus.state}`);
    if (statusResponse.statusCode !== 200 || finalStatus.state !== 'SUCCEEDED') {
      throw new Error('smoke-status-failed');
    }
  } finally {
    writePath.stop();
  }
  report('smoke', 'passed');
} catch (smokeFailure) {
  failed = true;
  report('smoke', `failed: ${smokeFailure instanceof Error ? smokeFailure.message : 'unknown'}`);
} finally {
  secretsManager.restore();
  await localProviders.stop();
}
exit(failed ? 1 : 0);
