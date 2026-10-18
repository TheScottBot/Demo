// Spec 03's tuning values, adopted by the author on 18 October 2026 (WD3,
// WQ5). Each is stated here once.
export const writePathSettings = {
  // WD3: how long a client can poll an operation.
  operationRetentionDays: 30,
  // WD3: the idempotency window; it must outlast any client's retry horizon,
  // or a late retry becomes a second command.
  idempotencyRetentionDays: 7,
} as const;
