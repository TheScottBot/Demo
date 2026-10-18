import {
  contractBounds,
  formatEntityTag,
  httpHeaders,
  isProviderContractVersionSupported,
  parseCacheControlMaxAge,
  parseEntityTag,
  parseProviderReadResponseBody,
  type ProviderErrorReason,
  type ProviderIdentifier,
  type ProviderReadResult,
  type ReadAdapter,
} from '@demo/contracts';
import { z } from 'zod';
import { readPathSettings } from '../read-path-settings';

// Spec 02 §3.2: one adapter holds the transport and the mapping; each provider
// file sets only its providerId, base URL variable and secret.
//
// Every provider response is untrusted (Spec 00 §4.1): it is bounded, its
// version checked and its body validated, and every response maps to a
// result; the adapter never throws for one. It does throw when its abort
// signal fires, because the result type has no timeout outcome: the fan-out
// maps that rejection to `timeout` (§3.1).
//
// Connections are reused across invocations by the runtime's own fetch, with
// no agent configured (RU6, observed in the Spec 02 Plan stage).

export interface HttpReadAdapterOptions {
  providerId: ProviderIdentifier;
  baseUrl: string;
  readApiKey: () => Promise<string>;
  // The runtime's fetch unless a test supplies a response no double can.
  fetchImplementation?: typeof fetch;
}

function errorResult(errorReason: ProviderErrorReason): ProviderReadResult {
  return { outcome: 'error', errorReason, ttlSeconds: 0 };
}

// Lets the connection go back to the pool; failing to cancel is harmless.
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing of the body is needed.
  }
}

type BoundedBody =
  { readonly outcome: 'read'; readonly bytes: Uint8Array } | { readonly outcome: 'too-large' };

// Datum 0.10: the bound is enforced while the body arrives. Reading stops at
// the first chunk that would cross it, and the rest is cancelled unread.
async function readBodyWithinBound(response: Response, maximumBytes: number): Promise<BoundedBody> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    await discardBody(response);
    return { outcome: 'too-large' };
  }
  if (response.body === null) {
    return { outcome: 'read', bytes: new Uint8Array() };
  }
  // Node.js types a fetch body as a stream of unknown chunks; undici yields bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      return { outcome: 'too-large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { outcome: 'read', bytes };
}

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function ttlFrom(cacheControlValue: string | null): number | undefined {
  const maxAge = parseCacheControlMaxAge(cacheControlValue ?? undefined);
  if (maxAge.outcome === 'invalid') {
    return undefined;
  }
  return maxAge.outcome === 'absent'
    ? readPathSettings.defaultTtlSeconds
    : Math.min(maxAge.seconds, readPathSettings.maximumTtlSeconds);
}

async function mapResponse(
  response: Response,
  requestedRecordId: string,
): Promise<ProviderReadResult> {
  if (response.status === 404) {
    await discardBody(response);
    return { outcome: 'not-found', ttlSeconds: 0 };
  }
  if (response.status !== 200 && response.status !== 304) {
    await discardBody(response);
    return errorResult('http-status');
  }
  // §3.2: the contract version is checked before anything is parsed.
  if (
    !isProviderContractVersionSupported(
      response.headers.get(httpHeaders.providerContract.wireName) ?? undefined,
    )
  ) {
    await discardBody(response);
    return errorResult('version-mismatch');
  }
  const entityTag = parseEntityTag(
    response.headers.get(httpHeaders.entityTag.wireName) ?? undefined,
  );
  const ttlSeconds = ttlFrom(response.headers.get(httpHeaders.cacheControl.wireName));
  if (entityTag.outcome !== 'valid' || ttlSeconds === undefined) {
    await discardBody(response);
    return errorResult('header-invalid');
  }
  if (response.status === 304) {
    await discardBody(response);
    return { outcome: 'not-modified', version: entityTag.version, ttlSeconds };
  }
  const boundedBody = await readBodyWithinBound(
    response,
    contractBounds.providerResponseBodyMaximumBytes,
  );
  if (boundedBody.outcome === 'too-large') {
    return errorResult('body-too-large');
  }
  let bodyText: string;
  try {
    bodyText = strictUtf8Decoder.decode(boundedBody.bytes);
  } catch {
    return errorResult('schema-invalid');
  }
  const parsedBody = parseProviderReadResponseBody(bodyText);
  if (parsedBody.outcome === 'rejected') {
    return errorResult(parsedBody.errorReason);
  }
  // A body about another record is as wrong as a malformed one.
  if (parsedBody.body.recordId !== requestedRecordId) {
    return errorResult('schema-invalid');
  }
  return {
    outcome: 'ok',
    version: entityTag.version,
    updatedAt: parsedBody.body.updatedAt,
    ttlSeconds,
    sections: parsedBody.body.sections,
  };
}

export function createHttpReadAdapter(options: HttpReadAdapterOptions): ReadAdapter {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  // Spec 00 §2.3: the credential is read once per execution environment; a
  // failed read is not kept, so the next call tries again.
  let apiKeyRead: Promise<string> | undefined;
  const apiKey = (): Promise<string> => {
    apiKeyRead ??= options.readApiKey().catch((readFailure: unknown) => {
      apiKeyRead = undefined;
      throw readFailure;
    });
    return apiKeyRead;
  };

  return {
    providerId: options.providerId,
    read: async (readRequest, callOptions) => {
      const requestHeaders = new Headers({
        [httpHeaders.providerApiKey.wireName]: await apiKey(),
        [httpHeaders.providerTenant.wireName]: readRequest.tenantId,
        [httpHeaders.correlationIdentifier.wireName]: callOptions.correlationId,
      });
      if (readRequest.ifNoneMatchVersion !== undefined) {
        requestHeaders.set(
          httpHeaders.ifNoneMatch.wireName,
          formatEntityTag(readRequest.ifNoneMatchVersion),
        );
      }
      const recordUrl = `${options.baseUrl}/records/${encodeURIComponent(readRequest.recordId)}`;
      try {
        const response = await fetchImplementation(recordUrl, {
          headers: requestHeaders,
          signal: callOptions.abortSignal,
        });
        return await mapResponse(response, readRequest.recordId);
      } catch {
        // An abort, while connecting or while the body arrives, is the
        // fan-out's to map; anything else that stopped the call is transport.
        if (callOptions.abortSignal.aborted) {
          throw callOptions.abortSignal.reason;
        }
        return errorResult('transport');
      }
    },
  };
}

// The environment one provider's adapter reads (Spec 00 §2.3): its base URL,
// https or the loopback address the local mock providers use (CQ6), and the
// ARN of its secret, never the secret itself.
const loopbackHttpUrl = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const ProviderEndpointSchema = z.strictObject({
  baseUrl: z
    .url()
    .refine((candidate) => candidate.startsWith('https://') || loopbackHttpUrl.test(candidate)),
  secretArn: z.string().startsWith('arn:aws:secretsmanager:'),
});

export interface ProviderReadAdapterSettings {
  readonly providerId: ProviderIdentifier;
  readonly baseUrlVariable: string;
  readonly secretArnVariable: string;
}

export function createConfiguredReadAdapter(
  settings: ProviderReadAdapterSettings,
  environment: Readonly<Record<string, string | undefined>>,
  readSecret: (secretArn: string) => Promise<string>,
): ReadAdapter {
  const endpoint = ProviderEndpointSchema.parse({
    baseUrl: environment[settings.baseUrlVariable],
    secretArn: environment[settings.secretArnVariable],
  });
  return createHttpReadAdapter({
    providerId: settings.providerId,
    baseUrl: endpoint.baseUrl,
    readApiKey: () => readSecret(endpoint.secretArn),
  });
}
