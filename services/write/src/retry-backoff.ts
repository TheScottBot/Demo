import { writePathSettings } from './write-path-settings';

// Spec 03 §6.4: the visibility a retryable outcome sets on its message. A
// provider's Retry-After, already held to the Spec 00 §3.3 bound by the
// adapter, is honoured as given. Otherwise the delay doubles from a base on
// each receive, up to a cap, with up to a fifth taken off at random so
// retries of many commands spread out; it is taken off rather than added so
// the cap stays the most any retry waits (WU17, WQ5). This module is pure:
// the random fraction is the caller's.

// SQS visibility is whole seconds.
function wholeSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds));
}

export function retryVisibilitySeconds(options: {
  receiveCount: number;
  retryAfterMilliseconds?: number;
  // In [0, 1).
  randomFraction: number;
}): number {
  if (options.retryAfterMilliseconds !== undefined) {
    return wholeSeconds(options.retryAfterMilliseconds / 1_000);
  }
  // Doubling past 30 steps is far beyond the cap, and stops overflow.
  const doublings = Math.min(Math.max(options.receiveCount - 1, 0), 30);
  const delaySeconds = Math.min(
    writePathSettings.retryBackoffCapSeconds,
    writePathSettings.retryBackoffBaseSeconds * 2 ** doublings,
  );
  return wholeSeconds(
    delaySeconds * (1 - writePathSettings.retryBackoffJitterFraction * options.randomFraction),
  );
}
