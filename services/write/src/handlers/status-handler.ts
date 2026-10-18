import {
  DemoError,
  OperationIdentifierSchema,
  contractBounds,
  headerValues,
  httpHeaders,
  operationStateKind,
  readAuthenticationContext,
  requireScope,
  scopeNames,
  withHttpProblemHandling,
  type DemoHttpHandler,
  type OperationState,
  type ProblemHandlingLog,
  type ProblemHandlingMetrics,
} from '@demo/contracts';
import type { JournalStore } from '../journal-store';
import { toOperationStatus } from '../operation-status-mapping';
import { writePathSettings } from '../write-path-settings';

// Spec 03 §9: GET /v1/operations/{operationId}, which a client polls until a
// terminal state. Everything outside the process is injected.

export interface StatusLog {
  // §11: operationId on every line once it is known.
  bindOperation(operationId: string): void;
}

export interface StatusHandlerDependencies {
  readonly journalStore: Pick<JournalStore, 'readOperation'>;
  readonly problemLog: ProblemHandlingLog;
  readonly problemMetrics: ProblemHandlingMetrics;
  readonly statusLog: StatusLog;
}

// §9 step 2: the identifier's bound and grammar before anything reads it.
function checkedOperationIdentifier(operationId: string | undefined): string {
  const parsedOperationId = OperationIdentifierSchema.safeParse(operationId);
  if (!parsedOperationId.success) {
    const tooLong =
      operationId !== undefined &&
      operationId.length > contractBounds.operationIdentifierCharacters;
    throw new DemoError('validation-failed', 'request-field-invalid', {
      invalidFields: [
        { path: 'pathParameters.operationId', reason: tooLong ? 'too-long' : 'grammar' },
      ],
    });
  }
  return parsedOperationId.data;
}

// WU19: how long a client should wait before polling again. A terminal state
// will not change, so it carries none.
function retryAfterSecondsFor(state: OperationState): number | undefined {
  switch (operationStateKind(state)) {
    case 'in-progress':
      return writePathSettings.statusRetryAfterInProgressSeconds;
    case 'awaiting-operator':
      return writePathSettings.statusRetryAfterAwaitingOperatorSeconds;
    case 'terminal':
      return undefined;
  }
}

export function createStatusHandler(dependencies: StatusHandlerDependencies): DemoHttpHandler {
  return withHttpProblemHandling(
    async (event) => {
      // Step 1, with the scope WD4 decided.
      const authenticationContext = readAuthenticationContext(event);
      requireScope(authenticationContext, scopeNames.recordsWrite);
      // Step 2.
      const operationId = checkedOperationIdentifier(event.pathParameters?.['operationId']);
      dependencies.statusLog.bindOperation(operationId);
      // Step 3: strongly consistent, by the store. Another tenant's
      // operation is answered exactly as a missing one, so its existence
      // is never told (Spec 00 §3.5).
      const operation = await dependencies.journalStore.readOperation(operationId);
      if (operation?.tenantId !== authenticationContext.tenantId) {
        throw new DemoError('not-found', 'operation-not-found');
      }
      // Steps 4 and 5.
      const retryAfterSeconds = retryAfterSecondsFor(operation.state);
      return {
        statusCode: 200,
        headers: {
          [httpHeaders.contentType.wireName]: headerValues.jsonMediaType,
          [httpHeaders.cacheControl.wireName]: headerValues.noStore,
          ...(retryAfterSeconds === undefined
            ? {}
            : { [httpHeaders.retryAfter.wireName]: String(retryAfterSeconds) }),
        },
        body: JSON.stringify(toOperationStatus(operation)),
      };
    },
    { log: dependencies.problemLog, metrics: dependencies.problemMetrics },
  );
}
