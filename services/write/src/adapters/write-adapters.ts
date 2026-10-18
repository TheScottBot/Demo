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
