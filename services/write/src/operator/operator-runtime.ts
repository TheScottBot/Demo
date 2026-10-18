import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createPowertoolsProblemHandling } from '@demo/construct-contracts/runtime';
import { z } from 'zod';
import { createSqsCommandQueueSender } from '../command-queue';
import { createJournalStore } from '../journal-store';
import {
  commandDeadLetterQueueName,
  commandJournalTableName,
  commandQueueName,
} from '../write-resource-names';
import {
  createDeadLetterOperator,
  createSqsDeadLetterQueue,
  type DeadLetterOperator,
} from './dead-letter-operator';

// What both §8.1 scripts run on: the operator's own AWS credentials, from the
// usual credential chain, against one stage. Under CQ6, with nothing
// deployed, the scripts are built and tested but not run.

const OperatorStageSchema = z.enum(['dev', 'test', 'demo']);

export type OperatorStage = z.infer<typeof OperatorStageSchema>;

// §8.1 names these three stages; the stub stage has no write path to resolve.
export function parseOperatorStage(stage: string | undefined): OperatorStage {
  return OperatorStageSchema.parse(stage);
}

export async function createOperatorForStage(stage: OperatorStage): Promise<DeadLetterOperator> {
  const sqsClient = new SQSClient({});
  const queueUrlOf = async (queueName: string): Promise<string> => {
    const found = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (found.QueueUrl === undefined) {
      throw new Error(`queue-not-found: ${queueName}`);
    }
    return found.QueueUrl;
  };
  const { logger, metricsPublisher } = createPowertoolsProblemHandling({
    stage,
    serviceName: 'write',
    component: 'write-operator',
  });
  return createDeadLetterOperator({
    journalStore: createJournalStore({
      documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      }),
      tableName: commandJournalTableName(stage),
      log: {
        recordStaleTransition: (details) => {
          logger.info('StaleTransition', { ...details });
        },
      },
      metrics: {
        // An operator transition is never counted stale (§4.3): it stops, or
        // finds its own earlier step done.
        countStaleTransition: () => undefined,
        countJournalItemRejected: (reason, itemKind) => {
          const singleMetric = metricsPublisher.singleMetric();
          singleMetric.addDimension('reason', reason);
          singleMetric.addDimension('itemKind', itemKind);
          singleMetric.addMetric('JournalItemRejected', 'Count', 1);
        },
      },
      now: () => new Date(),
    }),
    commandQueue: createSqsCommandQueueSender({
      sqsClient,
      queueUrl: await queueUrlOf(commandQueueName(stage)),
    }),
    deadLetterQueue: createSqsDeadLetterQueue({
      sqsClient,
      queueUrl: await queueUrlOf(commandDeadLetterQueueName(stage)),
    }),
    operatorLog: {
      recordOperatorAction: (details) => {
        logger.info('OperatorAction', { ...details });
      },
    },
    operatorMetrics: {
      countOperatorAction: (action, outcome) => {
        const singleMetric = metricsPublisher.singleMetric();
        singleMetric.addDimension('action', action);
        singleMetric.addDimension('outcome', outcome);
        singleMetric.addMetric('OperatorAction', 'Count', 1);
      },
    },
  });
}
