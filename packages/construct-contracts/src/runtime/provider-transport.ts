import { z } from 'zod';

// Spec 00 §2.3 and §4.1: what every provider adapter needs from its
// transport, held here once so the read path (Spec 02) and the write path
// (Spec 03) share it without importing each other. Added in Spec 03 WE4 as a
// Spec 00 change; it imports nothing that pulls CDK into a bundle.

export type BoundedBody =
  { readonly outcome: 'read'; readonly bytes: Uint8Array } | { readonly outcome: 'too-large' };

// Lets the connection go back to the pool; failing to cancel is harmless.
export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing of the body is needed.
  }
}

// Datum 0.10: the bound is enforced while the body arrives. A declared length
// over it is refused unread; otherwise reading stops at the first chunk that
// would cross it, and the rest is cancelled unread.
export async function readResponseBodyWithinBound(
  response: Response,
  maximumBytes: number,
): Promise<BoundedBody> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    await discardResponseBody(response);
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

// Spec 00 §2.3: a provider's API key is read once per execution environment.
// A failed read is not kept, so the next call tries again.
export function createCachedApiKeyReader(readApiKey: () => Promise<string>): () => Promise<string> {
  let apiKeyRead: Promise<string> | undefined;
  return () => {
    apiKeyRead ??= readApiKey().catch((readFailure: unknown) => {
      apiKeyRead = undefined;
      throw readFailure;
    });
    return apiKeyRead;
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

export type ProviderEndpoint = z.infer<typeof ProviderEndpointSchema>;

export function parseProviderEndpoint(endpoint: {
  baseUrl: string | undefined;
  secretArn: string | undefined;
}): ProviderEndpoint {
  return ProviderEndpointSchema.parse(endpoint);
}
