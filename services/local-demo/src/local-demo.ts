import type { ProviderIdentifier } from '@demo/contracts';
import { defaultLocalMockProviderPorts, startLocalMockProviders } from '@demo/mock-providers';
import type { LocalServer } from './local-function-server';
import { startLocalGateway, type LocalGatewayLogLine } from './local-gateway';
import { startLocalReadService, type LocalProviderAddress } from './local-read-service';
import { startLocalWriteService } from './local-write-service';

// The local demonstration's pieces and their ports. `npm run demo:local`
// starts each in its own process (bin/start-local-demo.ts); the end to end
// test starts them in one process on ports the system picks. Either way they
// talk only over HTTP.

export interface LocalDemoPorts {
  readonly gateway: number;
  readonly readService: number;
  readonly writeService: number;
  readonly providers: Readonly<Record<ProviderIdentifier, number>>;
}

export const defaultLocalDemoPorts: LocalDemoPorts = {
  gateway: 8080,
  readService: 8081,
  writeService: 8082,
  providers: defaultLocalMockProviderPorts,
};

export const defaultPumpIntervalMilliseconds = 250;

export function localProviderAddresses(
  providerPorts: Readonly<Record<ProviderIdentifier, number>>,
): LocalProviderAddress[] {
  return (Object.keys(providerPorts) as ProviderIdentifier[]).map((providerId) => ({
    providerId,
    baseUrl: `http://127.0.0.1:${String(providerPorts[providerId])}`,
  }));
}

export function localGatewayUpstreams(readServiceUrl: string, writeServiceUrl: string) {
  return {
    'spec-02-read-handler': `${readServiceUrl}/invoke/read`,
    'spec-03-command-handler': `${writeServiceUrl}/invoke/intake`,
    'spec-03-status-handler': `${writeServiceUrl}/invoke/status`,
  } as const;
}

export interface LocalDemo {
  readonly gatewayUrl: string;
  stop(): Promise<void>;
}

export async function startLocalDemo(options: {
  ports: LocalDemoPorts;
  pumpIntervalMilliseconds: number;
  log?: (logLine: LocalGatewayLogLine) => void;
}): Promise<LocalDemo> {
  const providers = await startLocalMockProviders({ ports: { ...options.ports.providers } });
  const providerAddresses = providers.connections.map(({ providerId, baseUrl }) => ({
    providerId,
    baseUrl,
  }));
  const started: LocalServer[] = [];
  try {
    const readService = await startLocalReadService({
      port: options.ports.readService,
      providers: providerAddresses,
    });
    started.push(readService);
    const writeService = await startLocalWriteService({
      port: options.ports.writeService,
      providers: providerAddresses,
      pumpIntervalMilliseconds: options.pumpIntervalMilliseconds,
    });
    started.push(writeService);
    const gateway = await startLocalGateway({
      port: options.ports.gateway,
      upstreams: localGatewayUpstreams(readService.baseUrl, writeService.baseUrl),
      ...(options.log === undefined ? {} : { log: options.log }),
    });
    started.push(gateway);
    return {
      gatewayUrl: gateway.baseUrl,
      stop: async () => {
        for (const server of started.reverse()) {
          await server.stop();
        }
        await providers.stop();
      },
    };
  } catch (startFailure) {
    for (const server of started.reverse()) {
      await server.stop();
    }
    await providers.stop();
    throw startFailure;
  }
}
