// Spec 00 §2.3 and Spec 02 §3.1: the read function's environment, validated
// at cold start; a missing or invalid variable fails it.
import { describe, expect, it } from 'vitest';
import { parseReadPathConfiguration } from '../src/read-path-configuration';

const validEnvironment = {
  DEMO_STAGE: 'dev',
  PROVIDER_TIMEOUT_MILLISECONDS: '1500',
  FAN_OUT_BUDGET_MILLISECONDS: '2500',
  AWS_REGION: 'eu-west-2',
};

describe('parseReadPathConfiguration', () => {
  it('reads the stage and the §3.1 budgets', () => {
    expect(parseReadPathConfiguration(validEnvironment)).toEqual({
      stage: 'dev',
      timing: { providerTimeoutMilliseconds: 1_500, fanOutBudgetMilliseconds: 2_500 },
    });
  });

  it.each([
    ['a missing stage', { ...validEnvironment, DEMO_STAGE: undefined }],
    ['an unknown stage', { ...validEnvironment, DEMO_STAGE: 'prod' }],
    [
      'a missing provider timeout',
      { ...validEnvironment, PROVIDER_TIMEOUT_MILLISECONDS: undefined },
    ],
    ['a fractional budget', { ...validEnvironment, FAN_OUT_BUDGET_MILLISECONDS: '2500.5' }],
    ['a zero timeout', { ...validEnvironment, PROVIDER_TIMEOUT_MILLISECONDS: '0' }],
    [
      'a budget no longer than the provider timeout',
      { ...validEnvironment, FAN_OUT_BUDGET_MILLISECONDS: '1500' },
    ],
  ])('refuses %s', (_caseName, environment) => {
    expect(() => parseReadPathConfiguration(environment)).toThrow();
  });
});
