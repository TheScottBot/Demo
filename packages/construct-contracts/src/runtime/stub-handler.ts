import {
  DemoError,
  errorCodeDefinitions,
  PublicRouteNameSchema,
  headerValues,
  httpHeaders,
  problemDocumentFor,
  readAuthenticationContext,
  readRequestHeader,
  withHttpProblemHandling,
  type DemoHttpHandler,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
  type PublicRouteName,
} from '@demo/contracts';
import { z } from 'zod';
import type { DemoStage } from '../construct-properties';

// Spec 00 CE5: the stub functions standing in for Specs 02 and 03, so Spec 01
// can be built and checked against a real integration. Every stub answers 501
// not-implemented.

const echoedHeaders = [
  httpHeaders.ifNoneMatch,
  httpHeaders.idempotencyKey,
  httpHeaders.correlationIdentifier,
];

// Spec 00 §2.3: configuration only from the environment, validated at cold
// start; a missing or invalid variable fails the cold start.
const StubEnvironmentSchema = z.strictObject({
  DEMO_STAGE: z.enum(['dev', 'stub', 'test', 'demo']),
  DEMO_STUB_ROUTE: PublicRouteNameSchema,
});

export function parseStubConfiguration(environment: Readonly<Record<string, string | undefined>>): {
  stage: DemoStage;
  routeName: PublicRouteName;
} {
  // Only the stub's own variables are checked strictly; the runtime sets many
  // others (AWS_REGION and the like) that are none of its business.
  const stubEnvironment = StubEnvironmentSchema.parse({
    DEMO_STAGE: environment['DEMO_STAGE'],
    DEMO_STUB_ROUTE: environment['DEMO_STUB_ROUTE'],
  });
  return { stage: stubEnvironment.DEMO_STAGE, routeName: stubEnvironment.DEMO_STUB_ROUTE };
}

export interface StubHandlerOptions {
  stage: DemoStage;
  routeName: PublicRouteName;
  log: ProblemHandlingLog;
  metrics: ProblemHandlingMetrics;
  // Puts the tenant on every later log line (§5.1).
  bindTenant?: (tenantId: string) => void;
}

export function createStubHandler(options: StubHandlerOptions): DemoHttpHandler {
  return withHttpProblemHandling(
    (event, _lambdaContext, requestScope) => {
      options.bindTenant?.(readAuthenticationContext(event).tenantId);
      const notImplemented = new DemoError('not-implemented', 'stub-function');
      const notImplementedStatus = errorCodeDefinitions[notImplemented.errorCode].status;
      options.log.recordRejection({
        errorCode: notImplemented.errorCode,
        status: notImplementedStatus,
        reasonCategory: notImplemented.reasonCategory,
      });
      const responseHeaders: Record<string, string> = {
        [httpHeaders.contentType.wireName]: headerValues.problemMediaType,
        [httpHeaders.cacheControl.wireName]: headerValues.noStore,
      };
      // In the stub stage only, the request headers EE4 checks are echoed back,
      // so it can see they reached a handler unchanged. These are request
      // values sent back to the caller who sent them, never logged.
      if (options.stage === 'stub') {
        responseHeaders[httpHeaders.stubEcho.wireName] = JSON.stringify(
          Object.fromEntries(
            echoedHeaders.map((headerDefinition) => [
              headerDefinition.wireName,
              readRequestHeader(event.headers, headerDefinition) ?? null,
            ]),
          ),
        );
      }
      return Promise.resolve({
        statusCode: notImplementedStatus,
        headers: responseHeaders,
        body: JSON.stringify(problemDocumentFor(notImplemented, requestScope.correlationId)),
      });
    },
    { log: options.log, metrics: options.metrics },
  );
}
