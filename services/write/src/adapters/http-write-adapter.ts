import {
  commandTypes,
  contractBounds,
  formatEntityTag,
  headerValues,
  httpHeaders,
  isProviderContractVersionSupported,
  parseEntityTag,
  parseProviderWriteResponseBody,
  parseRetryAfterSeconds,
  providerWireStatuses,
  type ApplyOutcome,
  type CommandRequest,
  type ProviderIdentifier,
  type WriteAdapter,
} from '@demo/contracts';
import {
  createCachedApiKeyReader,
  discardResponseBody,
  readResponseBodyWithinBound,
} from '@demo/construct-contracts/runtime';

// Spec 03 §6.5: one adapter holds the transport and the mapping; each provider
// file sets only its providerId, base URL variable and secret.
//
// Every provider answer is untrusted (Spec 00 §4.1) and maps to an outcome;
// the adapter never throws, not even on an abort, because the worker acts on
// outcomes alone (§6.3) and an abort is retryable like any other transport
// failure. Every attempt carries the same Idempotency-Key and If-Match, so a
// repeat can neither apply twice nor overwrite newer data.

// Spec 03 §11 counts outcomes by reason at the worker; this is the one thing
// the adapter counts itself, since an ignored header leaves no outcome reason.
export interface WriteAdapterMetrics {
  countRetryAfterIgnored(providerId: ProviderIdentifier): void;
}

export interface HttpWriteAdapterOptions {
  providerId: ProviderIdentifier;
  baseUrl: string;
  readApiKey: () => Promise<string>;
  metrics: WriteAdapterMetrics;
  // The runtime's fetch unless a test supplies a response no double can.
  fetchImplementation?: typeof fetch;
}

// §6.5 maps 409 to conflict, though no provider in this family sends it
// (CQ7 chose 412 for a stale If-Match), so it has no row in the wire table.
const conflictStatus = 409;

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function retryable(reason: string, retryAfterMilliseconds?: number): ApplyOutcome {
  return retryAfterMilliseconds === undefined
    ? { kind: 'retryable', reason }
    : { kind: 'retryable', reason, retryAfterMilliseconds };
}

function commandPath(command: CommandRequest): { method: 'PUT' | 'POST'; path: string } {
  const recordPath = `/records/${encodeURIComponent(command.recordId)}/sections`;
  return command.type === commandTypes.notesAppend
    ? { method: 'POST', path: `${recordPath}/notes/entries` }
    : { method: 'PUT', path: `${recordPath}/${encodeURIComponent(command.section)}` };
}

export function createHttpWriteAdapter(options: HttpWriteAdapterOptions): WriteAdapter {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const apiKey = createCachedApiKeyReader(options.readApiKey);

  // A Retry-After is honoured only within the §3.3 bound; beyond it, or
  // malformed, it is ignored and counted, and the worker's own backoff
  // applies (§6.4).
  function retryAfterFrom(response: Response): number | undefined {
    const retryAfter = parseRetryAfterSeconds(
      response.headers.get(httpHeaders.retryAfter.wireName) ?? undefined,
    );
    if (retryAfter.outcome === 'invalid') {
      options.metrics.countRetryAfterIgnored(options.providerId);
      return undefined;
    }
    return retryAfter.outcome === 'valid' ? retryAfter.seconds * 1_000 : undefined;
  }

  async function mapApplied(response: Response, command: CommandRequest): Promise<ApplyOutcome> {
    // Spec 00 §4.1: the contract version first, then the headers, then the
    // bounded body; a 2xx that fails any of them is not trusted as applied.
    if (
      !isProviderContractVersionSupported(
        response.headers.get(httpHeaders.providerContract.wireName) ?? undefined,
      )
    ) {
      await discardResponseBody(response);
      return retryable('version-mismatch');
    }
    const entityTag = parseEntityTag(
      response.headers.get(httpHeaders.entityTag.wireName) ?? undefined,
    );
    if (entityTag.outcome !== 'valid') {
      await discardResponseBody(response);
      return retryable('header-invalid');
    }
    const boundedBody = await readResponseBodyWithinBound(
      response,
      contractBounds.providerResponseBodyMaximumBytes,
    );
    if (boundedBody.outcome === 'too-large') {
      return retryable('body-too-large');
    }
    let bodyText: string;
    try {
      bodyText = strictUtf8Decoder.decode(boundedBody.bytes);
    } catch {
      return retryable('schema-invalid');
    }
    const parsedBody = parseProviderWriteResponseBody(bodyText);
    if (parsedBody.outcome === 'rejected') {
      return retryable(parsedBody.errorReason);
    }
    // An answer about another record or section is as wrong as a malformed one.
    if (
      parsedBody.body.recordId !== command.recordId ||
      parsedBody.body.section !== command.section
    ) {
      return retryable('schema-invalid');
    }
    return { kind: 'applied', providerVersion: entityTag.version };
  }

  async function mapResponse(response: Response, command: CommandRequest): Promise<ApplyOutcome> {
    const { status } = response;
    if (
      status === providerWireStatuses.replaceApplied ||
      status === providerWireStatuses.appendApplied
    ) {
      return mapApplied(response, command);
    }
    await discardResponseBody(response);
    if (status === providerWireStatuses.preconditionFailed || status === conflictStatus) {
      const currentVersion = parseEntityTag(
        response.headers.get(httpHeaders.entityTag.wireName) ?? undefined,
      );
      return {
        kind: 'conflict',
        reason: status === conflictStatus ? 'provider-conflict' : 'precondition-failed',
        ...(currentVersion.outcome === 'valid' ? { currentVersion: currentVersion.version } : {}),
      };
    }
    switch (status) {
      case providerWireStatuses.requestInvalid:
        return { kind: 'rejected', code: 'provider-request-invalid', reason: 'request-invalid' };
      case providerWireStatuses.notHeld:
        return { kind: 'rejected', code: 'provider-not-held', reason: 'not-held' };
      case providerWireStatuses.idempotencyKeyReused:
        return {
          kind: 'rejected',
          code: 'provider-idempotency-key-reused',
          reason: 'idempotency-key-reused',
        };
      case providerWireStatuses.throttled:
        return retryable('throttled', retryAfterFrom(response));
      case providerWireStatuses.unavailable:
        return retryable('unavailable', retryAfterFrom(response));
      // WQ3: a fault on the platform's side, not the client's, so the
      // command is kept for a person rather than failed.
      case providerWireStatuses.apiKeyRefused:
        return retryable('api-key-refused');
      case providerWireStatuses.ifMatchRequired:
        return retryable('if-match-required');
      default:
        return status >= 500 && status <= 599
          ? retryable('server-error', retryAfterFrom(response))
          : retryable('unexpected-status');
    }
  }

  return {
    providerId: options.providerId,
    apply: async (applyRequest, callOptions) => {
      const { command } = applyRequest;
      const { method, path } = commandPath(command);
      let providerApiKey: string;
      try {
        providerApiKey = await apiKey();
      } catch {
        // The platform's own fault, kept apart from the provider's answers.
        return retryable('api-key-unavailable');
      }
      try {
        const response = await fetchImplementation(`${options.baseUrl}${path}`, {
          method,
          headers: {
            [httpHeaders.contentType.wireName]: headerValues.jsonMediaType,
            [httpHeaders.ifMatch.wireName]: formatEntityTag(command.baseVersion),
            [httpHeaders.idempotencyKey.wireName]: applyRequest.idempotencyKey,
            [httpHeaders.providerApiKey.wireName]: providerApiKey,
            // CQ7.1: one API key serves every tenant, so the tenant travels too.
            [httpHeaders.providerTenant.wireName]: applyRequest.tenantId,
            [httpHeaders.correlationIdentifier.wireName]: callOptions.correlationId,
          },
          // Spec 00 §4.4: the section shape, or NotesAppendPayload, itself.
          body: JSON.stringify(command.payload),
          signal: callOptions.abortSignal,
        });
        return await mapResponse(response, command);
      } catch {
        // While connecting or while the body arrives.
        return retryable(callOptions.abortSignal.aborted ? 'aborted' : 'transport');
      }
    },
  };
}
