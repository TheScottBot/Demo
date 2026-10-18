import type { DemoHttpHandler } from '@demo/contracts';
import { syntheticProviderApiKey } from '@demo/test-doubles';
import { createLocalWritePath } from '@demo/write/test-support/local-write-path';
import { ulid } from 'ulid';
import { startLocalFunctionServer, type LocalServer } from './local-function-server';
import type { LocalProviderAddress } from './local-read-service';

// The write path's local server: the real intake and status functions behind
// a function server of their own, with WE9's local model of the write path
// behind them (the journal table and its stream, the relay, the FIFO queue
// with its dead letter queue, the sweep and the real worker calling the
// providers over HTTP). The same model WE9 tests; not DynamoDB or SQS.
//
// A pump runs the relay and the worker, after every accepted command and on
// a timer. The model's clock is moved on to the wall clock before each run.
// A retry's backoff is not waited out: the model moves its clock to the next
// visible message, so a retried command settles at once.

export async function startLocalWriteService(options: {
  port: number;
  providers: readonly LocalProviderAddress[];
  pumpIntervalMilliseconds: number;
  onPumpFailure?: () => void;
}): Promise<LocalServer> {
  const writePath = createLocalWritePath({
    relayEnabled: true,
    providerConnections: options.providers.map((provider) => ({
      ...provider,
      apiKey: syntheticProviderApiKey(provider.providerId),
    })),
    startAt: new Date(),
    mintOperationId: () => ulid(),
  });

  let pumping: Promise<void> | undefined;
  const pump = (): Promise<void> => {
    pumping ??= (async () => {
      try {
        const behind = Date.now() - writePath.now();
        if (behind > 0) {
          writePath.advanceTime(behind);
        }
        await writePath.settle();
      } catch {
        options.onPumpFailure?.();
      } finally {
        pumping = undefined;
      }
    })();
    return pumping;
  };
  const timer = setInterval(() => {
    void pump();
  }, options.pumpIntervalMilliseconds);

  const intake: DemoHttpHandler = async (event, lambdaContext) => {
    const response = await writePath.handlers.intake(event, lambdaContext);
    void pump();
    return response;
  };
  const functionServer = await startLocalFunctionServer({
    port: options.port,
    functions: { intake, status: writePath.handlers.status },
  });
  return {
    baseUrl: functionServer.baseUrl,
    stop: async () => {
      clearInterval(timer);
      await functionServer.stop();
      await pumping;
      writePath.stop();
    },
  };
}
