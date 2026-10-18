import { fileURLToPath } from 'node:url';
import {
  createDemoNodejsFunction,
  type DemoStage,
  type ProviderConnection,
} from '@demo/construct-contracts';
import {
  Duration,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_sqs as sqs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { writeAdapterEnvironment } from './adapters/write-adapters';
import { writeFunctionEnvironment } from './write-function-configuration';
import { commandDeadLetterQueueName, commandQueueName } from './write-resource-names';
import { writePathSettings } from './write-path-settings';

// Spec 03 §6 and §10: the commands queue, its dead letter queue and the
// worker. The WritePath construct (WE8) builds on it, and hands its queue to
// the relay and sweep (WE3).

const workerEntryPath = fileURLToPath(
  new URL('./handlers/worker-handler-entry.ts', import.meta.url),
);

// WU20, adopted by the author on 18 October 2026 (WQ5).
const workerFunctionSettings = { memoryMegabytes: 512, timeout: Duration.seconds(20) } as const;

export interface CommandWorkerProperties {
  stage: DemoStage;
  journalTable: dynamodb.ITable;
  providers: readonly ProviderConnection[];
}

export class CommandWorker extends Construct {
  readonly commandQueue: sqs.IQueue;
  readonly deadLetterQueue: sqs.IQueue;
  readonly workerFunction: lambda.IFunction;

  constructor(scope: Construct, constructId: string, properties: CommandWorkerProperties) {
    super(scope, constructId);
    // §6.1: FIFO with no redrive of its own; operators redrive it (§8).
    const deadLetterQueue = new sqs.Queue(this, 'CommandsDeadLetter', {
      queueName: commandDeadLetterQueueName(properties.stage),
      fifo: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(writePathSettings.commandDeadLetterRetentionDays),
    });
    const commandQueue = new sqs.Queue(this, 'CommandsQueue', {
      queueName: commandQueueName(properties.stage),
      fifo: true,
      // §5.2 sets the deduplication identifier itself, to the operationId.
      contentBasedDeduplication: false,
      visibilityTimeout: Duration.seconds(writePathSettings.commandVisibilityTimeoutSeconds),
      retentionPeriod: Duration.days(writePathSettings.commandRetentionDays),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: writePathSettings.commandMaximumReceives,
      },
    });

    const workerFunction = createDemoNodejsFunction(this, 'WorkerFunction', {
      stage: properties.stage,
      component: 'write-worker',
      entry: workerEntryPath,
      environment: {
        ...writeFunctionEnvironment({
          stage: properties.stage,
          journalTableName: properties.journalTable.tableName,
          commandQueueUrl: commandQueue.queueUrl,
          // The worker reads no relay switch; it is set so every write
          // function parses one configuration.
          relayEnabled: true,
        }),
        ...writeAdapterEnvironment(properties.providers),
      },
      memorySize: workerFunctionSettings.memoryMegabytes,
      timeout: workerFunctionSettings.timeout,
    });
    // §10: read and update the journal; change message visibility (the
    // mapping grants it with the rest of consuming commands); read the
    // provider secrets. Nothing on commands-dlq (§8.1).
    properties.journalTable.grant(workerFunction, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: properties.providers.map((connection) => connection.secretArn),
      }),
    );
    workerFunction.addEventSource(
      new eventSources.SqsEventSource(commandQueue, {
        // §6.2: a failed message holds back only its own record's group.
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: writePathSettings.workerMaximumConcurrency,
      }),
    );

    this.commandQueue = commandQueue;
    this.deadLetterQueue = deadLetterQueue;
    this.workerFunction = workerFunction;
  }
}
