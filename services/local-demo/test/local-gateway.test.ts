// The local stand-in for the gateway (Spec 01 §2 and §4.1, as far as a local
// process can play them): the three contract routes, a fixed table of demo
// tokens in place of JWT verification, the gateway's own 401 and 404, and an
// access log line holding no token or subject.
import type { DemoHttpHandler } from '@demo/contracts';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startLocalFunctionServer, type LocalServer } from '../src/local-function-server';
import { localDemoTokens, startLocalGateway, type LocalGatewayLogLine } from '../src/local-gateway';

const received: { functionName: string; event: APIGatewayProxyEventV2WithJWTAuthorizer }[] = [];
const logLines: LocalGatewayLogLine[] = [];

function recordingHandler(functionName: string): DemoHttpHandler {
  return (event) => {
    received.push({ functionName, event });
    return Promise.resolve({
      statusCode: functionName === 'intake' ? 202 : 200,
      headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': 'synthetic' },
      body: JSON.stringify({ functionName }),
    });
  };
}

let functionServer: LocalServer;
let gateway: LocalServer;

beforeAll(async () => {
  functionServer = await startLocalFunctionServer({
    port: 0,
    functions: {
      read: recordingHandler('read'),
      intake: recordingHandler('intake'),
      status: recordingHandler('status'),
    },
  });
  gateway = await startLocalGateway({
    port: 0,
    upstreams: {
      'spec-02-read-handler': `${functionServer.baseUrl}/invoke/read`,
      'spec-03-command-handler': `${functionServer.baseUrl}/invoke/intake`,
      'spec-03-status-handler': `${functionServer.baseUrl}/invoke/status`,
    },
    log: (logLine) => logLines.push(logLine),
  });
});

afterAll(async () => {
  await gateway.stop();
  await functionServer.stop();
});

beforeEach(() => {
  received.length = 0;
  logLines.length = 0;
});

const writerToken = 'local-tenant-1-writer';

function call(path: string, init: RequestInit = {}, token: string | null = writerToken) {
  return fetch(`${gateway.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe('the demo tokens', () => {
  it('are a reader and a writer for tenant-1, and a writer for tenant-2, scoped as Cognito issues them', () => {
    expect(localDemoTokens).toEqual({
      'local-tenant-1-reader': {
        subject: 'synthetic-subject-local-1',
        tenantId: 'tenant-1',
        scope: 'demo/records:read',
      },
      'local-tenant-1-writer': {
        subject: 'synthetic-subject-local-1',
        tenantId: 'tenant-1',
        scope: 'demo/records:read demo/records:write',
      },
      'local-tenant-2-writer': {
        subject: 'synthetic-subject-local-2',
        tenantId: 'tenant-2',
        scope: 'demo/records:read demo/records:write',
      },
    });
  });
});

describe('the routes (Spec 01 §2.2)', () => {
  it('sends a read to the read function, with the path parameter and the token claims', async () => {
    const response = await call('/v1/records/record-0001', {
      headers: { 'If-None-Match': '"synthetic"' },
    });
    expect(response.status).toBe(200);
    const [delivery] = received;
    expect(delivery?.event.headers['if-none-match']).toBe('"synthetic"');
    expect(delivery?.functionName).toBe('read');
    expect(delivery?.event).toMatchObject({
      routeKey: 'GET /v1/records/{recordId}',
      rawPath: '/v1/records/record-0001',
      pathParameters: { recordId: 'record-0001' },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: 'synthetic-subject-local-1',
              tenant_id: 'tenant-1',
              scope: 'demo/records:read demo/records:write',
            },
          },
        },
      },
    });
  });

  it('sends a command to the intake function with its body, and answers as the function did', async () => {
    const response = await call('/v1/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-key' },
      body: '{"synthetic":true}',
    });
    expect(response.status).toBe(202);
    expect(response.headers.get('x-correlation-id')).toBe('synthetic');
    expect(await response.json()).toEqual({ functionName: 'intake' });
    expect(received[0]?.event).toMatchObject({
      routeKey: 'POST /v1/commands',
      body: '{"synthetic":true}',
    });
    expect(received[0]?.event.headers['idempotency-key']).toBe('synthetic-key');
  });

  it('sends a status poll to the status function', async () => {
    await call('/v1/operations/01JB0000000000000000000001');
    expect(received[0]).toMatchObject({
      functionName: 'status',
      event: { pathParameters: { operationId: '01JB0000000000000000000001' } },
    });
  });

  it.each([
    ['an unknown path', '/v1/unknown', 'GET'],
    ['a known path with another method', '/v1/commands', 'GET'],
    ['a read with an extra segment', '/v1/records/record-0001/more', 'GET'],
    ['a read with no identifier', '/v1/records/', 'GET'],
  ])(
    'answers %s with the gateway 404, reaching no function (EU3)',
    async (_caseName, path, method) => {
      const response = await call(path, { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: 'Not Found' });
      expect(received).toHaveLength(0);
    },
  );
});

describe('the token check (Spec 01 §4.1, ED3)', () => {
  it.each([
    ['no Authorization header', null],
    ['an unknown token', 'not-a-demo-token'],
  ])('answers %s with the gateway 401, reaching no function', async (_caseName, token) => {
    const response = await call('/v1/records/record-0001', {}, token);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
    expect(received).toHaveLength(0);
  });

  it('answers a header that is not a bearer token with 401', async () => {
    const response = await fetch(`${gateway.baseUrl}/v1/records/record-0001`, {
      headers: { Authorization: `Basic ${writerToken}` },
    });
    expect(response.status).toBe(401);
  });

  it('leaves a missing scope to the handler, setting no route scopes (§4.1)', async () => {
    const response = await call(
      '/v1/commands',
      { method: 'POST', body: '{}' },
      'local-tenant-1-reader',
    );
    expect(response.status).toBe(202);
    expect(received[0]?.functionName).toBe('intake');
  });
});

describe('failures between the gateway and a function', () => {
  it('answers 500 when the function cannot be reached', async () => {
    const unreachable = await startLocalGateway({
      port: 0,
      upstreams: {
        'spec-02-read-handler': 'http://127.0.0.1:9/invoke/read',
        'spec-03-command-handler': 'http://127.0.0.1:9/invoke/intake',
        'spec-03-status-handler': 'http://127.0.0.1:9/invoke/status',
      },
    });
    try {
      const response = await fetch(`${unreachable.baseUrl}/v1/records/record-0001`, {
        headers: { Authorization: `Bearer ${writerToken}` },
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ message: 'Internal Server Error' });
    } finally {
      await unreachable.stop();
    }
  });

  it('answers 413 to a body over 1 MiB, reaching no function', async () => {
    const response = await call('/v1/commands', { method: 'POST', body: 'x'.repeat(1_048_577) });
    expect(response.status).toBe(413);
    expect(received).toHaveLength(0);
  });
});

describe('the access log line (Spec 01 §5.4)', () => {
  it('holds the method, route, status and latency, and never the token or subject (CD5)', async () => {
    await call('/v1/records/record-0001');
    await call('/v1/unknown');
    expect(logLines.map(({ method, routeKey, status }) => ({ method, routeKey, status }))).toEqual([
      { method: 'GET', routeKey: 'GET /v1/records/{recordId}', status: 200 },
      { method: 'GET', routeKey: null, status: 404 },
    ]);
    for (const logLine of logLines) {
      expect(Object.keys(logLine).sort()).toEqual([
        'latencyMilliseconds',
        'method',
        'routeKey',
        'status',
      ]);
      expect(logLine.latencyMilliseconds).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(logLines)).not.toMatch(/local-tenant|synthetic-subject/);
  });
});
