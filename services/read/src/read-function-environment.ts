import type { DemoStage, ProviderConnection } from '@demo/construct-contracts';
import { providerIdentifiers } from '@demo/contracts';
import { providerAReadAdapterSettings } from './adapters/provider-a-read-adapter';
import { providerBReadAdapterSettings } from './adapters/provider-b-read-adapter';
import { providerCReadAdapterSettings } from './adapters/provider-c-read-adapter';
import { readPathSettings } from './read-path-settings';

// Spec 02 §7: the read function's environment, built in one place. The
// ReadPath construct sets it on the function, and RE6 sets it before loading
// the entry point locally, so the local suite runs the configuration the
// construct deploys. It imports no CDK, only types.

const providerSettings = [
  providerAReadAdapterSettings,
  providerBReadAdapterSettings,
  providerCReadAdapterSettings,
];

// Each routing table provider exactly once: a missing or repeated connection
// would leave a provider unread, or read from two places.
function connectionsByProvider(
  providers: readonly ProviderConnection[],
): Map<string, ProviderConnection> {
  const connections = new Map(
    providers.map((connection) => [connection.providerId, connection] as const),
  );
  if (
    providers.length !== providerIdentifiers.length ||
    providerIdentifiers.some((providerId) => !connections.has(providerId))
  ) {
    throw new Error('read-path-needs-each-provider-once');
  }
  return connections;
}

export function readFunctionEnvironment(
  stage: DemoStage,
  providers: readonly ProviderConnection[],
): Record<string, string> {
  const connections = connectionsByProvider(providers);
  return {
    DEMO_STAGE: stage,
    PROVIDER_TIMEOUT_MILLISECONDS: String(readPathSettings.providerTimeoutMilliseconds),
    FAN_OUT_BUDGET_MILLISECONDS: String(readPathSettings.fanOutBudgetMilliseconds),
    ...Object.fromEntries(
      providerSettings.flatMap((settings) => {
        const connection = connections.get(settings.providerId) as ProviderConnection;
        return [
          [settings.baseUrlVariable, connection.baseUrl],
          // The secret's ARN, never its value (Spec 00 §2.3).
          [settings.secretArnVariable, connection.secretArn],
        ];
      }),
    ),
  };
}

// The secrets the function may read, in routing table order (§7).
export function readFunctionSecretArns(providers: readonly ProviderConnection[]): string[] {
  const connections = connectionsByProvider(providers);
  return providerSettings.map(
    (settings) => (connections.get(settings.providerId) as ProviderConnection).secretArn,
  );
}
