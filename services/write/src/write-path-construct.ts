import { fileURLToPath } from 'node:url';
import {
  createDemoNodejsFunction,
  demoMetricsNamespace,
  demoResourceName,
  type WritePathOutputs,
  type WritePathProperties,
} from '@demo/construct-contracts';
import {
  Duration,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_lambda as lambda,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CommandJournal } from './command-journal-construct';
import type { CommandMessageParse } from './command-queue';
import { CommandRelay } from './command-relay-construct';
import { CommandWorker } from './command-worker-construct';
import { writeFunctionEnvironment } from './write-function-configuration';
import { writePathSettings } from './write-path-settings';

// Spec 03 §10: the write path's one construct, implementing the Spec 00 §3.11
// interfaces exactly. It joins the journal (WE1), the worker and its queues
// (WE5) and the relay and sweep (WE3), builds the intake and status functions
// the gateway calls, and raises §11's alarms on the family's topic.

const intakeEntryPath = fileURLToPath(
  new URL('./handlers/intake-handler-entry.ts', import.meta.url),
);
const statusEntryPath = fileURLToPath(
  new URL('./handlers/status-handler-entry.ts', import.meta.url),
);

// WU20, adopted by the author on 18 October 2026 (WQ5).
const intakeFunctionSettings = { memoryMegabytes: 256, timeout: Duration.seconds(5) } as const;
const statusFunctionSettings = { memoryMegabytes: 256, timeout: Duration.seconds(3) } as const;

// Every reason §6.3 step 1 rejects a message for, so the alarm sees them all.
const queueMessageRejectionReasons: readonly Extract<
  CommandMessageParse,
  { outcome: 'rejected' }
>['reason'][] = ['body-too-large', 'not-json', 'version-mismatch', 'schema-invalid'];

export class WritePath extends Construct implements WritePathOutputs {
  readonly commandHandler: lambda.IFunction;
  readonly statusHandler: lambda.IFunction;

  constructor(scope: Construct, constructId: string, properties: WritePathProperties) {
    super(scope, constructId);
    // §10, Spec 00 §2.3: the relay may be absent only where the sweep alone
    // is the thing tested.
    if (!properties.relayEnabled && properties.stage !== 'test') {
      throw new Error(`relay-disabled-outside-test: relayEnabled is false in ${properties.stage}`);
    }
    const { journalTable } = new CommandJournal(this, 'CommandJournal', {
      stage: properties.stage,
    });
    const commandWorker = new CommandWorker(this, 'CommandWorker', {
      stage: properties.stage,
      journalTable,
      providers: properties.providers,
    });
    const commandRelay = new CommandRelay(this, 'CommandRelay', {
      stage: properties.stage,
      journalTable,
      commandQueue: commandWorker.commandQueue,
      relayEnabled: properties.relayEnabled,
    });

    const environment = writeFunctionEnvironment({
      stage: properties.stage,
      journalTableName: journalTable.tableName,
      commandQueueUrl: commandWorker.commandQueue.queueUrl,
      relayEnabled: properties.relayEnabled,
    });
    const intakeFunction = createDemoNodejsFunction(this, 'IntakeFunction', {
      stage: properties.stage,
      component: 'write-intake',
      entry: intakeEntryPath,
      environment,
      memorySize: intakeFunctionSettings.memoryMegabytes,
      timeout: intakeFunctionSettings.timeout,
    });
    // §10: the transactional write, and the read a replay needs (§3.2).
    journalTable.grant(intakeFunction, 'dynamodb:PutItem', 'dynamodb:GetItem');
    const statusFunction = createDemoNodejsFunction(this, 'StatusFunction', {
      stage: properties.stage,
      component: 'write-status',
      entry: statusEntryPath,
      environment,
      memorySize: statusFunctionSettings.memoryMegabytes,
      timeout: statusFunctionSettings.timeout,
    });
    journalTable.grant(statusFunction, 'dynamodb:GetItem');
    this.commandHandler = intakeFunction;
    this.statusHandler = statusFunction;

    // §11 alarms, every one to the family's alarm topic (Spec 00 §5.1).
    const alarmPeriod = Duration.minutes(writePathSettings.alarmPeriodMinutes);
    const alarmAction = new cloudwatchActions.SnsAction(properties.alarmTopic);
    const alarmOn = (
      alarmComponent: string,
      metric: cloudwatch.Metric | cloudwatch.MathExpression,
      threshold: number,
      periods = 1,
    ) => {
      metric
        .createAlarm(this, `Alarm-${alarmComponent}`, {
          alarmName: demoResourceName(properties.stage, alarmComponent),
          threshold,
          evaluationPeriods: periods,
          datapointsToAlarm: periods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        })
        .addAlarmAction(alarmAction);
    };
    const writeMetric = (metricName: string, dimensions: Record<string, string> = {}) =>
      new cloudwatch.Metric({
        namespace: demoMetricsNamespace(properties.stage),
        metricName,
        statistic: 'Sum',
        period: alarmPeriod,
        dimensionsMap: { service: 'write', ...dimensions },
      });

    alarmOn(
      'commands-dead-letter-not-empty',
      commandWorker.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(writePathSettings.deadLetterAlarmPeriodMinutes),
        statistic: 'Maximum',
      }),
      0,
    );
    alarmOn(
      'command-queue-age-high',
      commandWorker.commandQueue.metricApproximateAgeOfOldestMessage({
        period: alarmPeriod,
        statistic: 'Maximum',
      }),
      writePathSettings.commandQueueAgeAlarmSeconds,
    );
    alarmOn(
      'sweep-recovering',
      writeMetric('SweepRecovered'),
      0,
      writePathSettings.sweepRecoveringAlarmPeriods,
    );
    if (commandRelay.relayFunction !== undefined) {
      // WU21: IteratorAge exists in AWS/Lambda for stream sources, in milliseconds.
      alarmOn(
        'relay-iterator-age-high',
        commandRelay.relayFunction.metric('IteratorAge', {
          period: alarmPeriod,
          statistic: 'Maximum',
        }),
        writePathSettings.relayIteratorAgeAlarmMilliseconds,
      );
    }
    alarmOn(
      'queue-message-rejected',
      new cloudwatch.MathExpression({
        expression: queueMessageRejectionReasons
          .map((_reason, reasonIndex) => `FILL(rejected${String(reasonIndex)}, 0)`)
          .join(' + '),
        usingMetrics: Object.fromEntries(
          queueMessageRejectionReasons.map((reason, reasonIndex) => [
            `rejected${String(reasonIndex)}`,
            writeMetric('QueueMessageRejected', { reason }),
          ]),
        ),
        period: alarmPeriod,
      }),
      0,
    );
    // Unexpected throws only: a retryable outcome is a reported failure (§11).
    alarmOn(
      'write-worker-errors',
      commandWorker.workerFunction.metricErrors({ period: alarmPeriod, statistic: 'Sum' }),
      0,
    );
  }
}
