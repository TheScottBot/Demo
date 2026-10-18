import type { ProviderWriteAdapterSettings } from './write-adapters';

// Spec 03 §6.5: provider-c sets only its identity, its base URL variable
// and its secret; the shared HttpWriteAdapter does the rest.
export const providerCWriteAdapterSettings = {
  providerId: 'provider-c',
  baseUrlVariable: 'PROVIDER_C_BASE_URL',
  secretArnVariable: 'PROVIDER_C_SECRET_ARN',
} as const satisfies ProviderWriteAdapterSettings;
