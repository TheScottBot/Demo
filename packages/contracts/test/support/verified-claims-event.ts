import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { syntheticTenantIdentifier } from './synthetic-values';

// A minimal payload format 2.0 event (CU3) for this package's own tests.
// CE2's event builder in packages/test-doubles is the shared one for every
// other stream; its suite proves its output passes this package's parsing.

export type JwtClaims =
  APIGatewayProxyEventV2WithJWTAuthorizer['requestContext']['authorizer']['jwt']['claims'];

export interface VerifiedClaimsEventOptions {
  claims?: JwtClaims;
  headers?: Record<string, string>;
  body?: string;
}

export function defaultVerifiedClaims(): JwtClaims {
  return {
    sub: 'synthetic-subject-0001',
    tenant_id: syntheticTenantIdentifier,
    scope: 'records:read records:write',
  };
}

export function verifiedClaimsEvent(
  options: VerifiedClaimsEventOptions = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /v1/records/{recordId}',
    rawPath: '/v1/records/record-0001',
    rawQueryString: '',
    headers: options.headers ?? {},
    isBase64Encoded: false,
    ...(options.body === undefined ? {} : { body: options.body }),
    requestContext: {
      accountId: '000000000000',
      apiId: 'synthetic-api',
      domainName: 'synthetic.example.test',
      domainPrefix: 'synthetic',
      http: {
        method: 'GET',
        path: '/v1/records/record-0001',
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'synthetic-agent',
      },
      requestId: 'synthetic-request',
      routeKey: 'GET /v1/records/{recordId}',
      stage: '$default',
      time: '18/Oct/2026:09:30:00 +0000',
      timeEpoch: 1_792_316_200_000,
      authorizer: {
        principalId: '',
        integrationLatency: 0,
        jwt: { claims: options.claims ?? defaultVerifiedClaims(), scopes: null },
      },
    },
  };
}

export const syntheticLambdaContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'demo-dev-synthetic',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:eu-west-2:000000000000:function:demo-dev-synthetic',
  memoryLimitInMB: '256',
  awsRequestId: 'synthetic-aws-request',
  logGroupName: '/aws/lambda/demo-dev-synthetic',
  logStreamName: 'synthetic-stream',
  getRemainingTimeInMillis: () => 5_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};
