import type { aws_lambda as lambda, aws_sns as sns } from 'aws-cdk-lib';

// Spec 00 §3.11, as written. Each stream's construct implements its interface
// and infra/bin/app.ts wires them through these alone. Tuning values (timeouts,
// memory, throttles) are not part of them; each stream keeps its own.

export type DemoStage = 'dev' | 'stub' | 'test' | 'demo';

export interface ProviderConnection {
  providerId: string;
  baseUrl: string;
  secretArn: string;
}

export interface ReadPathProperties {
  stage: DemoStage;
  providers: readonly ProviderConnection[];
  alarmTopic: sns.ITopic;
  readCache?: { enabled: boolean; approvalReference?: string };
}

export interface ReadPathOutputs {
  readonly readHandler: lambda.IFunction;
}

export interface WritePathProperties {
  stage: DemoStage;
  providers: readonly ProviderConnection[];
  alarmTopic: sns.ITopic;
  // false only in test (Spec 00 §2.3)
  relayEnabled: boolean;
}

export interface WritePathOutputs {
  readonly commandHandler: lambda.IFunction;
  readonly statusHandler: lambda.IFunction;
}

export interface DemoApiProperties {
  stage: DemoStage;
  readHandler: lambda.IFunction;
  commandHandler: lambda.IFunction;
  statusHandler: lambda.IFunction;
  identityProvider:
    | { kind: 'demo-user-pool' }
    | { kind: 'external'; issuerUrl: string; audiences: readonly string[] };
  corsAllowedOrigins: readonly string[];
  alarmTopic: sns.ITopic;
  customDomain?: { domainName: string; certificateArn: string };
}

export interface DemoApiOutputs {
  readonly baseUrl: string;
}
