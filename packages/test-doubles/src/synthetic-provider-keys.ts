import type { ProviderIdentifier } from '@demo/contracts';

// The synthetic API key each provider double accepts. It opens nothing outside
// the doubles; the msw doubles (CE2) and the local mock servers (CE4) share it.
export function syntheticProviderApiKey(providerId: ProviderIdentifier): string {
  return `synthetic-api-key-${providerId}`;
}
