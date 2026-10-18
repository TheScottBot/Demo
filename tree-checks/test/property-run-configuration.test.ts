// Spec 00 §2.4 check 6 relies on the property run count being set from the
// environment for the whole suite; this proves the setting reaches fast-check.
import { fc } from '@fast-check/vitest';
import nodeProcess from 'node:process';
import { describe, expect, it } from 'vitest';
import { propertyRunsFromEnvironment } from '../../vitest.setup';

describe('the property run count', () => {
  it('is what every property in the suite runs', () => {
    let runCount = 0;
    fc.assert(
      fc.property(fc.integer(), () => {
        runCount += 1;
      }),
    );
    expect(runCount).toBe(propertyRunsFromEnvironment(nodeProcess.env));
  });

  it('defaults to 100 and refuses a value that is not a positive whole number', () => {
    expect(propertyRunsFromEnvironment({})).toBe(100);
    expect(propertyRunsFromEnvironment({ DEMO_PROPERTY_RUNS: '1000' })).toBe(1_000);
    for (const invalidValue of ['0', '-5', '1.5', 'many', '']) {
      expect(() => propertyRunsFromEnvironment({ DEMO_PROPERTY_RUNS: invalidValue })).toThrow();
    }
  });
});
