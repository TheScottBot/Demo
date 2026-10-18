// Spec 03's tuning values, adopted by the author on 18 October 2026 (WD3,
// WQ5). Each is stated here once.
export const writePathSettings = {
  // WD3: how long a client can poll an operation.
  operationRetentionDays: 30,
  // WD3: the idempotency window; it must outlast any client's retry horizon,
  // or a late retry becomes a second command.
  idempotencyRetentionDays: 7,
  // WU9: the sweep runs on this schedule.
  sweepIntervalMinutes: 2,
  // WU10: an operation the relay has had this long to move is the sweep's.
  sweepGracePeriodSeconds: 60,
  // WU10: one run's limits, below the sweep's 60 second timeout (WU20).
  sweepBatchLimit: 100,
  sweepTimeLimitMilliseconds: 50_000,
  // The relay's stream mapping (§5.1, WU7). Spec 03 names no values; these
  // are the agent's, awaiting the author's decision (WQ6, WE3 record).
  relayBatchSize: 10,
  relayRetryAttempts: 3,
  // single-definition: an hour of stream record age, not the Retry-After bound.
  relayMaximumRecordAgeSeconds: 3_600,
  relayFailureRetentionDays: 14,
} as const;
