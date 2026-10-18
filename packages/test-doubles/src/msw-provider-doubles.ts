import { providerIdentifiers, type ProviderIdentifier } from '@demo/contracts';
import { HttpResponse, delay, http, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';
import { ulid } from 'ulid';
import { simulateProviderRequest } from './provider-simulation';
import { syntheticProviderApiKey } from './synthetic-provider-keys';
import {
  createInMemoryProviderStore,
  type InMemoryProviderStore,
} from './provider-simulation-store';

// Spec 00 §4.3: msw doubles for every provider, so Specs 02 and 03 can test
// their adapters against the real global fetch before any mock server runs.
// Every answer comes from simulateProviderRequest; this file is transport only.

export interface ProviderDoubleConnection {
  readonly providerId: ProviderIdentifier;
  readonly baseUrl: string;
  // Synthetic: these keys open nothing outside the doubles.
  readonly apiKey: string;
}

export const syntheticProviderConnections: readonly ProviderDoubleConnection[] =
  providerIdentifiers.map((providerId) => ({
    providerId,
    baseUrl: `https://${providerId}.providers.example.test`,
    apiKey: syntheticProviderApiKey(providerId),
  }));

export interface ProviderDoubleOptions {
  connections?: readonly ProviderDoubleConnection[];
  store?: InMemoryProviderStore;
  now?: () => Date;
  mintUlid?: () => string;
}

export function createProviderDoubleHandlers(
  options: ProviderDoubleOptions & { store: InMemoryProviderStore },
): HttpHandler[] {
  const connections = options.connections ?? syntheticProviderConnections;
  const now = options.now ?? (() => new Date());
  const mintUlid = options.mintUlid ?? (() => ulid());
  return connections.map((connection) =>
    http.all(`${connection.baseUrl}/*`, async ({ request }) => {
      const requestUrl = new URL(request.url);
      const bodyText = await request.text();
      const simulatedResponse = await simulateProviderRequest(
        {
          method: request.method,
          path: requestUrl.pathname,
          // Headers iterate with lower cased names, as the simulation expects.
          headers: Object.fromEntries(request.headers.entries()),
          bodyText: bodyText === '' ? undefined : bodyText,
        },
        {
          providerId: connection.providerId,
          apiKey: connection.apiKey,
          store: options.store,
          now,
          mintUlid,
        },
      );
      if (simulatedResponse.delayMilliseconds > 0) {
        await delay(simulatedResponse.delayMilliseconds);
      }
      return new HttpResponse(simulatedResponse.bodyText ?? null, {
        status: simulatedResponse.status,
        headers: simulatedResponse.headers,
      });
    }),
  );
}

export interface ProviderDoubles {
  readonly server: ReturnType<typeof setupServer>;
  readonly store: InMemoryProviderStore;
  readonly connections: readonly ProviderDoubleConnection[];
  // Back to the seed, between tests.
  reset(): void;
  stop(): void;
}

export function startProviderDoubles(options: ProviderDoubleOptions = {}): ProviderDoubles {
  const store = options.store ?? createInMemoryProviderStore();
  const connections = options.connections ?? syntheticProviderConnections;
  const server = setupServer(...createProviderDoubleHandlers({ ...options, store, connections }));
  // msw 3 renamed this option (CU6). The old name, onUnhandledRequest, is
  // silently ignored and lets an unmatched request reach the real network.
  server.listen({ onUnhandledFrame: 'error' });
  return {
    server,
    store,
    connections,
    reset: () => {
      store.reset();
    },
    stop: () => {
      server.close();
    },
  };
}
