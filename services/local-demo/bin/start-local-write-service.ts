// Starts the write path's local server on its own port, its worker calling
// the mock providers on theirs. `npm run start:write --workspace
// services/local-demo`.
import nodeProcess, { stdout } from 'node:process';
import {
  defaultLocalDemoPorts,
  defaultPumpIntervalMilliseconds,
  localProviderAddresses,
} from '../src/local-demo';
import { startLocalWriteService } from '../src/local-write-service';

const writeService = await startLocalWriteService({
  port: defaultLocalDemoPorts.writeService,
  providers: localProviderAddresses(defaultLocalDemoPorts.providers),
  pumpIntervalMilliseconds: defaultPumpIntervalMilliseconds,
  onPumpFailure: () => {
    stdout.write(`${JSON.stringify({ message: 'write-pump-failed' })}\n`);
  },
});
stdout.write(
  `${JSON.stringify({ message: 'write-service-listening', baseUrl: writeService.baseUrl })}\n`,
);

nodeProcess.once('SIGINT', () => {
  void writeService.stop();
});
