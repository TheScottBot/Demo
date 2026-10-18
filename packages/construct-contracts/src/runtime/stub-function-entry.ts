import { env as processEnvironment } from 'node:process';
import type { DemoHttpHandler } from '@demo/contracts';
import { createPowertoolsProblemHandling } from './powertools-problem-handling';
import { createStubHandler, parseStubConfiguration } from './stub-handler';

// The bundled entry point of every stub function. Configuration is read once,
// at cold start, and a bad environment fails here rather than per request.
const stubConfiguration = parseStubConfiguration(processEnvironment);

const observability = createPowertoolsProblemHandling({
  stage: stubConfiguration.stage,
  serviceName: 'stub',
  component: stubConfiguration.routeName,
});

const stubHandler = createStubHandler({
  ...stubConfiguration,
  log: observability.log,
  metrics: observability.metrics,
  bindTenant: (tenantId) => {
    observability.logger.appendKeys({ tenantId });
  },
});

export const handler: DemoHttpHandler = (event, lambdaContext) => {
  observability.logger.addContext(lambdaContext);
  observability.tracer.annotateColdStart();
  observability.tracer.addServiceNameAnnotation();
  return stubHandler(event, lambdaContext);
};
