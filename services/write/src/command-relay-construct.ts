import { fileURLToPath } from 'node:url';
import {
  createDemoNodejsFunction,
  demoResourceName,
  type DemoStage,
} from '@demo/construct-contracts';
import {
  Duration,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_scheduler as scheduler,
  aws_scheduler_targets as schedulerTargets,
  aws_sqs as sqs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { writeFunctionEnvironment } from './write-function-configuration';
import { writePathSettings } from './write-path-settings';

// Spec 03 §5 and §10: the relay, its filtered stream mapping and failure
// queue, and the sweep on its schedule. The WritePath construct (WE8) builds
// on it, with the commands queue WE5 adds, and holds the synth guard on
// relayEnabled.

const relayEntryPath = fileURLToPath(new URL('./handlers/relay-handler-entry.ts', import.meta.url));
const sweepEntryPath = fileURLToPath(new URL('./handlers/sweep-handler-entry.ts', import.meta.url));

// WU20, adopted by the author on 18 October 2026 (WQ5).
const relayFunctionSettings = { memoryMegabytes: 256, timeout: Duration.seconds(30) } as const;
const sweepFunctionSettings = { memoryMegabytes: 256, timeout: Duration.seconds(60) } as const;

export interface CommandRelayProperties {
  stage: DemoStage;
  journalTable: dynamodb.ITable;
  commandQueue: sqs.IQueue;
  relayEnabled: boolean;
}

export class CommandRelay extends Construct {
  readonly sweepFunction: lambda.IFunction;
  readonly relayFunction: lambda.IFunction | undefined;
  readonly relayFailureQueue: sqs.IQueue | undefined;

  constructor(scope: Construct, constructId: string, properties: CommandRelayProperties) {
    super(scope, constructId);
    const environment = writeFunctionEnvironment({
      stage: properties.stage,
      journalTableName: properties.journalTable.tableName,
      commandQueueUrl: properties.commandQueue.queueUrl,
      relayEnabled: properties.relayEnabled,
    });

    if (properties.relayEnabled) {
      // WU7: a standard queue, since an SQS FIFO queue is not a destination
      // a stream mapping can send to. It holds batch metadata only; the
      // sweep recovers the operations themselves.
      const relayFailureQueue = new sqs.Queue(this, 'RelayFailures', {
        queueName: demoResourceName(properties.stage, 'relay-failures'),
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(writePathSettings.relayFailureRetentionDays),
      });
      const relayFunction = createDemoNodejsFunction(this, 'RelayFunction', {
        stage: properties.stage,
        component: 'write-relay',
        entry: relayEntryPath,
        environment,
        memorySize: relayFunctionSettings.memoryMegabytes,
        timeout: relayFunctionSettings.timeout,
      });
      // §10: stream read (granted by the mapping), update on the journal,
      // send to commands and relay-failures (granted by the destination).
      properties.journalTable.grant(relayFunction, 'dynamodb:UpdateItem');
      properties.commandQueue.grantSendMessages(relayFunction);
      relayFunction.addEventSource(
        new eventSources.DynamoEventSource(properties.journalTable, {
          // The table is new with its stream, so nothing before the mapping
          // is missed, and the sweep recovers anything that is.
          startingPosition: lambda.StartingPosition.TRIM_HORIZON,
          batchSize: writePathSettings.relayBatchSize,
          reportBatchItemFailures: true,
          bisectBatchOnError: true,
          retryAttempts: writePathSettings.relayRetryAttempts,
          maxRecordAge: Duration.seconds(writePathSettings.relayMaximumRecordAgeSeconds),
          onFailure: new eventSources.SqsDlq(relayFailureQueue),
          // WU6: inserts of operation items, and removals by time to live
          // (WU5); every other change passes the relay by. Each rule is the
          // one element list FilterRule.isEqual would build, written out
          // because the CDK types that helper as any.
          filters: [
            lambda.FilterCriteria.filter({
              eventName: ['INSERT'],
              dynamodb: { Keys: { sortKey: { S: ['OP'] } } },
            }),
            lambda.FilterCriteria.filter({
              eventName: ['REMOVE'],
              userIdentity: { type: ['Service'], principalId: ['dynamodb.amazonaws.com'] },
            }),
          ],
        }),
      );
      this.relayFunction = relayFunction;
      this.relayFailureQueue = relayFailureQueue;
    }

    const sweepFunction = createDemoNodejsFunction(this, 'SweepFunction', {
      stage: properties.stage,
      component: 'write-sweep',
      entry: sweepEntryPath,
      environment,
      memorySize: sweepFunctionSettings.memoryMegabytes,
      timeout: sweepFunctionSettings.timeout,
    });
    // §10: query pending-index; read and update the journal; send to commands.
    properties.journalTable.grant(
      sweepFunction,
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
    );
    properties.commandQueue.grantSendMessages(sweepFunction);
    new scheduler.Schedule(this, 'SweepSchedule', {
      schedule: scheduler.ScheduleExpression.rate(
        Duration.minutes(writePathSettings.sweepIntervalMinutes),
      ),
      target: new schedulerTargets.LambdaInvoke(sweepFunction),
      // On time, not within a window: the grace period already allows for
      // the schedule's 60 second precision.
      timeWindow: scheduler.TimeWindow.off(),
      description: 'Spec 03 §5.3: recover accepted operations the relay has not moved',
    });
    this.sweepFunction = sweepFunction;
  }
}
