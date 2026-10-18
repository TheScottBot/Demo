import type { ProviderReadAdapterSettings } from './http-read-adapter';

// Spec 02 §3.2: provider-c sets only its identity, its base URL variable
// and its secret; the shared HttpReadAdapter does the rest.
export const providerCReadAdapterSettings = {
  providerId: 'provider-c',
  baseUrlVariable: 'PROVIDER_C_BASE_URL',
  secretArnVariable: 'PROVIDER_C_SECRET_ARN',
} as const satisfies ProviderReadAdapterSettings;
