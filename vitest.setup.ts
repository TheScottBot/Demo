// Runs before every test file. It sets how many generated inputs each
// fast-check property tries: fast-check's own default of 100 for an ordinary
// run, and more in the continuous integration property job (Spec 00 §2.4
// check 6), which sets DEMO_PROPERTY_RUNS.
import { fc } from '@fast-check/vitest';
import nodeProcess from 'node:process';

const defaultPropertyRuns = 100;

export function propertyRunsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const configuredRuns = environment['DEMO_PROPERTY_RUNS'];
  if (configuredRuns === undefined) {
    return defaultPropertyRuns;
  }
  // A mistyped value fails loudly rather than quietly running the default.
  if (!/^[1-9]\d{0,6}$/.test(configuredRuns)) {
    throw new Error('DEMO_PROPERTY_RUNS must be a positive whole number');
  }
  return Number(configuredRuns);
}

fc.configureGlobal({ numRuns: propertyRunsFromEnvironment(nodeProcess.env) });
