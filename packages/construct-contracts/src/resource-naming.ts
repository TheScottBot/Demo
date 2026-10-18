import type { ProviderIdentifier } from '@demo/contracts';
import type { DemoStage } from './construct-properties';

// Spec 00 §2.3 and §5: every name the platform gives a resource, built in one
// place.

export const demoStages: readonly DemoStage[] = ['dev', 'stub', 'test', 'demo'];

// Lower case words joined by single hyphens.
const componentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A Lambda function name may hold 64 characters when given as a name alone
// (Plan stage, naming limits). It is the tightest limit of any resource the
// family names, so every name is held to it and a breach fails synth, not a
// deployment.
const maximumResourceNameCharacters = 64;

export function demoResourceName(stage: DemoStage, component: string): string {
  if (!componentPattern.test(component)) {
    throw new Error(`component-outside-grammar: ${component}`);
  }
  const resourceName = ['demo', stage, component].join('-');
  if (resourceName.length > maximumResourceNameCharacters) {
    throw new Error(`resource-name-too-long: ${resourceName}`);
  }
  return resourceName;
}

export function demoStackName(stage: DemoStage): string {
  return `DemoPlatform-${stage}`;
}

// CU8: a slash separated name, valid in Secrets Manager.
export function providerSecretName(stage: DemoStage, providerId: ProviderIdentifier): string {
  return `demo/${stage}/providers/${providerId}`;
}

export function demoMetricsNamespace(stage: DemoStage): string {
  return `Demo/${stage}`;
}
