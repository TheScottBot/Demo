import type { ProviderReadAdapterSettings } from './http-read-adapter';

// Spec 02 §3.2: provider-a sets only its identity, its base URL variable
// and its secret; the shared HttpReadAdapter does the rest.
export const providerAReadAdapterSettings = {
  providerId: 'provider-a',
  baseUrlVariable: 'PROVIDER_A_BASE_URL',
  secretArnVariable: 'PROVIDER_A_SECRET_ARN',
} as const satisfies ProviderReadAdapterSettings;
