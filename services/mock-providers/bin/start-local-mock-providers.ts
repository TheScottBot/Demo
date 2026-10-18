// Starts the three mock providers on local ports (CQ6) and prints how to reach
// them. `npm start --workspace services/mock-providers`; stop with Ctrl+C.
import nodeProcess from 'node:process';
import { Logger } from '@aws-lambda-powertools/logger';
import { startLocalMockProviders } from '../src/index';

const logger = new Logger({ serviceName: 'mock-provider', persistentKeys: { stage: 'local' } });

const localProviders = await startLocalMockProviders({
  log: {
    recordRequest: (requestLine) => {
      logger.info('provider-request', requestLine);
    },
  },
});

// The API keys are never logged, synthetic or not (datum 0.15); each is
// syntheticProviderApiKey(providerId) from @demo/test-doubles.
for (const connection of localProviders.connections) {
  logger.info('mock-provider-listening', {
    providerId: connection.providerId,
    baseUrl: connection.baseUrl,
  });
}

nodeProcess.once('SIGINT', () => {
  void localProviders.stop().then(() => {
    logger.info('mock-providers-stopped');
  });
});
