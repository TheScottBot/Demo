import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  contractBounds,
  providerIdentifiers,
  providerWireStatuses,
  type ProviderIdentifier,
} from '@demo/contracts';
import {
  createInMemoryProviderStore,
  syntheticProviderApiKey,
  type InMemoryProviderStore,
} from '@demo/test-doubles/provider-simulation';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ulid } from 'ulid';
import { createMockProviderHandler, type MockProviderRequestLog } from './mock-provider-handler';

// CQ6: nothing is deployed, so the mock providers also run as local Node.js
// servers, one port per provider. Each server turns a request into the
// payload format 2.0 event its Lambda would receive and calls the same
// handler, so a local run exercises the deployed code path.

export const defaultLocalMockProviderPorts: Record<ProviderIdentifier, number> = {
  'provider-a': 4101,
  'provider-b': 4102,
  'provider-c': 4103,
};

export interface LocalMockProviderConnection {
  readonly providerId: ProviderIdentifier;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface LocalMockProviders {
  readonly connections: readonly LocalMockProviderConnection[];
  readonly store: InMemoryProviderStore;
  stop(): Promise<void>;
}

export interface LocalMockProviderOptions {
  ports?: Record<ProviderIdentifier, number>;
  store?: InMemoryProviderStore;
  now?: () => Date;
  log?: MockProviderRequestLog;
}

type RequestBody = { outcome: 'read'; bodyText: string | undefined } | { outcome: 'too-large' };

// The body is held to the command bound as it arrives (datum 0.10); once over,
// the rest is drained without being kept.
function readBoundedBody(request: IncomingMessage): Promise<RequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > contractBounds.commandRequestBodyMaximumBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (tooLarge) {
        resolve({ outcome: 'too-large' });
        return;
      }
      const bodyText = Buffer.concat(chunks).toString('utf8');
      resolve({ outcome: 'read', bodyText: bodyText === '' ? undefined : bodyText });
    });
    request.on('error', reject);
  });
}

function payloadFormatEvent(
  request: IncomingMessage,
  bodyText: string | undefined,
): APIGatewayProxyEventV2 {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method ?? 'GET';
  // Node.js lower cases header names already; payload format 2.0 joins a
  // repeated header with commas, so the same is done here (CU3).
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([headerName, headerValue]) => [
      headerName,
      Array.isArray(headerValue) ? headerValue.join(',') : headerValue,
    ]),
  );
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: requestUrl.pathname,
    rawQueryString: requestUrl.search.replace(/^\?/, ''),
    headers,
    isBase64Encoded: false,
    ...(bodyText === undefined ? {} : { body: bodyText }),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: '127.0.0.1',
      domainPrefix: 'local',
      http: {
        method,
        path: requestUrl.pathname,
        protocol: `HTTP/${request.httpVersion}`,
        sourceIp: request.socket.remoteAddress ?? '',
        userAgent: request.headers['user-agent'] ?? '',
      },
      requestId: ulid(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  };
}

const quietLog: MockProviderRequestLog = { recordRequest: () => undefined };

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export async function startLocalMockProviders(
  options: LocalMockProviderOptions = {},
): Promise<LocalMockProviders> {
  const store = options.store ?? createInMemoryProviderStore();
  const ports = options.ports ?? defaultLocalMockProviderPorts;
  const servers: Server[] = [];
  const connections: LocalMockProviderConnection[] = [];
  for (const providerId of providerIdentifiers) {
    const apiKey = syntheticProviderApiKey(providerId);
    const handler = createMockProviderHandler({
      providerId,
      readApiKey: () => Promise.resolve(apiKey),
      store,
      now: options.now ?? (() => new Date()),
      mintUlid: () => ulid(),
      sleep: async (milliseconds) => {
        await sleepFor(milliseconds);
      },
      log: options.log ?? quietLog,
    });
    const server = createServer((request, response) => {
      void (async () => {
        const requestBody = await readBoundedBody(request);
        if (requestBody.outcome === 'too-large') {
          response.writeHead(providerWireStatuses.requestInvalid).end();
          return;
        }
        const handlerResponse = await handler(payloadFormatEvent(request, requestBody.bodyText));
        response.writeHead(
          handlerResponse.statusCode ?? 500,
          handlerResponse.headers as Record<string, string>,
        );
        response.end(handlerResponse.body);
      })().catch(() => {
        // The failure is the server's own; nothing of the request is echoed.
        if (!response.headersSent) {
          response.writeHead(providerWireStatuses.serverError);
        }
        response.end();
      });
    });
    const boundPort = await listen(server, ports[providerId]);
    servers.push(server);
    connections.push({ providerId, baseUrl: `http://127.0.0.1:${String(boundPort)}`, apiKey });
  }
  return {
    connections,
    store,
    stop: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => {
                resolve();
              });
              server.closeAllConnections();
            }),
        ),
      );
    },
  };
}
