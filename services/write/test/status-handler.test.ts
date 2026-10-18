// Spec 03 §9 and WE6: the status handler, invoked directly with the shared
// event builder, over the fake journal table.
import {
  OperationStatusSchema,
  ProblemDocumentSchema,
  type OperationState,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
} from '@demo/contracts';
import { buildLambdaContext, buildVerifiedClaimsEvent, publicRouteNamed } from '@demo/test-doubles';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStatusHandler, type StatusLog } from '../src/handlers/status-handler';
import { createJournalStore, type JournalStore } from '../src/journal-store';
import { writePathSettings } from '../src/write-path-settings';
import {
  createFakeCommandJournalTable,
  fakeJournalTableName,
  type FakeCommandJournalTable,
} from './support/fake-command-journal-table';
import { newOperation } from './support/write-path-fixtures';

class RecordingStatus implements StatusLog, ProblemHandlingLog, ProblemHandlingMetrics {
  readonly events: unknown[][] = [];
  bindOperation(operationId: string): void {
    this.events.push(['bindOperation', operationId]);
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
}

const operationId = '01JB0000000000000000000101';
let journalTable: FakeCommandJournalTable;
let journalStore: JournalStore;
let recorder: RecordingStatus;

beforeEach(async () => {
  journalTable = createFakeCommandJournalTable();
  recorder = new RecordingStatus();
  journalStore = createJournalStore({
    documentClient: journalTable.documentClient,
    tableName: fakeJournalTableName,
    log: { recordStaleTransition: () => undefined },
    metrics: { countStaleTransition: () => undefined, countJournalItemRejected: () => undefined },
    now: () => new Date('2026-10-18T09:30:00.000Z'),
  });
  await journalStore.createOperation(newOperation());
});

afterEach(() => {
  journalTable.restore();
});

function statusHandler() {
  return createStatusHandler({
    journalStore,
    problemLog: recorder,
    problemMetrics: recorder,
    statusLog: recorder,
  });
}

async function readStatus(
  options: { operationId?: string | null; tenantId?: string; scope?: string } = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  const requestedId = options.operationId === undefined ? operationId : options.operationId;
  return statusHandler()(
    buildVerifiedClaimsEvent({
      route: publicRouteNamed('read-operation'),
      pathParameters: requestedId === null ? { operationId: '' } : { operationId: requestedId },
      headers: [['X-Correlation-Id', '01JB0000000000000000000009']],
      claims: { tenantId: options.tenantId ?? 'tenant-1', scope: options.scope ?? 'records:write' },
    }),
    buildLambdaContext(),
  );
}

// The detail each state carries, as the status contract requires it.
const detailForState: Partial<Record<OperationState, Record<string, unknown>>> = {
  SUCCEEDED: { result: { providerVersion: 'fedcba9876543210' } },
  CONFLICT: { conflict: { reason: 'precondition-failed' } },
  FAILED: { failure: { code: 'provider-not-held', reason: 'not-held' } },
  DEAD_LETTERED: { failure: { code: 'retries-exhausted', reason: 'server-error' } },
};

// Puts the operation in the given state, with the platform fields set that the
// status must leave out. Only ACCEPTED keeps the pending attributes (§4.2).
function setState(state: OperationState): void {
  const storedItem = { ...journalTable.itemAt(`OP#${operationId}`, 'OP') };
  if (state !== 'ACCEPTED') {
    Reflect.deleteProperty(storedItem, 'pendingBucket');
    Reflect.deleteProperty(storedItem, 'pendingSince');
  }
  journalTable.putItem({
    ...storedItem,
    state,
    ...detailForState[state],
    lastErrorReason: 'server-error',
    redriveCount: 1,
    attempts: 2,
    lastTransitionOrigin: 'worker',
  });
}

describe('reading an operation (§9)', () => {
  it('answers 200 with the OperationStatus, no-store, and none of the platform fields', async () => {
    const response = await readStatus();
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? 'null') as Record<string, unknown>;
    expect(OperationStatusSchema.parse(body)).toEqual({
      operationId,
      state: 'ACCEPTED',
      recordId: 'record-0001',
      providerId: 'provider-a',
      attempts: 0,
      createdAt: '2026-10-18T09:30:00.000Z',
      updatedAt: '2026-10-18T09:30:00.000Z',
    });
    for (const platformField of [
      'payload',
      'requestHash',
      'lastErrorReason',
      'lastTransitionOrigin',
      'redriveCount',
      'tenantId',
      'idempotencyKey',
    ]) {
      expect(body).not.toHaveProperty(platformField);
    }
    expect(response.headers).toMatchObject({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    });
    expect(recorder.events).toContainEqual(['bindOperation', operationId]);
  });

  it.each([
    ['ACCEPTED', String(writePathSettings.statusRetryAfterInProgressSeconds)],
    ['QUEUED', String(writePathSettings.statusRetryAfterInProgressSeconds)],
    ['APPLYING', String(writePathSettings.statusRetryAfterInProgressSeconds)],
    ['DEAD_LETTERED', String(writePathSettings.statusRetryAfterAwaitingOperatorSeconds)],
  ] as const)('sets Retry-After for %s to %s seconds (WU19)', async (state, retryAfter) => {
    setState(state);
    const response = await readStatus();
    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Retry-After']).toBe(retryAfter);
  });

  it.each(['SUCCEEDED', 'CONFLICT', 'FAILED'] as const)(
    'sets no Retry-After for the terminal state %s, and shows its detail',
    async (state) => {
      setState(state);
      const response = await readStatus();
      expect(response.headers).not.toHaveProperty('Retry-After');
      expect(OperationStatusSchema.parse(JSON.parse(response.body ?? 'null')).state).toBe(state);
    },
  );

  it('holds the WU19 values', () => {
    expect(writePathSettings).toMatchObject({
      statusRetryAfterInProgressSeconds: 2,
      statusRetryAfterAwaitingOperatorSeconds: 60,
    });
  });
});

describe('refusals (§9)', () => {
  it.each([
    ['lower case', operationId.toLowerCase(), 'grammar'],
    ['too long', `${operationId}0`, 'too-long'],
    ['not a ULID', 'operation-0001', 'grammar'],
    ['empty', null, 'grammar'],
  ])(
    'refuses an operationId that is %s with 400, naming the field',
    async (_caseName, requestedId, reason) => {
      const response = await readStatus({ operationId: requestedId });
      expect(response.statusCode).toBe(400);
      expect(
        ProblemDocumentSchema.parse(JSON.parse(response.body ?? 'null')).invalidFields,
      ).toEqual([{ path: 'pathParameters.operationId', reason }]);
      expect(journalTable.calls).toHaveLength(1);
    },
  );

  it("answers another tenant's operation 404, as it answers one that does not exist (Spec 00 §3.5)", async () => {
    const otherTenant = await readStatus({ tenantId: 'tenant-2' });
    const missing = await readStatus({ operationId: '01JB0000000000000000000199' });
    for (const response of [otherTenant, missing]) {
      expect(response.statusCode).toBe(404);
      expect(ProblemDocumentSchema.parse(JSON.parse(response.body ?? 'null')).type).toBe(
        'https://errors.demo.local/not-found',
      );
      expect(response.headers?.['Cache-Control']).toBe('no-store');
    }
    expect(otherTenant.body?.replace(/"correlationId":"[^"]*"/, '')).toBe(
      missing.body?.replace(/"correlationId":"[^"]*"/, ''),
    );
  });

  it('requires records:write (WD4)', async () => {
    const response = await readStatus({ scope: 'records:read' });
    expect(response.statusCode).toBe(403);
  });

  it('answers 500 for a journal item it must refuse, rather than any part of it', async () => {
    journalTable.putItem({ ...journalTable.itemAt(`OP#${operationId}`, 'OP'), schemaVersion: 2 });
    const response = await readStatus();
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('record-0001');
  });
});
