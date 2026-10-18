import type { ProviderReadAdapterSettings } from './http-read-adapter';

// Spec 02 §3.2: provider-b sets only its identity, its base URL variable
// and its secret; the shared HttpReadAdapter does the rest.
export const providerBReadAdapterSettings = {
  providerId: 'provider-b',
  baseUrlVariable: 'PROVIDER_B_BASE_URL',
  secretArnVariable: 'PROVIDER_B_SECRET_ARN',
} as const satisfies ProviderReadAdapterSettings;
