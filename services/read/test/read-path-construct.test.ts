// Spec 02 §7, §8 and RE5: the ReadPath construct, by synth assertions.
import { App, Stack, aws_lambda as lambda, aws_sns as sns } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import type { DemoStage, ProviderConnection } from '@demo/construct-contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { ReadPath } from '../src/read-path-construct';

function providerConnections(stage: DemoStage): ProviderConnection[] {
  return (['provider-a', 'provider-b', 'provider-c'] as const).map((providerId) => ({
    providerId,
    baseUrl: `https://${providerId}.providers.example.test`,
    secretArn: `arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/${stage}/providers/${providerId}-AbCdEf`,
  }));
}

function synthesise(
  stage: DemoStage,
  readCache?: { enabled: boolean; approvalReference?: string },
) {
  const stack = new Stack(new App(), `ReadPathTest-${stage}`);
  const alarmTopic = new sns.Topic(stack, 'AlarmTopic');
  const readPath = new ReadPath(stack, 'ReadPath', {
    stage,
    providers: providerConnections(stage),
    alarmTopic,
    ...(readCache === undefined ? {} : { readCache }),
  });
  return { template: Template.fromStack(stack), readPath, stack };
}

let devTemplate: Template;
let demoTemplate: Template;
let devReadPath: ReadPath;

beforeAll(() => {
  const dev = synthesise('dev');
  devTemplate = dev.template;
  devReadPath = dev.readPath;
  demoTemplate = synthesise('demo').template;
}, 180_000);

describe('the read function (§7)', () => {
  it('has the settings Spec 02 §7 and RU10 to RU12 give it', () => {
    devTemplate.resourceCountIs('AWS::Lambda::Function', 1);
    devTemplate.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'demo-dev-read',
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      MemorySize: 512,
      Timeout: 5,
      ReservedConcurrentExecutions: 100,
      TracingConfig: { Mode: 'Active' },
      Environment: {
        Variables: {
          DEMO_STAGE: 'dev',
          PROVIDER_TIMEOUT_MILLISECONDS: '1500',
          FAN_OUT_BUDGET_MILLISECONDS: '2500',
          PROVIDER_A_BASE_URL: 'https://provider-a.providers.example.test',
          PROVIDER_A_SECRET_ARN: Match.stringLikeRegexp('demo/dev/providers/provider-a'),
          PROVIDER_B_BASE_URL: 'https://provider-b.providers.example.test',
          PROVIDER_B_SECRET_ARN: Match.stringLikeRegexp('demo/dev/providers/provider-b'),
          PROVIDER_C_BASE_URL: 'https://provider-c.providers.example.test',
          PROVIDER_C_SECRET_ARN: Match.stringLikeRegexp('demo/dev/providers/provider-c'),
          NODE_OPTIONS: '--enable-source-maps',
        },
      },
    });
  });

  it('is not placed in a VPC', () => {
    const [readFunction] = Object.values(devTemplate.findResources('AWS::Lambda::Function'));
    expect(
      (readFunction as { Properties: Record<string, unknown> }).Properties['VpcConfig'],
    ).toBeUndefined();
  });

  it('is reached through a live alias, with provisioned concurrency only in demo (RU13)', () => {
    expect(devReadPath.readHandler).toBeInstanceOf(lambda.Alias);
    devTemplate.hasResourceProperties('AWS::Lambda::Alias', {
      Name: 'live',
      ProvisionedConcurrencyConfig: Match.absent(),
    });
    demoTemplate.hasResourceProperties('AWS::Lambda::Alias', {
      Name: 'live',
      ProvisionedConcurrencyConfig: { ProvisionedConcurrentExecutions: 2 },
    });
  });

  it('may read the three provider secrets and nothing else beyond tracing', () => {
    const statements = Object.values(devTemplate.findResources('AWS::IAM::Policy')).flatMap(
      (policy) =>
        (
          policy as {
            Properties: {
              PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] };
            };
          }
        ).Properties.PolicyDocument.Statement,
    );
    const actions = statements.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    );
    expect([...new Set(actions)].sort()).toEqual([
      'secretsmanager:GetSecretValue',
      'xray:PutTelemetryRecords',
      'xray:PutTraceSegments',
    ]);
    const secretStatement = statements.find(
      (statement) => statement.Action === 'secretsmanager:GetSecretValue',
    );
    expect(secretStatement?.Resource).toEqual([
      expect.stringContaining('provider-a') as unknown,
      expect.stringContaining('provider-b') as unknown,
      expect.stringContaining('provider-c') as unknown,
    ]);
  });
});

describe('the read path alarms (§8, RU14)', () => {
  function alarmNamed(alarmName: string) {
    const alarm = Object.values(devTemplate.findResources('AWS::CloudWatch::Alarm')).find(
      (candidate) =>
        (candidate as { Properties: { AlarmName: string } }).Properties.AlarmName === alarmName,
    ) as { Properties: Record<string, unknown> } | undefined;
    if (alarm === undefined) {
      throw new Error(`no alarm named ${alarmName}`);
    }
    return alarm.Properties;
  }

  it('creates one timeout rate alarm per provider, above 10 per cent over 5 minutes', () => {
    for (const providerId of ['provider-a', 'provider-b', 'provider-c']) {
      const alarm = alarmNamed(`demo-dev-read-provider-timeout-rate-${providerId}`);
      expect(alarm['Threshold']).toBe(10);
      expect(alarm['ComparisonOperator']).toBe('GreaterThanThreshold');
      expect(JSON.stringify(alarm['Metrics'])).toContain('"Period":300');
      expect(JSON.stringify(alarm['Metrics'])).toContain('timeout');
    }
  });

  it.each([
    'demo-dev-read-provider-version-mismatch',
    'demo-dev-read-all-sources-unavailable',
    'demo-dev-read-function-errors',
  ])('creates %s, on any occurrence in 5 minutes', (alarmName) => {
    const alarm = alarmNamed(alarmName);
    expect(alarm['Threshold']).toBe(0);
    expect(alarm['ComparisonOperator']).toBe('GreaterThanThreshold');
    expect(JSON.stringify(alarm)).toContain('300');
  });

  it('sends every alarm to the alarm topic, and treats missing data as fine', () => {
    const alarms = Object.values(devTemplate.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms).toHaveLength(6);
    for (const alarm of alarms) {
      const properties = (alarm as { Properties: Record<string, unknown> }).Properties;
      expect(JSON.stringify(properties['AlarmActions'])).toContain('AlarmTopic');
      expect(properties['TreatMissingData']).toBe('notBreaching');
    }
  });
});

describe('the read cache switch (§6, RD1)', () => {
  it('fails synth when the cache is enabled without an approval reference', () => {
    expect(() => synthesise('test', { enabled: true })).toThrow(
      'read-cache-needs-approval-reference',
    );
  });

  it('fails synth when the cache is enabled at all, since RE7 is unscheduled', () => {
    expect(() => synthesise('test', { enabled: true, approvalReference: 'RD1' })).toThrow(
      'read-cache-not-built',
    );
  });

  it('accepts the cache switched off', () => {
    expect(() => synthesise('test', { enabled: false })).not.toThrow();
  }, 120_000);
});

describe('provider connections', () => {
  it('refuses a set that does not name each routing table provider exactly once', () => {
    const stack = new Stack(new App(), 'ReadPathMissingProvider');
    expect(
      () =>
        new ReadPath(stack, 'ReadPath', {
          stage: 'dev',
          providers: providerConnections('dev').slice(0, 2),
          alarmTopic: new sns.Topic(stack, 'AlarmTopic'),
        }),
    ).toThrow('read-path-needs-each-provider-once');
  });
});
