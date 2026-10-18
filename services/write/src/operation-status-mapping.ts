import { OperationStatusSchema, type OperationStatus } from '@demo/contracts';
import type { StoredOperation } from './journal-store';

// Spec 03 §9 step 4: what a client is told of an operation, for intake's 202
// and the status route alike. payload, requestHash, lastErrorReason,
// lastTransitionOrigin and redriveCount are the platform's own and are left
// out; the result is checked against the contract before it leaves.
export function toOperationStatus(storedOperation: StoredOperation): OperationStatus {
  return OperationStatusSchema.parse({
    operationId: storedOperation.operationId,
    state: storedOperation.state,
    recordId: storedOperation.recordId,
    providerId: storedOperation.providerId,
    attempts: storedOperation.attempts,
    createdAt: storedOperation.createdAt,
    updatedAt: storedOperation.updatedAt,
    ...(storedOperation.result === undefined ? {} : { result: storedOperation.result }),
    ...(storedOperation.conflict === undefined ? {} : { conflict: storedOperation.conflict }),
    ...(storedOperation.failure === undefined ? {} : { failure: storedOperation.failure }),
  });
}
