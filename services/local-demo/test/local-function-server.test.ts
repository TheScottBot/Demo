// The local stand-in for Lambda: a function server that takes a payload
// format 2.0 event over HTTP and answers with what the handler returned.
import type { DemoHttpHandler } from '@demo/contracts';
import { buildVerifiedClaimsEvent, publicRouteNamed } from '@demo/test-doubles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalFunctionServer, type LocalServer } from '../src/local-function-server';

const receivedEvents: unknown[] = [];

const answeringHandler: DemoHttpHandler = (event) => {
  receivedEvents.push(event);
  return Promise.resolve({
    statusCode: 201,
    headers: { 'X-Synthetic': 'yes' },
    body: '{"answered":true}',
  });
};

const failingHandler: DemoHttpHandler = () => Promise.reject(new Error('synthetic failure'));

let functionServer: LocalServer;

beforeAll(async () => {
  functionServer = await startLocalFunctionServer({
    port: 0,
    functions: { answering: answeringHandler, failing: failingHandler },
  });
});

afterAll(async () => {
  await functionServer.stop();
});

const syntheticEvent = buildVerifiedClaimsEvent({
  route: publicRouteNamed('read-record'),
  pathParameters: { recordId: 'record-0001' },
});

function invoke(functionName: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${functionServer.baseUrl}/invoke/${functionName}`, {
    method: 'POST',
    body: JSON.stringify(syntheticEvent),
    ...init,
  });
}

describe('the local function server', () => {
  it('hands the event to the named function and answers with its result', async () => {
    const response = await invoke('answering');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      statusCode: 201,
      headers: { 'X-Synthetic': 'yes' },
      body: '{"answered":true}',
    });
    expect(receivedEvents.at(-1)).toEqual(syntheticEvent);
  });

  it('answers 502 when the function throws, as Lambda reports a failed invocation', async () => {
    const response = await invoke('failing');
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ errorType: 'FunctionFailed' });
  });

  it('answers 404 for a function it does not hold', async () => {
    expect((await invoke('absent')).status).toBe(404);
  });

  it('answers 405 to anything but POST', async () => {
    const response = await fetch(`${functionServer.baseUrl}/invoke/answering`);
    expect(response.status).toBe(405);
  });

  it('answers 400 to a body that is not JSON', async () => {
    expect((await invoke('answering', { body: 'not json' })).status).toBe(400);
  });
});
