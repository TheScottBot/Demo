import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { ulid } from 'ulid';
import { DemoError, errorCodeDefinitions, problemDocumentFor, type ErrorCode } from './errors';
import { CorrelationIdentifierSchema } from './grammars';
import { headerValues, httpHeaders, readRequestHeader } from './headers';

// Spec 00 §3.11: the signature of all three handlers (CU3).
export type DemoHttpHandler = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  lambdaContext: Context,
) => Promise<APIGatewayProxyStructuredResultV2>;

export interface RequestScope {
  readonly correlationId: string;
}

export type DemoRequestHandler = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  lambdaContext: Context,
  requestScope: RequestScope,
) => Promise<APIGatewayProxyStructuredResultV2>;

// CQ3, decided 18 October 2026: this package is pure (Spec 00 §2.4 check 2)
// and cannot import Powertools, so the wrapper is given these two narrow
// interfaces and each service satisfies them with its own Logger and Metrics.
// Neither takes a free text message, so no caller can route an input value
// into a log line through them.
export interface ProblemHandlingLog {
  bindRequestKeys(requestKeys: { correlationId: string }): void;
  clearRequestKeys(): void;
  recordRejection(rejection: {
    errorCode: ErrorCode;
    status: number;
    reasonCategory: string;
  }): void;
  recordInternalFailure(failure: { errorName: string }): void;
}

export interface ProblemHandlingMetrics {
  // The metric RequestRejected, dimension errorCode (Spec 00 §3.6).
  countRequestRejected(errorCode: ErrorCode): void;
}

export interface ProblemHandlingDependencies {
  log: ProblemHandlingLog;
  metrics: ProblemHandlingMetrics;
  // Injected so tests are deterministic; every platform identifier is a ULID
  // (Spec 00 §2.3).
  mintCorrelationIdentifier?: () => string;
}

type CorrelationResolution =
  | { readonly outcome: 'resolved'; readonly correlationId: string }
  | { readonly outcome: 'refused'; readonly correlationId: string };

function resolveCorrelationIdentifier(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  mintCorrelationIdentifier: () => string,
): CorrelationResolution {
  const requestedIdentifier = readRequestHeader(event.headers, httpHeaders.correlationIdentifier);
  if (requestedIdentifier === undefined) {
    return { outcome: 'resolved', correlationId: mintCorrelationIdentifier() };
  }
  // A refused identifier is never echoed: it is input, and may be anything.
  return CorrelationIdentifierSchema.safeParse(requestedIdentifier).success
    ? { outcome: 'resolved', correlationId: requestedIdentifier }
    : { outcome: 'refused', correlationId: mintCorrelationIdentifier() };
}

function problemResponse(
  demoError: DemoError,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 {
  const problemDocument = problemDocumentFor(demoError, correlationId);
  return {
    statusCode: problemDocument.status,
    headers: {
      [httpHeaders.contentType.wireName]: headerValues.problemMediaType,
      [httpHeaders.correlationIdentifier.wireName]: correlationId,
      // An error answers one request at one moment; caching it would replay a
      // refusal to a later request it may not apply to. Decided for all three
      // routes by the author on 18 October 2026.
      [httpHeaders.cacheControl.wireName]: headerValues.noStore,
      ...(demoError.retryAfterSeconds === undefined
        ? {}
        : { [httpHeaders.retryAfter.wireName]: String(demoError.retryAfterSeconds) }),
    },
    body: JSON.stringify(problemDocument),
  };
}

function isClientError(errorCode: ErrorCode): boolean {
  const status = errorCodeDefinitions[errorCode].status;
  return status >= 400 && status < 500;
}

export function withHttpProblemHandling(
  requestHandler: DemoRequestHandler,
  dependencies: ProblemHandlingDependencies,
): DemoHttpHandler {
  const { log, metrics } = dependencies;
  const mintCorrelationIdentifier = dependencies.mintCorrelationIdentifier ?? (() => ulid());

  function answerWithProblem(
    demoError: DemoError,
    correlationId: string,
  ): APIGatewayProxyStructuredResultV2 {
    const status = errorCodeDefinitions[demoError.errorCode].status;
    log.recordRejection({
      errorCode: demoError.errorCode,
      status,
      reasonCategory: demoError.reasonCategory,
    });
    if (isClientError(demoError.errorCode)) {
      metrics.countRequestRejected(demoError.errorCode);
    }
    return problemResponse(demoError, correlationId);
  }

  return async (event, lambdaContext) => {
    const correlation = resolveCorrelationIdentifier(event, mintCorrelationIdentifier);
    log.bindRequestKeys({ correlationId: correlation.correlationId });
    try {
      if (correlation.outcome === 'refused') {
        return answerWithProblem(
          new DemoError('validation-failed', 'correlation-identifier-invalid', {
            invalidFields: [
              { path: `headers.${httpHeaders.correlationIdentifier.wireName}`, reason: 'grammar' },
            ],
          }),
          correlation.correlationId,
        );
      }
      const handlerResult = await requestHandler(event, lambdaContext, {
        correlationId: correlation.correlationId,
      });
      return {
        ...handlerResult,
        headers: {
          ...handlerResult.headers,
          [httpHeaders.correlationIdentifier.wireName]: correlation.correlationId,
        },
      };
    } catch (thrown) {
      if (thrown instanceof DemoError) {
        return answerWithProblem(thrown, correlation.correlationId);
      }
      // Only the error's class name is logged. Its message may quote the input
      // that caused it, so it goes nowhere.
      log.recordInternalFailure({
        errorName: thrown instanceof Error ? thrown.name : 'non-error-thrown',
      });
      return problemResponse(
        new DemoError('internal', 'unexpected-failure'),
        correlation.correlationId,
      );
    } finally {
      log.clearRequestKeys();
    }
  };
}
