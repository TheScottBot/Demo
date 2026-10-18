import type { ProviderWriteAdapterSettings } from './write-adapters';

// Spec 03 §6.5: provider-a sets only its identity, its base URL variable
// and its secret; the shared HttpWriteAdapter does the rest.
export const providerAWriteAdapterSettings = {
  providerId: 'provider-a',
  baseUrlVariable: 'PROVIDER_A_BASE_URL',
  secretArnVariable: 'PROVIDER_A_SECRET_ARN',
} as const satisfies ProviderWriteAdapterSettings;
