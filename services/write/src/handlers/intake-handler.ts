import {
  DemoError,
  IdempotencyKeySchema,
  contractBounds,
  headerValues,
  httpHeaders,
  owningProviderForSection,
  parseCommandRequestBody,
  publicRouteNamed,
  readAuthenticationContext,
  readRequestHeader,
  requireScope,
  scopeNames,
  withHttpProblemHandling,
  type DemoHttpHandler,
  type InvalidField,
  type OperationStatus,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
  type ProviderIdentifier,
} from '@demo/contracts';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import type { JournalStore } from '../journal-store';
import { toOperationStatus } from '../operation-status-mapping';
import { computeRequestHash } from '../request-hash';

// Spec 03 §3: POST /v1/commands. Intake journals the command and answers 202;
// it never calls a provider (§3), so a provider outage never reaches the
// request path. Everything outside the process is injected.

export interface IntakeLog {
  // §11: operationId on every line once it is known.
  bindOperation(operationId: string): void;
}

// Spec 03 §11.
export interface IntakeMetrics {
  countCommandAccepted(providerId: ProviderIdentifier): void;
  countIdempotentReplay(): void;
  countIdempotencyKeyReused(): void;
}

export interface IntakeHandlerDependencies {
  readonly journalStore: Pick<JournalStore, 'createOperation' | 'readOperation'>;
  readonly problemLog: ProblemHandlingLog;
  readonly problemMetrics: ProblemHandlingMetrics;
  readonly intakeLog: IntakeLog;
  readonly intakeMetrics: IntakeMetrics;
  // A ULID (Spec 00 §2.3); injected so tests are deterministic.
  readonly mintOperationId: () => string;
}

// WQ4: base64 takes four characters for every three bytes, so encoded text
// longer than this cannot decode within the bound, and is refused before it
// is decoded. Derived from the contract's bound, so the bound is stated once.
const encodedBodyMaximumCharacters =
  4 * Math.ceil(contractBounds.commandRequestBodyMaximumBytes / 3);
// Whole groups of four, with padding only at the end: anything else is not a
// body any client encoded.
const strictBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// Spec 00 §3.4: JSON, and only UTF-8 if a charset is named, since the bound
// and every grammar are stated over UTF-8.
const jsonContentTypePattern = /^application\/json\s*(?:;\s*charset=utf-8\s*)?$/i;

function invalidBody(reason: InvalidField['reason']): DemoError {
  return new DemoError('validation-failed', `command-body-${reason}`, {
    invalidFields: [{ path: 'body', reason }],
  });
}

// §3.1 step 3: the body is bounded as received, before decoding or parsing.
function receivedBodyText(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const rawBody = event.body ?? '';
  if (!event.isBase64Encoded) {
    // parseCommandRequestBody holds plain text to the byte bound first.
    return rawBody;
  }
  if (rawBody.length > encodedBodyMaximumCharacters) {
    throw invalidBody('too-large');
  }
  if (!strictBase64Pattern.test(rawBody)) {
    throw invalidBody('grammar');
  }
  // At most 65,538 bytes, given the encoded bound. Holding the decoded bytes
  // to the bound is parseCommandRequestBody's, which every body goes through,
  // so it is not repeated here (datum 0.7).
  const decodedBytes = Buffer.from(rawBody, 'base64');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(decodedBytes);
  } catch {
    throw invalidBody('grammar');
  }
}

function checkedHeaders(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const contentType = readRequestHeader(event.headers, httpHeaders.contentType);
  if (contentType === undefined || !jsonContentTypePattern.test(contentType)) {
    throw new DemoError('validation-failed', 'content-type-not-json', {
      invalidFields: [
        { path: `headers.${httpHeaders.contentType.wireName}`, reason: 'not-allowed-value' },
      ],
    });
  }
  const idempotencyKey = readRequestHeader(event.headers, httpHeaders.idempotencyKey);
  const parsedKey = IdempotencyKeySchema.safeParse(idempotencyKey);
  if (!parsedKey.success) {
    throw new DemoError(
      'idempotency-key-required',
      idempotencyKey === undefined ? 'idempotency-key-missing' : 'idempotency-key-invalid',
    );
  }
  return parsedKey.data;
}

function operationLocation(operationId: string): string {
  return publicRouteNamed('read-operation').path.replace('{operationId}', operationId);
}

function acceptedResponse(
  operationStatus: OperationStatus,
  replayed: boolean,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 202,
    headers: {
      [httpHeaders.contentType.wireName]: headerValues.jsonMediaType,
      [httpHeaders.cacheControl.wireName]: headerValues.noStore,
      [httpHeaders.location.wireName]: operationLocation(operationStatus.operationId),
      ...(replayed
        ? { [httpHeaders.idempotentReplayed.wireName]: headerValues.idempotentReplayed }
        : {}),
    },
    body: JSON.stringify(operationStatus),
  };
}

export function createIntakeHandler(dependencies: IntakeHandlerDependencies): DemoHttpHandler {
  const { journalStore, intakeLog, intakeMetrics } = dependencies;
  return withHttpProblemHandling(
    async (event) => {
      // Step 1.
      const authenticationContext = readAuthenticationContext(event);
      requireScope(authenticationContext, scopeNames.recordsWrite);
      // Steps 2 to 4.
      const idempotencyKey = checkedHeaders(event);
      const parsedBody = parseCommandRequestBody(receivedBodyText(event));
      if (parsedBody.outcome === 'rejected') {
        if (parsedBody.reason === 'schema-invalid') {
          throw new DemoError('validation-failed', 'command-schema-invalid', {
            invalidFields: parsedBody.invalidFields,
          });
        }
        throw invalidBody(parsedBody.reason === 'body-too-large' ? 'too-large' : 'grammar');
      }
      const command = parsedBody.command;
      // Step 5: CommandRequestSchema already refuses a section the routing
      // table does not list, and any command type but the section's own, so
      // that refusal is the contract's and is not repeated here (datum 0.7).
      const providerId = owningProviderForSection(command.section);
      // Step 6.
      const requestHash = computeRequestHash(authenticationContext.tenantId, command);
      // Step 7.
      const created = await journalStore.createOperation({
        operationId: dependencies.mintOperationId(),
        tenantId: authenticationContext.tenantId,
        recordId: command.recordId,
        providerId,
        section: command.section,
        commandType: command.type,
        baseVersion: command.baseVersion,
        payload: command.payload,
        idempotencyKey,
        requestHash,
      });
      if (created.outcome === 'created') {
        intakeLog.bindOperation(created.operation.operationId);
        intakeMetrics.countCommandAccepted(providerId);
        // Step 8.
        return acceptedResponse(toOperationStatus(created.operation), false);
      }
      // §3.2: the key was used before, by this tenant.
      const { idempotencyEntry } = created;
      intakeLog.bindOperation(idempotencyEntry.operationId);
      if (idempotencyEntry.requestHash !== requestHash) {
        intakeMetrics.countIdempotencyKeyReused();
        throw new DemoError('idempotency-key-reused', 'request-hash-differs');
      }
      const originalOperation = await journalStore.readOperation(idempotencyEntry.operationId);
      if (originalOperation === undefined) {
        // Operations outlive their idempotency entries (WD3), so this is a
        // fault, answered 500, never a fresh acceptance.
        throw new Error('replayed-operation-missing');
      }
      intakeMetrics.countIdempotentReplay();
      return acceptedResponse(toOperationStatus(originalOperation), true);
    },
    { log: dependencies.problemLog, metrics: dependencies.problemMetrics },
  );
}
