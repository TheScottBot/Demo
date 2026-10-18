import { aws_logs as logs } from 'aws-cdk-lib';
import { httpHeaders, type PublicRoute } from '@demo/contracts';

// Spec 01 §3: DemoApi's tuning values, constants inside the construct, taken
// from Appendix A as the author adopted it on 18 October 2026 (EQ4).

type HandlerOwner = PublicRoute['handlerOwner'];

// EU10: above each route's function timeout (Spec 02 RU11, Spec 03 WU20),
// below the gateway's 29 second limit (EU2).
export const integrationTimeoutSeconds: Record<HandlerOwner, number> = {
  'spec-02-read-handler': 6,
  'spec-03-command-handler': 10,
  'spec-03-status-handler': 10,
};

// EU11: requests a second, and the burst above them.
export const routeThrottles: Record<HandlerOwner, { rate: number; burst: number }> = {
  'spec-02-read-handler': { rate: 100, burst: 200 },
  'spec-03-command-handler': { rate: 50, burst: 100 },
  'spec-03-status-handler': { rate: 100, burst: 200 },
};

// EU12.
export const corsMaximumAgeSeconds = 600;
export const accessLogRetentionDays = logs.RetentionDays.TWO_WEEKS;

// EU13.
export const alarmThresholds = {
  serverErrorsInFiveMinutes: 5,
  clientErrorPercentOverTenMinutes: 20,
  readLatencyP95Milliseconds: 3_000,
  readLatencyBreachingMinutes: 3,
  readLatencyEvaluatedMinutes: 5,
  throttledInFiveMinutes: 50,
} as const;

// §5.3: chosen by name from the contract's headers, since the exposed headers
// are a subset of the response headers, not all of them (the CE1 finding).
export const corsAllowedHeaders: readonly string[] = [
  httpHeaders.authorization,
  httpHeaders.contentType,
  httpHeaders.idempotencyKey,
  httpHeaders.ifNoneMatch,
  httpHeaders.correlationIdentifier,
].map((header) => header.wireName);

export const corsExposedHeaders: readonly string[] = [
  httpHeaders.entityTag,
  httpHeaders.location,
  httpHeaders.correlationIdentifier,
  httpHeaders.retryAfter,
  httpHeaders.idempotentReplayed,
].map((header) => header.wireName);
