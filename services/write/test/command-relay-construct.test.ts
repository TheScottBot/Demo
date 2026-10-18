// Spec 03 §5, §10 and WE3: the relay and sweep functions, the stream mapping,
// the schedule and the relay failure queue, by synth assertions.
import { App, Stack, aws_sqs as sqs } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { CommandJournal } from '../src/command-journal-construct';
import { CommandRelay } from '../src/command-relay-construct';
import { writePathSettings } from '../src/write-path-settings';

function synthesise(relayEnabled: boolean) {
  const stack = new Stack(new App(), `CommandRelayTest${relayEnabled ? 'On' : 'Off'}`);
  const { journalTable } = new CommandJournal(stack, 'CommandJournal', { stage: 'dev' });
  // WE5 builds the commands queue; a FIFO queue stands in for it here.
  const commandQueue = new sqs.Queue(stack, 'CommandsQueue', { fifo: true });
  new CommandRelay(stack, 'CommandRelay', {
    stage: 'dev',
    journalTable,
    commandQueue,
    relayEnabled,
  });
  return Template.fromStack(stack);
}

let template: Template;
let relayOffTemplate: Template;

beforeAll(() => {
  template = synthesise(true);
  relayOffTemplate = synthesise(false);
}, 300_000);

function functionNamed(searched: Template, functionName: string) {
  const [match] = Object.entries(searched.findResources('AWS::Lambda::Function')).filter(
    ([, resource]) =>
      (resource as { Properties: { FunctionName?: string } }).Properties.FunctionName ===
      functionName,
  );
  if (match === undefined) {
    throw new Error(`no function ${functionName}`);
  }
  return {
    logicalId: match[0],
    properties: (match[1] as { Properties: Record<string, unknown> }).Properties,
  };
}

function actionsGrantedTo(searched: Template, functionName: string): string[] {
  const roleReference = functionNamed(searched, functionName).properties['Role'] as {
    'Fn::GetAtt': [string, string];
  };
  const roleLogicalId = roleReference['Fn::GetAtt'][0];
  const actions = Object.values(searched.findResources('AWS::IAM::Policy'))
    .filter((policy) =>
      JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles).includes(
        roleLogicalId,
      ),
    )
    .flatMap(
      (policy) =>
        (
          policy as {
            Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } };
          }
        ).Properties.PolicyDocument.Statement,
    )
    .flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    );
  return [...new Set(actions)].sort();
}

describe('the relay (§5.1, §10)', () => {
  it('has the settings §10 and WU20 give it, and no VPC', () => {
    const relay = functionNamed(template, 'demo-dev-write-relay');
    expect(relay.properties).toMatchObject({ MemorySize: 256, Timeout: 30 });
    expect(relay.properties['VpcConfig']).toBeUndefined();
    expect(JSON.stringify(relay.properties['Environment'])).toContain('JOURNAL_TABLE_NAME');
  });

  it('reads the stream filtered to operation inserts and TTL removals, reporting failures per record', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: { 'Fn::GetAtt': [Match.anyValue(), 'StreamArn'] },
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: writePathSettings.relayRetryAttempts,
      MaximumRecordAgeInSeconds: writePathSettings.relayMaximumRecordAgeSeconds,
      BatchSize: writePathSettings.relayBatchSize,
      StartingPosition: 'TRIM_HORIZON',
      FilterCriteria: {
        Filters: [
          {
            Pattern: JSON.stringify({
              eventName: ['INSERT'],
              dynamodb: { Keys: { sortKey: { S: ['OP'] } } },
            }),
          },
          {
            Pattern: JSON.stringify({
              eventName: ['REMOVE'],
              userIdentity: { type: ['Service'], principalId: ['dynamodb.amazonaws.com'] },
            }),
          },
        ],
      },
      DestinationConfig: {
        OnFailure: {
          Destination: { 'Fn::GetAtt': [Match.stringLikeRegexp('RelayFailures'), 'Arn'] },
        },
      },
    });
  });

  it('sends exhausted records to a standard queue, since a FIFO queue cannot take them (WU7)', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'demo-dev-relay-failures',
      SqsManagedSseEnabled: true,
    });
    const [failureQueue] = Object.values(template.findResources('AWS::SQS::Queue')).filter(
      (queue) =>
        (queue as { Properties: { QueueName?: string } }).Properties.QueueName ===
        'demo-dev-relay-failures',
    );
    expect(
      (failureQueue as { Properties: { FifoQueue?: boolean } }).Properties.FifoQueue,
    ).toBeUndefined();
  });

  it('may read the stream, update the journal and send to the two queues, and nothing more', () => {
    expect(actionsGrantedTo(template, 'demo-dev-write-relay')).toEqual([
      'dynamodb:DescribeStream',
      'dynamodb:GetRecords',
      'dynamodb:GetShardIterator',
      'dynamodb:ListStreams',
      'dynamodb:UpdateItem',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:SendMessage',
    ]);
  });
});

describe('the sweep (§5.3, §10)', () => {
  it('has the settings §10 and WU20 give it, and no VPC', () => {
    const sweep = functionNamed(template, 'demo-dev-write-sweep');
    expect(sweep.properties).toMatchObject({ MemorySize: 256, Timeout: 60 });
    expect(sweep.properties['VpcConfig']).toBeUndefined();
  });

  it('runs every 2 minutes on EventBridge Scheduler (WU9)', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'rate(2 minutes)',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: { 'Fn::GetAtt': [functionNamed(template, 'demo-dev-write-sweep').logicalId, 'Arn'] },
      },
    });
  });

  it('may query the pending index, read and update the journal and send commands, and nothing more', () => {
    expect(actionsGrantedTo(template, 'demo-dev-write-sweep')).toEqual([
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:SendMessage',
    ]);
  });

  it('is told whether the relay is there, so it can log its absence at cold start', () => {
    expect(
      JSON.stringify(functionNamed(template, 'demo-dev-write-sweep').properties['Environment']),
    ).toContain('"RELAY_ENABLED":"true"');
    expect(
      JSON.stringify(
        functionNamed(relayOffTemplate, 'demo-dev-write-sweep').properties['Environment'],
      ),
    ).toContain('"RELAY_ENABLED":"false"');
  });
});

describe('with the relay disabled (§5.1)', () => {
  it('has no relay function and no stream mapping, but keeps the sweep', () => {
    expect(() => functionNamed(relayOffTemplate, 'demo-dev-write-relay')).toThrow();
    relayOffTemplate.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    relayOffTemplate.resourceCountIs('AWS::Scheduler::Schedule', 1);
  });
});
