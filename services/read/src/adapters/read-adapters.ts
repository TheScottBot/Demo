import type { ReadAdapter } from '@demo/contracts';
import { createConfiguredReadAdapter } from './http-read-adapter';
import { providerAReadAdapterSettings } from './provider-a-read-adapter';
import { providerBReadAdapterSettings } from './provider-b-read-adapter';
import { providerCReadAdapterSettings } from './provider-c-read-adapter';

// All three adapters, in routing table order, built from the environment at
// cold start (Spec 00 §2.3). Secrets are read on first use, once each.
const providerReadAdapterSettings = [
  providerAReadAdapterSettings,
  providerBReadAdapterSettings,
  providerCReadAdapterSettings,
];

export function createConfiguredReadAdapters(
  environment: Readonly<Record<string, string | undefined>>,
  readSecret: (secretArn: string) => Promise<string>,
): ReadAdapter[] {
  return providerReadAdapterSettings.map((settings) =>
    createConfiguredReadAdapter(settings, environment, readSecret),
  );
}
