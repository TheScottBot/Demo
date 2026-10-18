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
  // were proposed in WE3 and adopted by the author on 18 October 2026 (WQ6).
  relayBatchSize: 10,
  relayRetryAttempts: 3,
  // single-definition: an hour of stream record age, not the Retry-After bound.
  relayMaximumRecordAgeSeconds: 3_600,
  relayFailureRetentionDays: 14,
  // WU11: six times the worker's 20 second timeout, as Lambda advises.
  commandVisibilityTimeoutSeconds: 120,
  // WU12: commands kept 4 days, dead letters 14, SQS's maximum.
  commandRetentionDays: 4,
  commandDeadLetterRetentionDays: 14,
  // WU13: receives before the dead letter queue.
  commandMaximumReceives: 5,
  // WU14: the backpressure on the providers.
  workerMaximumConcurrency: 10,
  // WU15: each provider call is aborted after this, below the worker's timeout.
  workerCallTimeoutMilliseconds: 8_000,
  // WU17 and WQ5: base, doubling, cap, and jitter taken off, never added.
  retryBackoffBaseSeconds: 5,
  retryBackoffCapSeconds: 300,
  retryBackoffJitterFraction: 0.2,
} as const;
