// CQ6: the mock providers also run as local Node.js servers, wrapping the very
// handler the Lambdas run, so the streams have real HTTP providers locally.
import {
  ProviderReadResponseBodySchema,
  isProviderContractVersionSupported,
  type ProviderIdentifier,
} from '@demo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalMockProviders, type LocalMockProviders } from '../src/index';

let localProviders: LocalMockProviders;

beforeAll(async () => {
  // Port 0: the operating system picks a free port, so tests never collide.
  localProviders = await startLocalMockProviders({
    ports: { 'provider-a': 0, 'provider-b': 0, 'provider-c': 0 },
  });
});

afterAll(async () => {
  await localProviders.stop();
});

function connectionFor(providerId: ProviderIdentifier) {
  const connection = localProviders.connections.find(
    (candidateConnection) => candidateConnection.providerId === providerId,
  );
  if (connection === undefined) {
    throw new Error(`no local server for ${providerId}`);
  }
  return connection;
}

describe('the local mock provider servers', () => {
  it('serve one provider each, on a loopback address', () => {
    expect(localProviders.connections.map((connection) => connection.providerId)).toEqual([
      'provider-a',
      'provider-b',
      'provider-c',
    ]);
    for (const connection of localProviders.connections) {
      expect(connection.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    }
  });

  it('answer a read over real HTTP with the §4.4 body and headers', async () => {
    const connection = connectionFor('provider-a');
    const response = await fetch(`${connection.baseUrl}/records/record-0001`, {
      headers: { 'X-Api-Key': connection.apiKey, 'Demo-Tenant-Id': 'tenant-1' },
    });
    expect(response.status).toBe(200);
    expect(ProviderReadResponseBodySchema.safeParse(await response.json()).success).toBe(true);
    expect(
      isProviderContractVersionSupported(
        response.headers.get('Demo-Provider-Contract') ?? undefined,
      ),
    ).toBe(true);
  });

  it('apply faults, here down-c- on provider-c', async () => {
    const connection = connectionFor('provider-c');
    const response = await fetch(`${connection.baseUrl}/records/down-c-0001`, {
      headers: { 'X-Api-Key': connection.apiKey, 'Demo-Tenant-Id': 'tenant-1' },
    });
    expect(response.status).toBe(503);
  });

  it('apply a write and serve it back', async () => {
    const connection = connectionFor('provider-b');
    const headers = { 'X-Api-Key': connection.apiKey, 'Demo-Tenant-Id': 'tenant-2' };
    const read = await fetch(`${connection.baseUrl}/records/record-0004`, { headers });
    const write = await fetch(`${connection.baseUrl}/records/record-0004/sections/notes/entries`, {
      method: 'POST',
      headers: {
        ...headers,
        'If-Match': read.headers.get('ETag') ?? '',
        'Idempotency-Key': '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
      },
      body: JSON.stringify({ text: 'Synthetic local note' }),
    });
    expect(write.status).toBe(201);
    const reread = await fetch(`${connection.baseUrl}/records/record-0004`, { headers });
    expect(reread.headers.get('ETag')).toBe(write.headers.get('ETag'));
  });

  it('refuse a request body over the command bound without buffering it', async () => {
    const connection = connectionFor('provider-a');
    const response = await fetch(`${connection.baseUrl}/records/record-0001/sections/summary`, {
      method: 'PUT',
      headers: { 'X-Api-Key': connection.apiKey, 'Demo-Tenant-Id': 'tenant-1' },
      body: 'x'.repeat(65_537),
    });
    expect(response.status).toBe(400);
  });
});
