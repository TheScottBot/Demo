// The local demonstration end to end: the gateway stand-in in front of the
// real read function, the real intake and status functions with the write
// path's local model behind them, and the mock providers, each on its own
// local server, every call over real HTTP.
import { OperationStatusSchema, ReadResponseSchema } from '@demo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalDemo, type LocalDemo } from '../src/local-demo';

let localDemo: LocalDemo;

beforeAll(async () => {
  localDemo = await startLocalDemo({
    ports: {
      gateway: 0,
      readService: 0,
      writeService: 0,
      providers: { 'provider-a': 0, 'provider-b': 0, 'provider-c': 0 },
    },
    pumpIntervalMilliseconds: 20,
  });
}, 60_000);

afterAll(async () => {
  await localDemo.stop();
});

function call(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${localDemo.gatewayUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) },
  });
}

async function readRecord(recordId: string, token = 'local-tenant-1-reader') {
  const response = await call(`/v1/records/${recordId}`, token);
  return { response, body: ReadResponseSchema.parse(await response.json()) };
}

async function pollUntilSettled(operationId: string, token = 'local-tenant-1-writer') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await call(`/v1/operations/${operationId}`, token);
    const operation = OperationStatusSchema.parse(await response.json());
    if (!['ACCEPTED', 'QUEUED', 'APPLYING'].includes(operation.state)) {
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('operation did not settle');
}

describe('the local demo', () => {
  it('reads a record whole from the three providers', async () => {
    const { response, body } = await readRecord('record-0001');
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toEqual(expect.any(String));
    expect(body.partial).toBe(false);
    expect(body.sources.map((source) => source.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('reads a record partially while one provider is down', async () => {
    const { response, body } = await readRecord('down-b-0001');
    expect(response.status).toBe(200);
    expect(body.partial).toBe(true);
  });

  it('answers a repeated read with its ETag 304', async () => {
    const first = await call('/v1/records/record-0002', 'local-tenant-1-reader');
    const entityTag = first.headers.get('etag') ?? '';
    const second = await call('/v1/records/record-0002', 'local-tenant-1-reader', {
      headers: { 'If-None-Match': entityTag },
    });
    expect(second.status).toBe(304);
  });

  it('accepts a command, applies it, and shows the change on the next read', async () => {
    const { body } = await readRecord('record-0003', 'local-tenant-1-writer');
    const baseVersion = body.sources.find((source) => source.providerId === 'provider-a')?.version;
    const response = await call('/v1/commands', 'local-tenant-1-writer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000a01',
      },
      body: JSON.stringify({
        type: 'record.section.replace',
        recordId: 'record-0003',
        section: 'summary',
        baseVersion,
        payload: { title: 'Synthetic local demo summary', status: 'paused' },
      }),
    });
    expect(response.status).toBe(202);
    const accepted = OperationStatusSchema.parse(await response.json());
    expect(accepted.operationId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect((await pollUntilSettled(accepted.operationId)).state).toBe('SUCCEEDED');
    const { body: afterwards } = await readRecord('record-0003');
    expect(afterwards.record.sections.summary).toMatchObject({
      title: 'Synthetic local demo summary',
    });
  });

  it('ends a command against a stale version CONFLICT, never overwriting', async () => {
    const response = await call('/v1/commands', 'local-tenant-1-writer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000a02',
      },
      body: JSON.stringify({
        type: 'record.section.replace',
        recordId: 'conflict-0001',
        section: 'summary',
        baseVersion: '0000000000000000',
        payload: { title: 'Synthetic stale summary', status: 'paused' },
      }),
    });
    const accepted = OperationStatusSchema.parse(await response.json());
    expect((await pollUntilSettled(accepted.operationId)).state).toBe('CONFLICT');
  });

  it("refuses a command from a token without the write scope, in the handler's problem document", async () => {
    const response = await call('/v1/commands', 'local-tenant-1-reader', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000a03',
      },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  it("does not show one tenant another tenant's operation", async () => {
    const response = await call('/v1/commands', 'local-tenant-1-writer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000a04',
      },
      body: JSON.stringify({
        type: 'record.notes.append',
        recordId: 'record-0004',
        section: 'notes',
        baseVersion: '0000000000000000',
        payload: { text: 'Synthetic local demo note' },
      }),
    });
    const accepted = OperationStatusSchema.parse(await response.json());
    const otherTenant = await call(
      `/v1/operations/${accepted.operationId}`,
      'local-tenant-2-writer',
    );
    expect(otherTenant.status).toBe(404);
  });

  it('answers a request without a token 401 at the gateway', async () => {
    const response = await fetch(`${localDemo.gatewayUrl}/v1/records/record-0001`);
    expect(response.status).toBe(401);
  });
});
