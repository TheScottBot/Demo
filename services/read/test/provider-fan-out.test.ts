// Spec 02 §3.1 and RE3: the fan-out, with fake timers and stub adapters.
import type { ProviderIdentifier, ProviderReadResult, ReadAdapter } from '@demo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fanOutToProviders, type FanOutOptions } from '../src/provider-fan-out';
import { readPathSettings } from '../src/read-path-settings';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const okResult = (version: string): ProviderReadResult => ({
  outcome: 'ok',
  version,
  updatedAt: '2026-10-18T09:00:00.000Z',
  ttlSeconds: 60,
  sections: {},
});

interface SeenCall {
  providerId: ProviderIdentifier;
  ifNoneMatchVersion: string | undefined;
  correlationId: string;
  abortSignal: AbortSignal;
}

let seenCalls: SeenCall[];

beforeEach(() => {
  seenCalls = [];
});

// A stub that answers after a delay, or never, and honours its signal as a
// real adapter does: an abort rejects with the signal's reason.
function stubAdapter(
  providerId: ProviderIdentifier,
  behaviour:
    | { kind: 'answers'; afterMilliseconds: number; result: ProviderReadResult }
    | { kind: 'fails'; afterMilliseconds: number; failure: Error }
    | { kind: 'never-answers' }
    | { kind: 'ignores-abort' },
): ReadAdapter {
  return {
    providerId,
    read: (readRequest, callOptions) => {
      seenCalls.push({
        providerId,
        ifNoneMatchVersion: readRequest.ifNoneMatchVersion,
        correlationId: callOptions.correlationId,
        abortSignal: callOptions.abortSignal,
      });
      return new Promise<ProviderReadResult>((resolve, reject) => {
        if (behaviour.kind !== 'ignores-abort') {
          callOptions.abortSignal.addEventListener('abort', () => {
            reject(callOptions.abortSignal.reason as Error);
          });
        }
        if (behaviour.kind === 'answers') {
          setTimeout(() => {
            resolve(behaviour.result);
          }, behaviour.afterMilliseconds);
        } else if (behaviour.kind === 'fails') {
          setTimeout(() => {
            reject(behaviour.failure);
          }, behaviour.afterMilliseconds);
        }
      });
    },
  };
}

function fanOut(readAdapters: ReadAdapter[], overrides: Partial<FanOutOptions> = {}) {
  return fanOutToProviders({
    readAdapters,
    readRequest: { tenantId: 'tenant-1', recordId: 'record-0001' },
    clientVersionsByProvider: {},
    correlationId: '01JB0000000000000000000009',
    providerTimeoutMilliseconds: 1_500,
    fanOutBudgetMilliseconds: 2_500,
    now: () => Date.now(),
    ...overrides,
  });
}

// Advances the fake clock until the fan-out settles, returning when it did.
async function settle<T>(pending: Promise<T>): Promise<{ value: T; elapsedMilliseconds: number }> {
  const startedAt = Date.now();
  let settledValue: T | undefined;
  let settled = false;
  void pending.then((value) => {
    settledValue = value;
    settled = true;
  });
  // Read through a function: the flag is set in a callback, which lint
  // would otherwise take to mean it can never change.
  const hasSettled = () => settled;
  while (!hasSettled()) {
    await vi.advanceTimersByTimeAsync(10);
    if (Date.now() - startedAt > 10_000) {
      throw new Error('fan-out never settled');
    }
  }
  return { value: settledValue as T, elapsedMilliseconds: Date.now() - startedAt };
}

describe('fanOutToProviders', () => {
  it('calls every provider at once, with its own version and the correlation identifier', async () => {
    await settle(
      fanOut(
        [
          stubAdapter('provider-a', {
            kind: 'answers',
            afterMilliseconds: 50,
            result: okResult('a1'),
          }),
          stubAdapter('provider-b', {
            kind: 'answers',
            afterMilliseconds: 50,
            result: okResult('b1'),
          }),
          stubAdapter('provider-c', {
            kind: 'answers',
            afterMilliseconds: 50,
            result: okResult('c1'),
          }),
        ],
        { clientVersionsByProvider: { 'provider-b': 'b0' } },
      ),
    );
    expect(seenCalls.map((seenCall) => [seenCall.providerId, seenCall.ifNoneMatchVersion])).toEqual(
      [
        ['provider-a', undefined],
        ['provider-b', 'b0'],
        ['provider-c', undefined],
      ],
    );
    expect(new Set(seenCalls.map((seenCall) => seenCall.correlationId))).toEqual(
      new Set(['01JB0000000000000000000009']),
    );
  });

  it('aborts a provider at its own timeout, and maps that to timeout', async () => {
    const { value: outcomes, elapsedMilliseconds } = await settle(
      fanOut([
        stubAdapter('provider-a', {
          kind: 'answers',
          afterMilliseconds: 100,
          result: okResult('a1'),
        }),
        stubAdapter('provider-b', { kind: 'never-answers' }),
        stubAdapter('provider-c', {
          kind: 'answers',
          afterMilliseconds: 200,
          result: okResult('c1'),
        }),
      ]),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'timeout', 'ok']);
    expect(outcomes[1]).toEqual({
      providerId: 'provider-b',
      status: 'timeout',
      ttlSeconds: 0,
      latencyMilliseconds: 1_500,
    });
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(1_500);
    expect(elapsedMilliseconds).toBeLessThan(1_600);
    expect(seenCalls[1]?.abortSignal.aborted).toBe(true);
  });

  it('aborts every outstanding call at the overall budget', async () => {
    const { value: outcomes, elapsedMilliseconds } = await settle(
      fanOut(
        [
          stubAdapter('provider-a', { kind: 'never-answers' }),
          stubAdapter('provider-b', { kind: 'never-answers' }),
          stubAdapter('provider-c', {
            kind: 'answers',
            afterMilliseconds: 100,
            result: okResult('c1'),
          }),
        ],
        { providerTimeoutMilliseconds: 2_000, fanOutBudgetMilliseconds: 1_000 },
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['timeout', 'timeout', 'ok']);
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(1_000);
    expect(elapsedMilliseconds).toBeLessThan(1_100);
  });

  it('honours a parent signal, for the second call within the remaining budget (§4.3)', async () => {
    const parentController = new AbortController();
    setTimeout(() => {
      parentController.abort();
    }, 300);
    const { value: outcomes } = await settle(
      fanOut([stubAdapter('provider-a', { kind: 'never-answers' })], {
        parentSignal: parentController.signal,
      }),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['timeout']);
    expect(outcomes[0]?.latencyMilliseconds).toBe(300);
  });

  // fetch given a signal that has already fired rejects at once, with the
  // signal's reason, before any abort event: that must still read as timeout.
  it('maps an immediate rejection on an already fired signal to timeout', async () => {
    const firedController = new AbortController();
    firedController.abort(new DOMException('deadline passed', 'TimeoutError'));
    const rejectsAtOnce: ReadAdapter = {
      providerId: 'provider-a',
      read: (_readRequest, callOptions) =>
        callOptions.abortSignal.aborted
          ? Promise.reject(callOptions.abortSignal.reason as Error)
          : Promise.resolve(okResult('a1')),
    };
    const { value: outcomes } = await settle(
      fanOut([rejectsAtOnce], { parentSignal: firedController.signal }),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['timeout']);
  });

  it('maps any other rejection to error transport', async () => {
    const { value: outcomes } = await settle(
      fanOut([
        stubAdapter('provider-a', {
          kind: 'fails',
          afterMilliseconds: 20,
          failure: new Error('secret read failed'),
        }),
      ]),
    );
    expect(outcomes).toEqual([
      {
        providerId: 'provider-a',
        status: 'error',
        errorReason: 'transport',
        ttlSeconds: 0,
        latencyMilliseconds: 20,
      },
    ]);
  });

  it('maps an adapter result to its outcome, keeping version, updatedAt, ttl and sections', async () => {
    const { value: outcomes } = await settle(
      fanOut([
        stubAdapter('provider-a', {
          kind: 'answers',
          afterMilliseconds: 40,
          result: { outcome: 'error', errorReason: 'version-mismatch', ttlSeconds: 0 },
        }),
        stubAdapter('provider-c', {
          kind: 'answers',
          afterMilliseconds: 60,
          result: {
            ...okResult('c1'),
            sections: { preferences: { contactWindow: 'morning', language: 'en-GB' } },
          },
        }),
      ]),
    );
    expect(outcomes).toEqual([
      {
        providerId: 'provider-a',
        status: 'error',
        errorReason: 'version-mismatch',
        ttlSeconds: 0,
        latencyMilliseconds: 40,
      },
      {
        providerId: 'provider-c',
        status: 'ok',
        version: 'c1',
        updatedAt: '2026-10-18T09:00:00.000Z',
        ttlSeconds: 60,
        sections: { preferences: { contactWindow: 'morning', language: 'en-GB' } },
        latencyMilliseconds: 60,
      },
    ]);
  });

  it('does not let one slow provider delay the others', async () => {
    const { value: outcomes } = await settle(
      fanOut([
        stubAdapter('provider-a', {
          kind: 'answers',
          afterMilliseconds: 80,
          result: okResult('a1'),
        }),
        stubAdapter('provider-b', {
          kind: 'answers',
          afterMilliseconds: 1_400,
          result: okResult('b1'),
        }),
        stubAdapter('provider-c', {
          kind: 'answers',
          afterMilliseconds: 90,
          result: okResult('c1'),
        }),
      ]),
    );
    expect(outcomes.map((outcome) => outcome.latencyMilliseconds)).toEqual([80, 1_400, 90]);
  });

  // §3: whatever arrived in time is returned, even if an adapter ignores its
  // signal and never settles.
  it('times out an adapter that ignores its abort signal', async () => {
    const { value: outcomes, elapsedMilliseconds } = await settle(
      fanOut([
        stubAdapter('provider-a', { kind: 'ignores-abort' }),
        stubAdapter('provider-b', {
          kind: 'answers',
          afterMilliseconds: 50,
          result: okResult('b1'),
        }),
      ]),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['timeout', 'ok']);
    expect(elapsedMilliseconds).toBeLessThan(1_600);
  });

  it('leaves no timer running once it has settled', async () => {
    await settle(
      fanOut([
        stubAdapter('provider-a', {
          kind: 'answers',
          afterMilliseconds: 10,
          result: okResult('a1'),
        }),
        stubAdapter('provider-b', {
          kind: 'answers',
          afterMilliseconds: 20,
          result: okResult('b1'),
        }),
      ]),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a budget or timeout that is not a positive whole number of milliseconds', () => {
    expect(() => fanOut([], { providerTimeoutMilliseconds: 0 })).toThrow();
    expect(() => fanOut([], { fanOutBudgetMilliseconds: 1.5 })).toThrow();
  });
});

describe('the fan-out timing the author adopted', () => {
  it('holds RU1 and RU2, with the provider timeout inside the budget', () => {
    expect(readPathSettings.providerTimeoutMilliseconds).toBe(1_500);
    expect(readPathSettings.fanOutBudgetMilliseconds).toBe(2_500);
    expect(readPathSettings.providerTimeoutMilliseconds).toBeLessThan(
      readPathSettings.fanOutBudgetMilliseconds,
    );
  });
});
