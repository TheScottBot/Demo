import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpHeaders, type DemoHttpHandler } from '@demo/contracts';
import { buildLambdaContext } from '@demo/test-doubles';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

// The local stand-in for Lambda: `POST /invoke/<function>` with a payload
// format 2.0 event as the body answers with what the handler returned. Each
// path's functions run behind their own server, in their own process, so the
// boundaries between the gateway, the read path and the write path stay as
// deployed: they talk only over HTTP.

export interface LocalServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

// Far above any event the gateway stand-in passes (it refuses bodies over
// 1 MiB), so a function server never holds an unbounded request.
const maximumEventBytes = 2 * 1_048_576;

export function readRequestBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let refused = false;
    request.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes) {
        refused = true;
        chunks.length = 0;
        return;
      }
      if (!refused) {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      resolve(refused ? 'too-large' : Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

export function answerJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { [httpHeaders.contentType.wireName]: 'application/json' });
  response.end(JSON.stringify(body));
}

export function listenOn(
  server: ReturnType<typeof createServer>,
  port: number,
): Promise<LocalServer> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: boundPort } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${String(boundPort)}`,
        stop: () =>
          new Promise((stopped) => {
            server.closeAllConnections();
            server.close(() => {
              stopped();
            });
          }),
      });
    });
  });
}

export function startLocalFunctionServer(options: {
  port: number;
  functions: Readonly<Record<string, DemoHttpHandler>>;
}): Promise<LocalServer> {
  const server = createServer((request, response) => {
    void (async () => {
      const functionName = /^\/invoke\/([a-z-]+)$/.exec(request.url ?? '')?.[1];
      const handler = functionName === undefined ? undefined : options.functions[functionName];
      if (handler === undefined) {
        answerJson(response, 404, { errorType: 'FunctionNotFound' });
        return;
      }
      if (request.method !== 'POST') {
        answerJson(response, 405, { errorType: 'MethodNotAllowed' });
        return;
      }
      const body = await readRequestBody(request, maximumEventBytes);
      if (body === 'too-large') {
        answerJson(response, 413, { errorType: 'EventTooLarge' });
        return;
      }
      let event: APIGatewayProxyEventV2WithJWTAuthorizer;
      try {
        event = JSON.parse(body.toString('utf8')) as APIGatewayProxyEventV2WithJWTAuthorizer;
      } catch {
        answerJson(response, 400, { errorType: 'EventNotJson' });
        return;
      }
      try {
        answerJson(response, 200, await handler(event, buildLambdaContext()));
      } catch {
        // As Lambda reports a function that threw: the cause stays in the
        // function's own logs, never in the answer.
        answerJson(response, 502, { errorType: 'FunctionFailed' });
      }
    })();
  });
  return listenOn(server, options.port);
}
