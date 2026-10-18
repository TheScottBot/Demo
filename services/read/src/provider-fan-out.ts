import type { ProviderReadResult, ReadAdapter } from '@demo/contracts';
import type { VersionsByProvider } from './aggregate-etag';
import type { ProviderCallOutcome } from './record-merge';

// Spec 02 §3.1: call every provider in parallel, each with its own timeout and
// all under one budget, and return whatever arrived in time. Pure (Spec 02
// §2): the adapters and the clock are injected.
//
// Each deadline is a setTimeout that aborts a controller, combined with
// AbortSignal.any (RU3). AbortSignal.timeout would do the same in production,
// but runs on timers no test clock can drive (observed in RE3), so the
// deadlines here are ordinary timers the tests can.
//
// No call is retried (§3.1): a read is cheap for the client to repeat.

export interface FanOutOptions {
  readonly readAdapters: readonly ReadAdapter[];
  readonly readRequest: { readonly tenantId: string; readonly recordId: string };
  readonly clientVersionsByProvider: VersionsByProvider;
  readonly correlationId: string;
  // RU1.
  readonly providerTimeoutMilliseconds: number;
  // RU2, or what remains of it for the second call of §4.3.
  readonly fanOutBudgetMilliseconds: number;
  // Milliseconds, for latency.
  readonly now: () => number;
  // Aborts every call when it fires, for a caller's own deadline.
  readonly parentSignal?: AbortSignal;
}

function deadlineReason(deadline: 'provider timeout' | 'fan-out budget'): DOMException {
  return new DOMException(`${deadline} reached`, 'TimeoutError');
}

function outcomeFromResult(
  providerId: ReadAdapter['providerId'],
  result: ProviderReadResult,
  latencyMilliseconds: number,
): ProviderCallOutcome {
  return {
    providerId,
    status: result.outcome,
    ...(result.errorReason === undefined ? {} : { errorReason: result.errorReason }),
    ...(result.version === undefined ? {} : { version: result.version }),
    ...(result.updatedAt === undefined ? {} : { updatedAt: result.updatedAt }),
    ttlSeconds: result.ttlSeconds,
    ...(result.sections === undefined ? {} : { sections: result.sections }),
    latencyMilliseconds,
  };
}

async function callProvider(
  readAdapter: ReadAdapter,
  options: FanOutOptions,
  sharedSignals: readonly AbortSignal[],
  startTimer: (onDeadline: () => void, delayMilliseconds: number) => void,
): Promise<ProviderCallOutcome> {
  const providerController = new AbortController();
  startTimer(() => {
    providerController.abort(deadlineReason('provider timeout'));
  }, options.providerTimeoutMilliseconds);
  const abortSignal = AbortSignal.any([providerController.signal, ...sharedSignals]);
  const startedAt = options.now();
  const latency = () => Math.round(options.now() - startedAt);
  const timedOut = (): ProviderCallOutcome => ({
    providerId: readAdapter.providerId,
    status: 'timeout',
    ttlSeconds: 0,
    latencyMilliseconds: latency(),
  });

  // An adapter that ignores its signal must still not hold the read up (§3),
  // so the call is raced against the signal itself.
  const signalFired = new Promise<'signal-fired'>((resolve) => {
    if (abortSignal.aborted) {
      resolve('signal-fired');
    }
    abortSignal.addEventListener(
      'abort',
      () => {
        resolve('signal-fired');
      },
      { once: true },
    );
  });
  const adapterCall = readAdapter.read(
    {
      ...options.readRequest,
      ...(options.clientVersionsByProvider[readAdapter.providerId] === undefined
        ? {}
        : { ifNoneMatchVersion: options.clientVersionsByProvider[readAdapter.providerId] }),
    },
    { abortSignal, correlationId: options.correlationId },
  );
  // A call that settles after the race is decided has nothing left to report
  // to; its outcome is dropped rather than left as an unhandled rejection.
  adapterCall.catch(() => undefined);

  try {
    const raceWinner = await Promise.race([adapterCall, signalFired]);
    return raceWinner === 'signal-fired'
      ? timedOut()
      : outcomeFromResult(readAdapter.providerId, raceWinner, latency());
  } catch {
    // §3.1: a rejection caused by the signal is a timeout; any other is transport.
    return abortSignal.aborted
      ? timedOut()
      : {
          providerId: readAdapter.providerId,
          status: 'error',
          errorReason: 'transport',
          ttlSeconds: 0,
          latencyMilliseconds: latency(),
        };
  }
}

function isPositiveWholeNumber(candidate: number): boolean {
  return Number.isInteger(candidate) && candidate > 0;
}

async function runFanOut(options: FanOutOptions): Promise<ProviderCallOutcome[]> {
  const runningTimers: ReturnType<typeof setTimeout>[] = [];
  const startTimer = (onDeadline: () => void, delayMilliseconds: number) => {
    runningTimers.push(setTimeout(onDeadline, delayMilliseconds));
  };
  const budgetController = new AbortController();
  startTimer(() => {
    budgetController.abort(deadlineReason('fan-out budget'));
  }, options.fanOutBudgetMilliseconds);
  const sharedSignals =
    options.parentSignal === undefined
      ? [budgetController.signal]
      : [budgetController.signal, options.parentSignal];
  try {
    return await Promise.all(
      options.readAdapters.map((readAdapter) =>
        callProvider(readAdapter, options, sharedSignals, startTimer),
      ),
    );
  } finally {
    // Nothing is left running once the read has its answer: a frozen Lambda
    // must not wake to a stray timer.
    for (const runningTimer of runningTimers) {
      clearTimeout(runningTimer);
    }
  }
}

// Outcomes come back in the order of readAdapters, which the caller gives in
// routing table order. The timing is checked here, synchronously, so a bad
// value fails at once rather than as a rejected read.
export function fanOutToProviders(options: FanOutOptions): Promise<ProviderCallOutcome[]> {
  if (
    !isPositiveWholeNumber(options.providerTimeoutMilliseconds) ||
    !isPositiveWholeNumber(options.fanOutBudgetMilliseconds)
  ) {
    throw new Error('fan-out-timing-must-be-positive-whole-milliseconds');
  }
  return runFanOut(options);
}
