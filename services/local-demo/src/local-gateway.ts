import { createServer } from 'node:http';
import { httpHeaders, publicRoutes, type PublicRoute } from '@demo/contracts';
import { buildVerifiedClaimsEvent } from '@demo/test-doubles';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { answerJson, listenOn, readRequestBody, type LocalServer } from './local-function-server';

// The local stand-in for the gateway: the one public API (Spec 01 §2), as far
// as a local process can play it.
//
// - Only the contract's three routes; anything else is the gateway's own 404
//   (EU3).
// - In place of JWT verification, a fixed table of demo tokens, each standing
//   for the claims a verified Cognito token would carry, with the scopes in
//   Cognito's resource server form (EQ6). A missing or unknown token is the
//   gateway's own 401 (ED3). No route scopes are checked here, so a missing
//   scope is the handler's to refuse (§4.1).
// - Each route's event goes, over HTTP, to the function server that holds
//   that route's function, as the integration would invoke it.
// - One access log line per request, holding no token and no subject (§5.4,
//   CD5).
//
// It does no CORS, throttling or alarms: those are configuration the CDK
// synth suites assert (EE3), and a browser client is no part of the demo.

export interface LocalDemoIdentity {
  readonly subject: string;
  readonly tenantId: string;
  readonly scope: string;
}

export const localDemoTokens: Readonly<Record<string, LocalDemoIdentity>> = {
  'local-tenant-1-reader': {
    subject: 'synthetic-subject-local-1',
    tenantId: 'tenant-1',
    scope: 'demo/records:read',
  },
  'local-tenant-1-writer': {
    subject: 'synthetic-subject-local-1',
    tenantId: 'tenant-1',
    scope: 'demo/records:read demo/records:write',
  },
  'local-tenant-2-writer': {
    subject: 'synthetic-subject-local-2',
    tenantId: 'tenant-2',
    scope: 'demo/records:read demo/records:write',
  },
};

export interface LocalGatewayLogLine {
  readonly method: string;
  readonly routeKey: string | null;
  readonly status: number;
  readonly latencyMilliseconds: number;
}

export interface LocalGatewayOptions {
  port: number;
  // Each route's function, as the function server's invoke address.
  upstreams: Readonly<Record<PublicRoute['handlerOwner'], string>>;
  log?: (logLine: LocalGatewayLogLine) => void;
}

// API Gateway's payload limit is far larger; 1 MiB keeps the demo bounded and
// is far above any command the contract allows.
const maximumBodyBytes = 1_048_576;

interface CompiledRoute {
  readonly publicRoute: PublicRoute;
  readonly pattern: RegExp;
  readonly parameterNames: readonly string[];
}

const compiledRoutes: readonly CompiledRoute[] = publicRoutes.map((publicRoute) => {
  const parameterNames: string[] = [];
  const pattern = publicRoute.path
    .split('/')
    .map((segment) => {
      const parameter = /^\{([A-Za-z]+)\}$/.exec(segment)?.[1];
      if (parameter === undefined) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      parameterNames.push(parameter);
      return '([^/]+)';
    })
    .join('/');
  return { publicRoute, pattern: new RegExp(`^${pattern}$`), parameterNames };
});

function matchRoute(
  method: string,
  path: string,
): { publicRoute: PublicRoute; pathParameters: Record<string, string> } | undefined {
  for (const { publicRoute, pattern, parameterNames } of compiledRoutes) {
    const match = publicRoute.method === method ? pattern.exec(path) : null;
    if (match !== null) {
      const pathParameters: Record<string, string> = {};
      parameterNames.forEach((parameterName, index) => {
        pathParameters[parameterName] = decodeURIComponent(match[index + 1] ?? '');
      });
      return { publicRoute, pathParameters };
    }
  }
  return undefined;
}

function identityFrom(authorization: string | undefined): LocalDemoIdentity | undefined {
  const token = /^Bearer ([A-Za-z0-9-]+)$/.exec(authorization ?? '')?.[1];
  return token === undefined ? undefined : localDemoTokens[token];
}

export function startLocalGateway(options: LocalGatewayOptions): Promise<LocalServer> {
  const server = createServer((request, response) => {
    const startedAt = performance.now();
    const method = request.method ?? 'GET';
    let routeKey: string | null = null;
    const finish = (status: number): void => {
      options.log?.({
        method,
        routeKey,
        status,
        latencyMilliseconds: Math.round(performance.now() - startedAt),
      });
    };
    void (async () => {
      const path = (request.url ?? '/').split('?')[0] ?? '/';
      const matched = matchRoute(method, path);
      if (matched === undefined) {
        answerJson(response, 404, { message: 'Not Found' });
        finish(404);
        return;
      }
      routeKey = `${matched.publicRoute.method} ${matched.publicRoute.path}`;
      const identity = identityFrom(request.headers.authorization);
      if (identity === undefined) {
        answerJson(response, 401, { message: 'Unauthorized' });
        finish(401);
        return;
      }
      const body = await readRequestBody(request, maximumBodyBytes);
      if (body === 'too-large') {
        answerJson(response, 413, { message: 'Request Entity Too Large' });
        finish(413);
        return;
      }
      const headerPairs: [string, string][] = [];
      for (let index = 0; index + 1 < request.rawHeaders.length; index += 2) {
        headerPairs.push([request.rawHeaders[index] ?? '', request.rawHeaders[index + 1] ?? '']);
      }
      const event = buildVerifiedClaimsEvent({
        route: matched.publicRoute,
        pathParameters: matched.pathParameters,
        headers: headerPairs,
        ...(body.length === 0 ? {} : { body: body.toString('utf8') }),
        claims: identity,
      });
      let result: APIGatewayProxyStructuredResultV2;
      try {
        const invoked = await fetch(options.upstreams[matched.publicRoute.handlerOwner], {
          method: 'POST',
          headers: { [httpHeaders.contentType.wireName]: 'application/json' },
          body: JSON.stringify(event),
        });
        if (invoked.status !== 200) {
          throw new Error('function-failed');
        }
        result = (await invoked.json()) as APIGatewayProxyStructuredResultV2;
      } catch {
        // As API Gateway answers an integration that failed.
        answerJson(response, 500, { message: 'Internal Server Error' });
        finish(500);
        return;
      }
      const statusCode = result.statusCode ?? 200;
      response.writeHead(statusCode, result.headers as Record<string, string> | undefined);
      response.end(
        result.body === undefined
          ? undefined
          : Buffer.from(result.body, result.isBase64Encoded === true ? 'base64' : 'utf8'),
      );
      finish(statusCode);
    })();
  });
  return listenOn(server, options.port);
}
