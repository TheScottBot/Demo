import {
  CorrelationIdentifierSchema,
  TenantIdentifierSchema,
  httpHeaders,
  readRequestHeader,
  type ProviderIdentifier,
} from '@demo/contracts';
import {
  simulateProviderRequest,
  type ProviderSimulationStore,
} from '@demo/test-doubles/provider-simulation';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// One mock provider's Lambda handler (Spec 00 §4.3). It is transport only:
// every answer comes from simulateProviderRequest, the same function the msw
// doubles wrap. The local servers (CQ6) run this same handler.

export interface MockProviderRequestLog {
  // No body, no API key, and only header values that pass their grammar.
  recordRequest(requestLine: {
    providerId: ProviderIdentifier;
    method: string;
    status: number;
    tenantId?: string;
    correlationId?: string;
  }): void;
}

export interface MockProviderHandlerOptions {
  providerId: ProviderIdentifier;
  readApiKey: () => Promise<string>;
  store: ProviderSimulationStore;
  now: () => Date;
  mintUlid: () => string;
  sleep: (milliseconds: number) => Promise<void>;
  log: MockProviderRequestLog;
}

export type MockProviderHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

export function createMockProviderHandler(
  options: MockProviderHandlerOptions,
): MockProviderHandler {
  // Spec 00 §2.3: the credential is read once per execution environment. A
  // failed read is not kept, so the next request tries again.
  let apiKeyRead: Promise<string> | undefined;
  const apiKey = (): Promise<string> => {
    apiKeyRead ??= options.readApiKey().catch((readFailure: unknown) => {
      apiKeyRead = undefined;
      throw readFailure;
    });
    return apiKeyRead;
  };

  return async (event) => {
    const bodyText =
      event.body === undefined
        ? undefined
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;
    const simulatedResponse = await simulateProviderRequest(
      {
        method: event.requestContext.http.method,
        path: event.rawPath,
        headers: event.headers,
        bodyText,
      },
      {
        providerId: options.providerId,
        apiKey: await apiKey(),
        store: options.store,
        now: options.now,
        mintUlid: options.mintUlid,
      },
    );
    if (simulatedResponse.delayMilliseconds > 0) {
      await options.sleep(simulatedResponse.delayMilliseconds);
    }
    const tenantHeader = TenantIdentifierSchema.safeParse(
      readRequestHeader(event.headers, httpHeaders.providerTenant),
    );
    const correlationHeader = CorrelationIdentifierSchema.safeParse(
      readRequestHeader(event.headers, httpHeaders.correlationIdentifier),
    );
    options.log.recordRequest({
      providerId: options.providerId,
      method: event.requestContext.http.method,
      status: simulatedResponse.status,
      ...(tenantHeader.success ? { tenantId: tenantHeader.data } : {}),
      ...(correlationHeader.success ? { correlationId: correlationHeader.data } : {}),
    });
    return {
      statusCode: simulatedResponse.status,
      headers: { ...simulatedResponse.headers },
      ...(simulatedResponse.bodyText === undefined ? {} : { body: simulatedResponse.bodyText }),
    };
  };
}
