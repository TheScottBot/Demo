// Spec 03 §10, §11 and WE8: the WritePath construct, by synth assertions.
import { App, Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import type { DemoStage, ProviderConnection } from '@demo/construct-contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { WritePath } from '../src/write-path-construct';

function providerConnections(stage: DemoStage): ProviderConnection[] {
  return (['provider-a', 'provider-b', 'provider-c'] as const).map((providerId) => ({
    providerId,
    baseUrl: `https://${providerId}.providers.example.test`,
    secretArn: `arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/${stage}/providers/${providerId}-AbCdEf`,
  }));
}

function synthesise(stage: DemoStage, relayEnabled: boolean) {
  const stack = new Stack(new App(), `WritePathTest-${stage}-${String(relayEnabled)}`);
  const alarmTopic = new sns.Topic(stack, 'AlarmTopic');
  const writePath = new WritePath(stack, 'WritePath', {
    stage,
    providers: providerConnections(stage),
    alarmTopic,
    relayEnabled,
  });
  return { template: Template.fromStack(stack), writePath };
}

let devTemplate: Template;
let testTemplate: Template;
let devWritePath: WritePath;

beforeAll(() => {
  const dev = synthesise('dev', true);
  devTemplate = dev.template;
  devWritePath = dev.writePath;
  testTemplate = synthesise('test', false).template;
}, 600_000);

type Resource = { Properties: Record<string, unknown> };

function functionNamed(template: Template, functionName: string) {
  const [match] = Object.entries(template.findResources('AWS::Lambda::Function')).filter(
    ([, resource]) => (resource as Resource).Properties['FunctionName'] === functionName,
  );
  if (match === undefined) {
    throw new Error(`no function ${functionName}`);
  }
  return { logicalId: match[0], properties: (match[1] as Resource).Properties };
}

function statementsFor(template: Template, functionName: string) {
  const roleLogicalId = (
    functionNamed(template, functionName).properties['Role'] as { 'Fn::GetAtt': [string, string] }
  )['Fn::GetAtt'][0];
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((policy) =>
      JSON.stringify((policy as Resource).Properties['Roles']).includes(roleLogicalId),
    )
    .flatMap(
      (policy) =>
        (
          (policy as Resource).Properties['PolicyDocument'] as {
            Statement: { Action: string | string[]; Resource: unknown }[];
          }
        ).Statement,
    );
}

function actionsFor(template: Template, functionName: string): string[] {
  return [
    ...new Set(
      statementsFor(template, functionName).flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action],
      ),
    ),
  ].sort();
}

const sqsSend = ['sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:SendMessage'];

describe('the functions (§10, WU20)', () => {
  it.each([
    ['demo-dev-write-intake', 256, 5],
    ['demo-dev-write-status', 256, 3],
    ['demo-dev-write-relay', 256, 30],
    ['demo-dev-write-sweep', 256, 60],
    ['demo-dev-write-worker', 512, 20],
  ])('%s has %i MB and %i seconds, and no VPC', (functionName, memorySize, timeout) => {
    const { properties } = functionNamed(devTemplate, functionName);
    expect(properties).toMatchObject({ MemorySize: memorySize, Timeout: timeout });
    expect(properties['VpcConfig']).toBeUndefined();
  });

  it('hands the gateway the intake and status functions (Spec 00 §3.11)', () => {
    expect(devWritePath.commandHandler.node.id).toBe('IntakeFunction');
    expect(devWritePath.statusHandler.node.id).toBe('StatusFunction');
  });
});

describe('each function may do what §10 lists, and nothing more', () => {
  it.each([
    ['demo-dev-write-intake', ['dynamodb:GetItem', 'dynamodb:PutItem']],
    ['demo-dev-write-status', ['dynamodb:GetItem']],
    [
      'demo-dev-write-relay',
      [
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:ListStreams',
        'dynamodb:UpdateItem',
        ...sqsSend,
      ],
    ],
    [
      'demo-dev-write-sweep',
      ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem', ...sqsSend],
    ],
    [
      'demo-dev-write-worker',
      [
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'secretsmanager:GetSecretValue',
        'sqs:ChangeMessageVisibility',
        'sqs:DeleteMessage',
        'sqs:GetQueueAttributes',
        'sqs:GetQueueUrl',
        'sqs:ReceiveMessage',
      ],
    ],
  ])('%s', (functionName, expectedActions) => {
    expect(actionsFor(devTemplate, functionName)).toEqual([...expectedActions].sort());
  });

  it('gives no function any permission on commands-dlq (§8.1)', () => {
    const deadLetterQueueId = Object.entries(devTemplate.findResources('AWS::SQS::Queue')).find(
      ([, queue]) => (queue as Resource).Properties['QueueName'] === 'demo-dev-commands-dlq.fifo',
    )?.[0];
    expect(deadLetterQueueId).toBeDefined();
    for (const functionName of [
      'demo-dev-write-intake',
      'demo-dev-write-status',
      'demo-dev-write-relay',
      'demo-dev-write-sweep',
      'demo-dev-write-worker',
    ]) {
      expect(JSON.stringify(statementsFor(devTemplate, functionName))).not.toContain(
        String(deadLetterQueueId),
      );
    }
  });
});

describe('the alarms (§11, WU21)', () => {
  function alarmNamed(template: Template, alarmName: string): Record<string, unknown> {
    const alarm = Object.values(template.findResources('AWS::CloudWatch::Alarm')).find(
      (candidate) => (candidate as Resource).Properties['AlarmName'] === alarmName,
    ) as Resource | undefined;
    if (alarm === undefined) {
      throw new Error(`no alarm ${alarmName}`);
    }
    return alarm.Properties;
  }

  it('raises CommandsDeadLetterNotEmpty when a dead letter is visible for a minute', () => {
    const alarm = alarmNamed(devTemplate, 'demo-dev-commands-dead-letter-not-empty');
    expect(alarm).toMatchObject({
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Namespace: 'AWS/SQS',
      Period: 60,
      EvaluationPeriods: 1,
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  it('raises CommandQueueAgeHigh above 300 seconds', () => {
    expect(alarmNamed(devTemplate, 'demo-dev-command-queue-age-high')).toMatchObject({
      MetricName: 'ApproximateAgeOfOldestMessage',
      Namespace: 'AWS/SQS',
      Threshold: 300,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  it('raises SweepRecovering when SweepRecovered is above 0 for 3 periods', () => {
    expect(alarmNamed(devTemplate, 'demo-dev-sweep-recovering')).toMatchObject({
      MetricName: 'SweepRecovered',
      Namespace: 'Demo/dev',
      Dimensions: [{ Name: 'service', Value: 'write' }],
      EvaluationPeriods: 3,
      DatapointsToAlarm: 3,
      Threshold: 0,
    });
  });

  it("raises RelayIteratorAgeHigh above 60 seconds of the relay's iterator age", () => {
    expect(alarmNamed(devTemplate, 'demo-dev-relay-iterator-age-high')).toMatchObject({
      MetricName: 'IteratorAge',
      Namespace: 'AWS/Lambda',
      Statistic: 'Maximum',
      Threshold: 60_000,
    });
  });

  it('raises QueueMessageRejected on any rejected message, whatever its reason, in 5 minutes', () => {
    const alarm = alarmNamed(devTemplate, 'demo-dev-queue-message-rejected');
    expect(alarm['Threshold']).toBe(0);
    const metrics = JSON.stringify(alarm['Metrics']);
    for (const reason of ['body-too-large', 'not-json', 'version-mismatch', 'schema-invalid']) {
      expect(metrics).toContain(reason);
    }
    expect(metrics).toContain('"Period":300');
  });

  it('raises WorkerErrors on any worker function error in 5 minutes', () => {
    expect(alarmNamed(devTemplate, 'demo-dev-write-worker-errors')).toMatchObject({
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Period: 300,
      Threshold: 0,
    });
    // The worker's errors, and no other function's.
    expect(
      JSON.stringify(alarmNamed(devTemplate, 'demo-dev-write-worker-errors')['Dimensions']),
    ).toContain(functionNamed(devTemplate, 'demo-dev-write-worker').logicalId);
  });

  it('sends every alarm to the alarm topic, treating missing data as fine', () => {
    const alarms = Object.values(devTemplate.findResources('AWS::CloudWatch::Alarm')) as Resource[];
    expect(alarms).toHaveLength(6);
    for (const alarm of alarms) {
      expect(JSON.stringify(alarm.Properties['AlarmActions'])).toContain('AlarmTopic');
      expect(alarm.Properties['TreatMissingData']).toBe('notBreaching');
    }
  });

  it('has no relay iterator alarm when the relay is absent', () => {
    expect(Object.values(testTemplate.findResources('AWS::CloudWatch::Alarm'))).toHaveLength(5);
    expect(() => alarmNamed(testTemplate, 'demo-test-relay-iterator-age-high')).toThrow();
  });
});

describe('relayEnabled (§5.1, §10)', () => {
  it('may be false in test, where the sweep alone moves operations', () => {
    expect(() => functionNamed(testTemplate, 'demo-test-write-relay')).toThrow();
    expect(functionNamed(testTemplate, 'demo-test-write-sweep').properties).toBeDefined();
  });

  it.each(['dev', 'stub', 'demo'] as const)('fails synth when false in %s', (stage) => {
    expect(() => synthesise(stage, false)).toThrow('relay-disabled-outside-test');
  });
});

describe('provider connections', () => {
  it('refuses a set that does not name each routing table provider exactly once', () => {
    const stack = new Stack(new App(), 'WritePathMissingProvider');
    expect(
      () =>
        new WritePath(stack, 'WritePath', {
          stage: 'dev',
          providers: providerConnections('dev').slice(0, 2),
          alarmTopic: new sns.Topic(stack, 'AlarmTopic'),
          relayEnabled: true,
        }),
    ).toThrow('write-path-needs-each-provider-once');
  });
});
