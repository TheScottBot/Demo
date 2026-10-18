// Spec 02 §6: the read cache, in the only form RD1 allows: disabled. The
// switch exists so its absence is a fact the handler logs at cold start, and
// so RE7 has one place to change if RD1 is ever revisited. Pure (Spec 02 §2).

export interface ReadCachePolicy {
  readonly enabled: false;
  // Why the cache is absent, for the cold start log (Spec 00 §5.1).
  readonly absenceReason: string;
}

export const disabledReadCachePolicy: ReadCachePolicy = {
  enabled: false,
  absenceReason: 'read cache disabled: RD1 builds the switch only, and RE7 is unscheduled',
};
