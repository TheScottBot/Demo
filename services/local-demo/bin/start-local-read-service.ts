// Starts the read path's local server on its own port, calling the mock
// providers on theirs. `npm run start:read --workspace services/local-demo`.
import nodeProcess, { stdout } from 'node:process';
import { defaultLocalDemoPorts, localProviderAddresses } from '../src/local-demo';
import { startLocalReadService } from '../src/local-read-service';

const readService = await startLocalReadService({
  port: defaultLocalDemoPorts.readService,
  providers: localProviderAddresses(defaultLocalDemoPorts.providers),
});
stdout.write(
  `${JSON.stringify({ message: 'read-service-listening', baseUrl: readService.baseUrl })}\n`,
);

nodeProcess.once('SIGINT', () => {
  void readService.stop();
});
