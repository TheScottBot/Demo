import type { PublicRoute } from '@demo/contracts';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';

// Spec 00 §4.3: the payload format 2.0 event builder Specs 02 and 03 use to
// invoke their handlers directly, as the gateway would after verifying a
// token (CU3). It is the shared builder; no stream builds its own.

export type JwtClaims =
  APIGatewayProxyEventV2WithJWTAuthorizer['requestContext']['authorizer']['jwt']['claims'];

export interface ClaimOptions {
  subject?: string;
  tenantId?: string;
  // A string as Cognito issues it, or a list, since CU4 leaves the gateway's
  // rendering unsettled and handlers read both.
  scope?: string | string[];
}

export interface VerifiedClaimsEventOptions {
  route: PublicRoute;
  pathParameters?: Readonly<Record<string, string>>;
  // Name and value pairs, so a test can send the same header twice.
  headers?: readonly (readonly [headerName: string, headerValue: string])[];
  body?: string;
  isBase64Encoded?: boolean;
  claims?: ClaimOptions;
  // Replaces the claims outright, for tests of missing or hostile claims.
  rawClaims?: JwtClaims;
}

function claimsFrom(claimOptions: ClaimOptions = {}): JwtClaims {
  return {
    sub: claimOptions.subject ?? 'synthetic-subject-0001',
    tenant_id: claimOptions.tenantId ?? 'tenant-1',
    scope: claimOptions.scope ?? 'records:read records:write',
  };
}

// CU3: header names arrive lower cased, and duplicates arrive joined by commas.
function payloadFormatHeaders(
  headerPairs: VerifiedClaimsEventOptions['headers'] = [],
): Record<string, string> {
  const deliveredHeaders: Record<string, string> = {};
  for (const [headerName, headerValue] of headerPairs) {
    const lookupKey = headerName.toLowerCase();
    const earlierValue = deliveredHeaders[lookupKey];
    deliveredHeaders[lookupKey] =
      earlierValue === undefined ? headerValue : `${earlierValue},${headerValue}`;
  }
  return deliveredHeaders;
}

function routePathParameters(
  publicRoute: PublicRoute,
  suppliedParameters: Readonly<Record<string, string>> = {},
): { rawPath: string; pathParameters: Record<string, string> | undefined } {
  const pathParameters: Record<string, string> = {};
  const rawPath = publicRoute.path.replace(
    /\{([A-Za-z]+)\}/g,
    (_placeholder, parameterName: string) => {
      const parameterValue = suppliedParameters[parameterName];
      if (parameterValue === undefined) {
        throw new Error(`path-parameter-missing: ${parameterName}`);
      }
      pathParameters[parameterName] = parameterValue;
      return parameterValue;
    },
  );
  return {
    rawPath,
    pathParameters: Object.keys(pathParameters).length === 0 ? undefined : pathParameters,
  };
}

export function buildVerifiedClaimsEvent(
  options: VerifiedClaimsEventOptions,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const routeKey = `${options.route.method} ${options.route.path}`;
  const { rawPath, pathParameters } = routePathParameters(options.route, options.pathParameters);
  return {
    version: '2.0',
    routeKey,
    rawPath,
    rawQueryString: '',
    headers: payloadFormatHeaders(options.headers),
    isBase64Encoded: options.isBase64Encoded ?? false,
    ...(pathParameters === undefined ? {} : { pathParameters }),
    ...(options.body === undefined ? {} : { body: options.body }),
    requestContext: {
      accountId: '000000000000',
      apiId: 'synthetic-api',
      domainName: 'synthetic.example.test',
      domainPrefix: 'synthetic',
      http: {
        method: options.route.method,
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'synthetic-agent',
      },
      requestId: 'synthetic-request',
      routeKey,
      stage: '$default',
      time: '18/Oct/2026:09:30:00 +0000',
      timeEpoch: 1_792_316_200_000,
      authorizer: {
        principalId: '',
        integrationLatency: 0,
        jwt: { claims: options.rawClaims ?? claimsFrom(options.claims), scopes: null },
      },
    },
  };
}

export function buildLambdaContext(options: { remainingMilliseconds?: number } = {}): Context {
  const remainingMilliseconds = options.remainingMilliseconds ?? 5_000;
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'demo-dev-synthetic',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:eu-west-2:000000000000:function:demo-dev-synthetic',
    memoryLimitInMB: '256',
    awsRequestId: 'synthetic-aws-request',
    logGroupName: '/aws/lambda/demo-dev-synthetic',
    logStreamName: 'synthetic-stream',
    getRemainingTimeInMillis: () => remainingMilliseconds,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}
