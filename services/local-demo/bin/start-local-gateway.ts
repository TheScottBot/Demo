// Starts the gateway stand-in on its own port, in front of the read and write
// services on theirs. `npm run start:gateway --workspace services/local-demo`.
import nodeProcess, { stdout } from 'node:process';
import { defaultLocalDemoPorts, localGatewayUpstreams } from '../src/local-demo';
import { startLocalGateway } from '../src/local-gateway';

const serviceUrl = (port: number) => `http://127.0.0.1:${String(port)}`;

const gateway = await startLocalGateway({
  port: defaultLocalDemoPorts.gateway,
  upstreams: localGatewayUpstreams(
    serviceUrl(defaultLocalDemoPorts.readService),
    serviceUrl(defaultLocalDemoPorts.writeService),
  ),
  // One line per request: no token and no subject (Spec 01 §5.4).
  log: (logLine) => stdout.write(`${JSON.stringify({ message: 'request', ...logLine })}\n`),
});
stdout.write(`${JSON.stringify({ message: 'gateway-listening', baseUrl: gateway.baseUrl })}\n`);

nodeProcess.once('SIGINT', () => {
  void gateway.stop();
});
