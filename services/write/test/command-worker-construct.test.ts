// Spec 03 §6.1, §6.2, §10 and WE5: the commands queue, its dead letter
// queue and the worker, by synth assertions.
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import type { ProviderConnection } from '@demo/construct-contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { CommandJournal } from '../src/command-journal-construct';
import { CommandWorker } from '../src/command-worker-construct';

const providers: ProviderConnection[] = (['provider-a', 'provider-b', 'provider-c'] as const).map(
  (providerId) => ({
    providerId,
    baseUrl: `https://${providerId}.providers.example.test`,
    secretArn: `arn:aws:secretsmanager:eu-west-2:000000000000:secret:demo/dev/providers/${providerId}-AbCdEf`,
  }),
);

let template: Template;

beforeAll(() => {
  const stack = new Stack(new App(), 'CommandWorkerTest');
  const { journalTable } = new CommandJournal(stack, 'CommandJournal', { stage: 'dev' });
  new CommandWorker(stack, 'CommandWorker', { stage: 'dev', journalTable, providers });
  template = Template.fromStack(stack);
}, 300_000);

function queueNamed(queueName: string): Record<string, unknown> {
  const [queue] = Object.values(template.findResources('AWS::SQS::Queue')).filter(
    (candidate) =>
      (candidate as { Properties: { QueueName?: string } }).Properties.QueueName === queueName,
  );
  if (queue === undefined) {
    throw new Error(`no queue ${queueName}`);
  }
  return (queue as { Properties: Record<string, unknown> }).Properties;
}

describe('the queues (§6.1)', () => {
  it('configures commands as §6.1, WU11 to WU13 give it', () => {
    const commandQueue = queueNamed('demo-dev-commands.fifo');
    expect(commandQueue).toMatchObject({
      FifoQueue: true,
      ContentBasedDeduplication: false,
      VisibilityTimeout: 120,
      MessageRetentionPeriod: 4 * 86_400,
      SqsManagedSseEnabled: true,
      RedrivePolicy: { maxReceiveCount: 5 },
    });
    expect(JSON.stringify(commandQueue['RedrivePolicy'])).toMatch(/CommandsDeadLetter/);
  });

  it('configures commands-dlq as a FIFO queue kept 14 days, with no redrive of its own', () => {
    const deadLetterQueue = queueNamed('demo-dev-commands-dlq.fifo');
    expect(deadLetterQueue).toMatchObject({
      FifoQueue: true,
      MessageRetentionPeriod: 14 * 86_400,
      SqsManagedSseEnabled: true,
    });
    expect(deadLetterQueue['RedrivePolicy']).toBeUndefined();
  });
});

describe('the worker (§6.2, §10)', () => {
  it('has the settings WU20 gives it, and no VPC', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'demo-dev-write-worker',
      MemorySize: 512,
      Timeout: 20,
      VpcConfig: Match.absent(),
    });
  });

  it('reads commands one at a time, reports failures per message, and is capped at 10 (WU14)', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('CommandsQueue'), 'Arn'] },
      BatchSize: 1,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: 10 },
    });
  });

  it('may read and update the journal, consume commands and read the provider secrets, and nothing more', () => {
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (policy) =>
        (
          policy as {
            Properties: {
              PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] };
            };
          }
        ).Properties.PolicyDocument.Statement,
    );
    const actions = [
      ...new Set(
        statements.flatMap((statement) =>
          Array.isArray(statement.Action) ? statement.Action : [statement.Action],
        ),
      ),
    ].sort();
    expect(actions).toEqual([
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
      'secretsmanager:GetSecretValue',
      'sqs:ChangeMessageVisibility',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:ReceiveMessage',
    ]);
  });

  it('may read the three provider secrets, and no other secret', () => {
    const secretStatements = Object.values(template.findResources('AWS::IAM::Policy'))
      .flatMap(
        (policy) =>
          (
            policy as {
              Properties: {
                PolicyDocument: { Statement: { Action: unknown; Resource: unknown }[] };
              };
            }
          ).Properties.PolicyDocument.Statement,
      )
      .filter((statement) => statement.Action === 'secretsmanager:GetSecretValue');
    expect(secretStatements.map((statement) => statement.Resource)).toEqual([
      providers.map((connection) => connection.secretArn),
    ]);
  });

  it('may delete nothing from commands-dlq (§8.1)', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).not.toMatch(/CommandsDeadLetter/);
  });

  it('is configured with the journal, the queue and each provider', () => {
    const [workerFunction] = Object.values(template.findResources('AWS::Lambda::Function')).filter(
      (candidate) =>
        (candidate as { Properties: { FunctionName?: string } }).Properties.FunctionName ===
        'demo-dev-write-worker',
    );
    const environment = JSON.stringify(
      (workerFunction as { Properties: { Environment: unknown } }).Properties.Environment,
    );
    for (const variableName of [
      'JOURNAL_TABLE_NAME',
      'COMMAND_QUEUE_URL',
      'PROVIDER_A_BASE_URL',
      'PROVIDER_B_SECRET_ARN',
      'PROVIDER_C_BASE_URL',
    ]) {
      expect(environment).toContain(variableName);
    }
  });
});
