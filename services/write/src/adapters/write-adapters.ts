import type { ProviderConnection } from '@demo/construct-contracts';
import { parseProviderEndpoint } from '@demo/construct-contracts/runtime';
import type { ProviderIdentifier, WriteAdapter } from '@demo/contracts';
import { createHttpWriteAdapter, type WriteAdapterMetrics } from './http-write-adapter';
import { providerAWriteAdapterSettings } from './provider-a-write-adapter';
import { providerBWriteAdapterSettings } from './provider-b-write-adapter';
import { providerCWriteAdapterSettings } from './provider-c-write-adapter';

// All three write adapters, in routing table order, built from the
// environment at cold start (Spec 00 §2.3). Secrets are read on first use,
// once each.

export interface ProviderWriteAdapterSettings {
  readonly providerId: ProviderIdentifier;
  readonly baseUrlVariable: string;
  readonly secretArnVariable: string;
}

const providerWriteAdapterSettings: readonly ProviderWriteAdapterSettings[] = [
  providerAWriteAdapterSettings,
  providerBWriteAdapterSettings,
  providerCWriteAdapterSettings,
];

export function createConfiguredWriteAdapters(
  environment: Readonly<Record<string, string | undefined>>,
  readSecret: (secretArn: string) => Promise<string>,
  metrics: WriteAdapterMetrics,
): WriteAdapter[] {
  return providerWriteAdapterSettings.map((settings) => {
    const endpoint = parseProviderEndpoint({
      baseUrl: environment[settings.baseUrlVariable],
      secretArn: environment[settings.secretArnVariable],
    });
    return createHttpWriteAdapter({
      providerId: settings.providerId,
      baseUrl: endpoint.baseUrl,
      readApiKey: () => readSecret(endpoint.secretArn),
      metrics,
    });
  });
}

// The worker's provider variables, set by the construct from the connections
// and read back by createConfiguredWriteAdapters, so the two cannot drift.
// The secret's ARN, never its value (Spec 00 §2.3).
export function writeAdapterEnvironment(
  providers: readonly ProviderConnection[],
): Record<string, string> {
  if (providers.length !== providerWriteAdapterSettings.length) {
    throw new Error('write-path-needs-each-provider-once');
  }
  return Object.fromEntries(
    providerWriteAdapterSettings.flatMap((settings) => {
      const connection = providers.find(
        (candidate) => candidate.providerId === settings.providerId,
      );
      if (connection === undefined) {
        throw new Error('write-path-needs-each-provider-once');
      }
      return [
        [settings.baseUrlVariable, connection.baseUrl],
        [settings.secretArnVariable, connection.secretArn],
      ];
    }),
  );
}
