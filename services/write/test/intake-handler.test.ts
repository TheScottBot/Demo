// Spec 03 §3 and WE2: intake, invoked directly with the shared event builder
// (CE2), writing to the journal store over the fake table.
import {
  OperationStatusSchema,
  ProblemDocumentSchema,
  contractBounds,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
  type ProviderIdentifier,
} from '@demo/contracts';
import { buildLambdaContext, buildVerifiedClaimsEvent, publicRouteNamed } from '@demo/test-doubles';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIntakeHandler,
  type IntakeLog,
  type IntakeMetrics,
} from '../src/handlers/intake-handler';
import { createJournalStore, type JournalStore } from '../src/journal-store';
import { computeRequestHash } from '../src/request-hash';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';

const idempotencyKey = '00000000-0000-4000-8000-000000000201';
const summaryCommand = {
  type: 'record.section.replace',
  recordId: 'record-0001',
  section: 'summary',
  baseVersion: '0123456789abcdef',
  payload: { title: 'Synthetic summary', status: 'paused' },
};

class RecordingIntake
  implements IntakeLog, IntakeMetrics, ProblemHandlingLog, ProblemHandlingMetrics
{
  readonly events: unknown[][] = [];
  bindOperation(operationId: string): void {
    this.events.push(['bindOperation', operationId]);
  }
  countCommandAccepted(providerId: ProviderIdentifier): void {
    this.events.push(['CommandsAccepted', providerId]);
  }
  countIdempotentReplay(): void {
    this.events.push(['IdempotentReplay']);
  }
  countIdempotencyKeyReused(): void {
    this.events.push(['IdempotencyKeyReused']);
  }
  bindRequestKeys(): void {}
  clearRequestKeys(): void {}
  recordRejection(rejection: { errorCode: string; reasonCategory: string }): void {
    this.events.push(['rejection', rejection.errorCode, rejection.reasonCategory]);
  }
  recordInternalFailure(failure: { errorName: string }): void {
    this.events.push(['internalFailure', failure.errorName]);
  }
  countRequestRejected(): void {}
  named(eventName: string): unknown[][] {
    return this.events.filter((recordedEvent) => recordedEvent[0] === eventName);
  }
}

let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
let recorder: RecordingIntake;
let mintedIdentifiers: number;
let intakeHandler: ReturnType<typeof createIntakeHandler>;

beforeEach(() => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingIntake();
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: () => undefined },
    metrics: { countStaleTransition: () => undefined, countJournalItemRejected: () => undefined },
    now: () => new Date('2026-10-18T09:30:00.000Z'),
  });
  mintedIdentifiers = 0;
  intakeHandler = createIntakeHandler({
    journalStore,
    problemLog: recorder,
    problemMetrics: recorder,
    intakeLog: recorder,
    intakeMetrics: recorder,
    mintOperationId: () => {
      mintedIdentifiers += 1;
      return `01JB00000000000000000002${String(mintedIdentifiers).padStart(2, '0')}`;
    },
  });
});

afterEach(() => {
  journalTable.restore();
});

interface SubmitOptions {
  idempotencyKey?: string | null;
  contentType?: string | null;
  tenantId?: string;
  scope?: string;
  isBase64Encoded?: boolean;
}

async function submit(
  body: string,
  options: SubmitOptions = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  const headers: [string, string][] = [['X-Correlation-Id', '01JB0000000000000000000009']];
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  if (contentType !== null) {
    headers.push(['Content-Type', contentType]);
  }
  const keyHeader = options.idempotencyKey === undefined ? idempotencyKey : options.idempotencyKey;
  if (keyHeader !== null) {
    headers.push(['Idempotency-Key', keyHeader]);
  }
  return intakeHandler(
    buildVerifiedClaimsEvent({
      route: publicRouteNamed('submit-command'),
      headers,
      body,
      isBase64Encoded: options.isBase64Encoded ?? false,
      claims: { tenantId: options.tenantId ?? 'tenant-1', scope: options.scope ?? 'records:write' },
    }),
    buildLambdaContext(),
  );
}

function problemOf(response: APIGatewayProxyStructuredResultV2) {
  return ProblemDocumentSchema.parse(JSON.parse(response.body ?? 'null'));
}

function operationItems() {
  return [...journalTable.items.values()].filter((storedItem) => storedItem['sortKey'] === 'OP');
}

describe('accepting a command (§3.1)', () => {
  it('answers 202 with the ACCEPTED status, its Location and no-store, journalled once', async () => {
    const response = await submit(JSON.stringify(summaryCommand));
    expect(response.statusCode).toBe(202);
    const operationStatus = OperationStatusSchema.parse(JSON.parse(response.body ?? 'null'));
    expect(operationStatus).toEqual({
      operationId: '01JB0000000000000000000201',
      state: 'ACCEPTED',
      recordId: 'record-0001',
      providerId: 'provider-a',
      attempts: 0,
      createdAt: '2026-10-18T09:30:00.000Z',
      updatedAt: '2026-10-18T09:30:00.000Z',
    });
    expect(response.headers).toMatchObject({
      Location: '/v1/operations/01JB0000000000000000000201',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    });
    expect(response.headers).not.toHaveProperty('Idempotent-Replayed');
    expect(operationItems()).toHaveLength(1);
    expect(operationItems()[0]).toMatchObject({
      tenantId: 'tenant-1',
      providerId: 'provider-a',
      section: 'summary',
      idempotencyKey,
      requestHash: computeRequestHash('tenant-1', summaryCommand),
    });
    expect(recorder.named('CommandsAccepted')).toEqual([['CommandsAccepted', 'provider-a']]);
    expect(recorder.named('bindOperation')).toEqual([
      ['bindOperation', '01JB0000000000000000000201'],
    ]);
  });

  it('routes each section to the provider that owns it (§3.1 step 5)', async () => {
    const notesResponse = await submit(
      JSON.stringify({
        type: 'record.notes.append',
        recordId: 'record-0001',
        section: 'notes',
        baseVersion: '0123456789abcdef',
        payload: { text: 'Synthetic note' },
      }),
    );
    expect(OperationStatusSchema.parse(JSON.parse(notesResponse.body ?? 'null')).providerId).toBe(
      'provider-b',
    );
  });

  it('accepts a base64 encoded body, decoded before it is parsed (WQ4)', async () => {
    const response = await submit(Buffer.from(JSON.stringify(summaryCommand)).toString('base64'), {
      isBase64Encoded: true,
    });
    expect(response.statusCode).toBe(202);
    expect(operationItems()[0]?.['requestHash']).toBe(
      computeRequestHash('tenant-1', summaryCommand),
    );
  });
});

describe('the headers (§3.1 step 2, Spec 00 §3.4)', () => {
  it.each([
    ['missing', null],
    ['malformed', 'not-a-uuid'],
    ['too long', `${idempotencyKey}0`],
  ])('refuses a %s Idempotency-Key with idempotency-key-required', async (_caseName, keyHeader) => {
    const response = await submit(JSON.stringify(summaryCommand), { idempotencyKey: keyHeader });
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).type).toBe('https://errors.demo.local/idempotency-key-required');
    expect(operationItems()).toEqual([]);
  });

  it.each([
    ['missing', null],
    ['text/plain', 'text/plain'],
    ['a JSON variant', 'application/problem+json'],
    ['another charset', 'application/json; charset=latin1'],
  ])('refuses a %s Content-Type', async (_caseName, contentType) => {
    const response = await submit(JSON.stringify(summaryCommand), { contentType });
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).invalidFields).toEqual([
      { path: 'headers.Content-Type', reason: 'not-allowed-value' },
    ]);
    expect(operationItems()).toEqual([]);
  });

  it('accepts application/json with a UTF-8 charset, in any case', async () => {
    expect(
      (
        await submit(JSON.stringify(summaryCommand), {
          contentType: 'Application/JSON; charset=UTF-8',
        })
      ).statusCode,
    ).toBe(202);
  });
});

describe('the body bound (§3.1 step 3, WQ4)', () => {
  const overBound = 'x'.repeat(contractBounds.commandRequestBodyMaximumBytes + 1);

  it('refuses a body over the bound as too large, before parsing it', async () => {
    // Not JSON either: a too-large answer shows the bound came first.
    const response = await submit(overBound);
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'too-large' }]);
  });

  it('counts the bound in bytes, so multibyte characters reach it sooner', async () => {
    const multibyteBody = 'é'.repeat(contractBounds.commandRequestBodyMaximumBytes / 2 + 1);
    expect(problemOf(await submit(multibyteBody)).invalidFields).toEqual([
      { path: 'body', reason: 'too-large' },
    ]);
  });

  it('refuses encoded text longer than the encoded bound before decoding it', async () => {
    // Not valid base64 either: too-large shows the bound came before decoding.
    const response = await submit('!'.repeat(87_385), { isBase64Encoded: true });
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'too-large' }]);
  });

  it('refuses a body whose decoded bytes exceed the bound, though its encoding fits', async () => {
    const encodedOverBound = Buffer.from(overBound).toString('base64');
    expect(encodedOverBound.length).toBeLessThanOrEqual(87_384);
    const response = await submit(encodedOverBound, { isBase64Encoded: true });
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'too-large' }]);
  });

  it.each([
    ['characters outside base64', 'not*base64*'],
    ['a broken padding', 'eyJh=fQ'],
  ])('refuses a base64 body with %s', async (_caseName, encodedBody) => {
    const response = await submit(encodedBody, { isBase64Encoded: true });
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'grammar' }]);
  });

  // Each would decode to a valid command under a lenient decoder, so only a
  // strict one refuses it.
  it.each([
    ['its padding removed', (encoded: string) => encoded.replace(/=+$/, '')],
    [
      'a line break inside it',
      (encoded: string) => `${encoded.slice(0, 8)}
${encoded.slice(8)}`,
    ],
  ])('refuses base64 with %s, which a lenient decoder would accept', async (_caseName, altered) => {
    const encoded = Buffer.from(JSON.stringify(summaryCommand)).toString('base64');
    expect(encoded).toMatch(/=$/);
    const response = await submit(altered(encoded), { isBase64Encoded: true });
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'grammar' }]);
    expect(operationItems()).toEqual([]);
  });

  it('refuses a byte that is not UTF-8 inside a string, which replacement would hide', async () => {
    const [beforeTitle, afterTitle] = JSON.stringify(summaryCommand).split('Synthetic summary');
    const bodyBytes = Buffer.concat([
      Buffer.from(String(beforeTitle)),
      Buffer.from([0xff]),
      Buffer.from(String(afterTitle)),
    ]);
    const response = await submit(bodyBytes.toString('base64'), { isBase64Encoded: true });
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'grammar' }]);
    expect(operationItems()).toEqual([]);
  });

  it('refuses decoded bytes that are not UTF-8', async () => {
    const response = await submit(Buffer.from([0xff, 0xfe, 0x7b]).toString('base64'), {
      isBase64Encoded: true,
    });
    expect(problemOf(response).invalidFields).toEqual([{ path: 'body', reason: 'grammar' }]);
  });
});

describe('the command (§3.1 steps 4 and 5)', () => {
  it.each([
    ['a body that is not JSON', '{"type":', { path: 'body', reason: 'grammar' }],
    [
      'an unknown key',
      JSON.stringify({ ...summaryCommand, priority: 'high' }),
      // The enclosing object, never the caller's own key name (Spec 00 §3.6).
      { path: '', reason: 'unknown-field' },
    ],
    [
      'an unknown section',
      JSON.stringify({ ...summaryCommand, section: 'billing' }),
      // Spec 00 CE1 reports this path as section.section: a finding for its
      // owner (WE2 record). Only the start is held here until it is fixed.
      { path: 'section', reason: 'no-matching-variant', pathPrefixOnly: true },
    ],
    [
      'the wrong command type for its section',
      JSON.stringify({ ...summaryCommand, type: 'record.notes.append' }),
      { path: 'type', reason: 'not-allowed-value' },
    ],
    [
      'a payload that breaks its section schema',
      JSON.stringify({ ...summaryCommand, payload: { title: '', status: 'paused' } }),
      { path: 'payload.title', reason: 'too-short' },
    ],
  ])(
    'refuses %s with 400, naming the field and not the value',
    async (_caseName, body, invalidField) => {
      const response = await submit(body);
      expect(response.statusCode).toBe(400);
      const problem = problemOf(response);
      expect(problem.type).toBe('https://errors.demo.local/validation-failed');
      const { pathPrefixOnly, ...expectedField } = invalidField as typeof invalidField & {
        pathPrefixOnly?: boolean;
      };
      expect(
        problem.invalidFields?.map((reportedField) =>
          pathPrefixOnly === true
            ? { ...reportedField, path: reportedField.path.slice(0, expectedField.path.length) }
            : reportedField,
        ),
      ).toContainEqual(expectedField);
      expect(response.body).not.toContain('billing');
      expect(response.body).not.toContain('high');
      expect(operationItems()).toEqual([]);
    },
  );

  it('requires records:write (§3.1 step 1)', async () => {
    const response = await submit(JSON.stringify(summaryCommand), { scope: 'records:read' });
    expect(response.statusCode).toBe(403);
    expect(operationItems()).toEqual([]);
  });
});

describe('replays (§3.2)', () => {
  it("answers a replay of the same body with the original operation's current status, marked replayed", async () => {
    await submit(JSON.stringify(summaryCommand));
    await journalStore.transitionOperation({
      operationId: '01JB0000000000000000000201',
      targetState: 'QUEUED',
      origin: 'relay',
    });
    // Same body, keys in another order: the canonical form is the same.
    const reordered = JSON.stringify({
      payload: { status: 'paused', title: 'Synthetic summary' },
      baseVersion: '0123456789abcdef',
      section: 'summary',
      recordId: 'record-0001',
      type: 'record.section.replace',
    });
    const replay = await submit(reordered);
    expect(replay.statusCode).toBe(202);
    expect(OperationStatusSchema.parse(JSON.parse(replay.body ?? 'null'))).toMatchObject({
      operationId: '01JB0000000000000000000201',
      state: 'QUEUED',
    });
    expect(replay.headers).toMatchObject({
      Location: '/v1/operations/01JB0000000000000000000201',
      'Idempotent-Replayed': 'true',
      'Cache-Control': 'no-store',
    });
    expect(operationItems()).toHaveLength(1);
    expect(recorder.named('IdempotentReplay')).toHaveLength(1);
    expect(recorder.named('CommandsAccepted')).toHaveLength(1);
  });

  it('answers the same key with a different body 422 idempotency-key-reused', async () => {
    await submit(JSON.stringify(summaryCommand));
    const reused = await submit(
      JSON.stringify({ ...summaryCommand, payload: { title: 'Other', status: 'paused' } }),
    );
    expect(reused.statusCode).toBe(422);
    expect(problemOf(reused).type).toBe('https://errors.demo.local/idempotency-key-reused');
    expect(recorder.named('IdempotencyKeyReused')).toHaveLength(1);
    expect(operationItems()).toHaveLength(1);
  });

  it('keys idempotency by tenant, so another tenant may use the same key', async () => {
    await submit(JSON.stringify(summaryCommand));
    expect(
      (await submit(JSON.stringify(summaryCommand), { tenantId: 'tenant-2' })).statusCode,
    ).toBe(202);
    expect(operationItems()).toHaveLength(2);
    // The tenant is part of what is hashed, not only of the key.
    expect(
      operationItems().find((storedItem) => storedItem['tenantId'] === 'tenant-2')?.['requestHash'],
    ).toBe(computeRequestHash('tenant-2', summaryCommand));
  });

  it('answers any other transaction failure 500, so the client retries with the same key', async () => {
    journalTable.failNext('TransactWrite', new Error('ProvisionedThroughputExceededException'));
    const response = await submit(JSON.stringify(summaryCommand));
    expect(response.statusCode).toBe(500);
    expect(problemOf(response).type).toBe('https://errors.demo.local/internal');
    expect(operationItems()).toEqual([]);
  });
});
