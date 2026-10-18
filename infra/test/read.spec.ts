// Spec 02 RE6 under RQ1 and CQ6: nothing is deployed, so the read function's
// bundled entry point is invoked directly with the shared event builder,
// configured exactly as the ReadPath construct configures it, against the
// mock providers running as local servers over real HTTP. Secrets Manager is
// the one stand in: it hands back each provider's synthetic API key.
import { stderr, stdout } from 'node:process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { providerSecretName, type ProviderConnection } from '@demo/construct-contracts';
import {
  ProblemDocumentSchema,
  ReadResponseSchema,
  httpHeaders,
  scopeNames,
  type DemoHttpHandler,
} from '@demo/contracts';
import { startLocalMockProviders, type LocalMockProviders } from '@demo/mock-providers';
import { readFunctionEnvironment, readPathSettings } from '@demo/read';
import {
  buildLambdaContext,
  buildVerifiedClaimsEvent,
  createInMemoryProviderStore,
  publicRouteNamed,
  syntheticRecords,
} from '@demo/test-doubles';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A record tenant-2 holds and tenant-1 does not, for the tenant isolation row.
const tenantTwoOnlyRecordId = 'record-0004';
const seedWithTenantTwoOnlyRecord = syntheticRecords.filter(
  (syntheticRecord) =>
    !(
      syntheticRecord.tenantId === 'tenant-1' && syntheticRecord.recordId === tenantTwoOnlyRecordId
    ),
);
const syntheticSubject = 'synthetic-subject-re6';

let localProviders: LocalMockProviders;
let readHandler: DemoHttpHandler;
const secretsManager = mockClient(SecretsManagerClient);
const writtenOutput: string[] = [];

function secretArnFor(providerId: string): string {
  return `arn:aws:secretsmanager:eu-west-2:000000000000:secret:${providerSecretName('dev', providerId as never)}-AbCdEf`;
}

beforeAll(async () => {
  // Port 0: the operating system picks free ports, so runs never collide.
  localProviders = await startLocalMockProviders({
    ports: { 'provider-a': 0, 'provider-b': 0, 'provider-c': 0 },
    store: createInMemoryProviderStore(seedWithTenantTwoOnlyRecord),
  });
  const providerConnections: ProviderConnection[] = localProviders.connections.map(
    (connection) => ({
      providerId: connection.providerId,
      baseUrl: connection.baseUrl,
      secretArn: secretArnFor(connection.providerId),
    }),
  );
  for (const connection of localProviders.connections) {
    secretsManager
      .on(GetSecretValueCommand, { SecretId: secretArnFor(connection.providerId) })
      .resolves({ SecretString: connection.apiKey });
  }
  // Everything the function writes, logs and metrics alike, so the suite can
  // show none of it carries a key or the subject (datum 0.15, CD5).
  for (const outputStream of [stdout, stderr]) {
    const originalWrite = outputStream.write.bind(outputStream);
    vi.spyOn(outputStream, 'write').mockImplementation(((
      chunk: string | Uint8Array,
      ...remainingArguments: never[]
    ) => {
      writtenOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return originalWrite(chunk, ...remainingArguments);
    }) as typeof outputStream.write);
  }
  vi.stubEnv('AWS_REGION', 'eu-west-2');
  for (const [variableName, variableValue] of Object.entries(
    readFunctionEnvironment('dev', providerConnections),
  )) {
    vi.stubEnv(variableName, variableValue);
  }
  // Loaded only now: the entry point reads its environment when loaded.
  ({ handler: readHandler } = await import('@demo/read/read-handler-entry'));
}, 30_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  secretsManager.restore();
  await localProviders.stop();
});

async function read(
  recordId: string,
  options: { ifNoneMatch?: string; tenantId?: string; scope?: string } = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  const readEvent = buildVerifiedClaimsEvent({
    route: publicRouteNamed('read-record'),
    pathParameters: { recordId },
    headers: [
      [httpHeaders.correlationIdentifier.wireName, '01JB0000000000000000000006'],
      ...(options.ifNoneMatch === undefined
        ? []
        : ([[httpHeaders.ifNoneMatch.wireName, options.ifNoneMatch]] as [string, string][])),
    ],
    claims: {
      subject: syntheticSubject,
      tenantId: options.tenantId ?? 'tenant-1',
      scope: options.scope ?? scopeNames.recordsRead,
    },
  });
  return readHandler(readEvent, buildLambdaContext());
}

function bodyOf(response: APIGatewayProxyStructuredResultV2) {
  return ReadResponseSchema.parse(JSON.parse(response.body ?? 'null'));
}

function statusesOf(response: APIGatewayProxyStructuredResultV2) {
  return Object.fromEntries(
    bodyOf(response).sources.map((source) => [source.providerId, source.status]),
  );
}

function headerOf(response: APIGatewayProxyStructuredResultV2, headerName: string) {
  return response.headers?.[headerName];
}

describe('the read function against the local mock providers (RE6)', () => {
  it('reads a normal record whole: 200, not partial, three ok sources and an ETag', async () => {
    const response = await read('record-0001');
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).partial).toBe(false);
    expect(statusesOf(response)).toEqual({
      'provider-a': 'ok',
      'provider-b': 'ok',
      'provider-c': 'ok',
    });
    expect(headerOf(response, httpHeaders.entityTag.wireName)).toMatch(/^"/);
  });

  it('answers the same request with that ETag 304', async () => {
    const firstResponse = await read('record-0001');
    const entityTag = String(headerOf(firstResponse, httpHeaders.entityTag.wireName));
    const conditionalResponse = await read('record-0001', { ifNoneMatch: entityTag });
    expect(conditionalResponse.statusCode).toBe(304);
    expect(headerOf(conditionalResponse, httpHeaders.entityTag.wireName)).toBe(entityTag);
  });

  it('answers slow-b- within the budget: partial, provider-b timeout, no ETag, max-age=0', async () => {
    const startedAt = performance.now();
    const response = await read('slow-b-0001');
    const elapsedMilliseconds = performance.now() - startedAt;
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).partial).toBe(true);
    expect(statusesOf(response)['provider-b']).toBe('timeout');
    expect(headerOf(response, httpHeaders.entityTag.wireName)).toBeUndefined();
    expect(headerOf(response, httpHeaders.cacheControl.wireName)).toBe(
      'private, max-age=0, must-revalidate',
    );
    expect(elapsedMilliseconds).toBeLessThan(readPathSettings.fanOutBudgetMilliseconds);
  });

  it('answers down-a- 200, partial, with provider-a error', async () => {
    const response = await read('down-a-0001');
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).partial).toBe(true);
    expect(statusesOf(response)['provider-a']).toBe('error');
  });

  it('answers an unknown record 404', async () => {
    const response = await read('record-9999');
    expect(response.statusCode).toBe(404);
    expect(ProblemDocumentSchema.safeParse(JSON.parse(response.body ?? 'null')).success).toBe(true);
  });

  it('answers a tenant-2 record read with a tenant-1 event 404, while tenant-2 reads it', async () => {
    expect((await read(tenantTwoOnlyRecordId, { tenantId: 'tenant-1' })).statusCode).toBe(404);
    expect((await read(tenantTwoOnlyRecordId, { tenantId: 'tenant-2' })).statusCode).toBe(200);
  });

  it('answers an event without records:read 403', async () => {
    const response = await read('record-0001', { scope: scopeNames.recordsWrite });
    expect(response.statusCode).toBe(403);
  });

  it('logged the absent read cache, and nothing it wrote carries a key or the subject', () => {
    const allOutput = writtenOutput.join('');
    expect(allOutput).toContain('subsystem-absent');
    for (const connection of localProviders.connections) {
      expect(allOutput).not.toContain(connection.apiKey);
    }
    expect(allOutput).not.toContain(syntheticSubject);
  });
});
