import { z } from 'zod';

// Spec 00 §2.3: the read function's configuration comes only from its
// environment, checked by a strict schema at cold start. The provider
// variables are checked by createConfiguredReadAdapters; this covers the rest.

const wholeMilliseconds = z
  .string()
  .regex(/^[1-9]\d{0,6}$/)
  .transform(Number);

const ReadPathEnvironmentSchema = z
  .strictObject({
    DEMO_STAGE: z.enum(['dev', 'stub', 'test', 'demo']),
    // Spec 02 §3.1, RU1.
    PROVIDER_TIMEOUT_MILLISECONDS: wholeMilliseconds,
    // Spec 02 §3.1, RU2.
    FAN_OUT_BUDGET_MILLISECONDS: wholeMilliseconds,
  })
  // A budget no longer than one provider's timeout would make the timeout
  // meaningless, so the pair is refused rather than run.
  .refine(
    (environment) =>
      environment.FAN_OUT_BUDGET_MILLISECONDS > environment.PROVIDER_TIMEOUT_MILLISECONDS,
  );

export interface ReadPathConfiguration {
  readonly stage: 'dev' | 'stub' | 'test' | 'demo';
  readonly timing: {
    readonly providerTimeoutMilliseconds: number;
    readonly fanOutBudgetMilliseconds: number;
  };
}

export function parseReadPathConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ReadPathConfiguration {
  // Only the function's own variables are checked strictly; the runtime sets
  // many others that are none of its business.
  const readEnvironment = ReadPathEnvironmentSchema.parse({
    DEMO_STAGE: environment['DEMO_STAGE'],
    PROVIDER_TIMEOUT_MILLISECONDS: environment['PROVIDER_TIMEOUT_MILLISECONDS'],
    FAN_OUT_BUDGET_MILLISECONDS: environment['FAN_OUT_BUDGET_MILLISECONDS'],
  });
  return {
    stage: readEnvironment.DEMO_STAGE,
    timing: {
      providerTimeoutMilliseconds: readEnvironment.PROVIDER_TIMEOUT_MILLISECONDS,
      fanOutBudgetMilliseconds: readEnvironment.FAN_OUT_BUDGET_MILLISECONDS,
    },
  };
}
