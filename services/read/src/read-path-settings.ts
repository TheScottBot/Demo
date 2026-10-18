// Spec 02's tuning values, adopted by the author on 18 October 2026 (RQ3,
// Appendix A as written). Each is stated here once.
export const readPathSettings = {
  // RU1: each provider call is aborted after this, alone (Spec 02 §3.1).
  providerTimeoutMilliseconds: 1_500,
  // RU2: every call still outstanding is aborted after this.
  fanOutBudgetMilliseconds: 2_500,
  // RU4: the ttl when a provider sends no max-age.
  defaultTtlSeconds: 60,
  // RU5: the most any provider's max-age can lengthen a ttl to.
  maximumTtlSeconds: 300,
} as const;
