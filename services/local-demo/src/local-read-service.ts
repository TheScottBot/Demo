import { env as processEnvironment } from 'node:process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { providerSecretName, type ProviderConnection } from '@demo/construct-contracts';
import type { DemoHttpHandler, ProviderIdentifier } from '@demo/contracts';
import { readFunctionEnvironment } from '@demo/read';
import { syntheticProviderApiKey } from '@demo/test-doubles';
import { mockClient } from 'aws-sdk-client-mock';
import { startLocalFunctionServer, type LocalServer } from './local-function-server';

// The read path's local server: the real read function's bundled entry point,
// configured exactly as the ReadPath construct configures it (as RE6 runs it),
// behind a function server of its own. Secrets Manager is the one stand in:
// it hands back each provider's synthetic API key, never logged.

export interface LocalProviderAddress {
  readonly providerId: ProviderIdentifier;
  readonly baseUrl: string;
}

function secretArnFor(providerId: ProviderIdentifier): string {
  return `arn:aws:secretsmanager:eu-west-2:000000000000:secret:${providerSecretName('dev', providerId)}-AbCdEf`;
}

export async function startLocalReadService(options: {
  port: number;
  providers: readonly LocalProviderAddress[];
}): Promise<LocalServer> {
  const secretsManager = mockClient(SecretsManagerClient);
  const providerConnections: ProviderConnection[] = options.providers.map((provider) => {
    secretsManager
      .on(GetSecretValueCommand, { SecretId: secretArnFor(provider.providerId) })
      .resolves({ SecretString: syntheticProviderApiKey(provider.providerId) });
    return {
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      secretArn: secretArnFor(provider.providerId),
    };
  });
  processEnvironment['AWS_REGION'] = 'eu-west-2';
  Object.assign(processEnvironment, readFunctionEnvironment('dev', providerConnections));
  // Loaded only now: the entry point reads its environment when loaded.
  const { handler: readHandler } = (await import('@demo/read/read-handler-entry')) as {
    handler: DemoHttpHandler;
  };
  const functionServer = await startLocalFunctionServer({
    port: options.port,
    functions: { read: readHandler },
  });
  return {
    baseUrl: functionServer.baseUrl,
    stop: async () => {
      await functionServer.stop();
      secretsManager.restore();
    },
  };
}
