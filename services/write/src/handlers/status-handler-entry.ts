import { env as processEnvironment } from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DemoHttpHandler } from '@demo/contracts';
import { createJournalStore } from '../journal-store';
import { parseWriteFunctionConfiguration } from '../write-function-configuration';
import { createPowertoolsWriteObservability } from '../write-path-observability';
import { createStatusHandler } from './status-handler';

// The bundled entry point of the status function. Configuration is read and
// checked once, at cold start (Spec 00 §2.3).

const configuration = parseWriteFunctionConfiguration(processEnvironment);
const observability = createPowertoolsWriteObservability({
  stage: configuration.stage,
  component: 'write-status',
});

const statusHandler = createStatusHandler({
  journalStore: createJournalStore({
    documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    tableName: configuration.journalTableName,
    log: observability.journalLog,
    metrics: observability.journalMetrics,
    now: () => new Date(),
  }),
  problemLog: observability.problemLog,
  problemMetrics: observability.problemMetrics,
  statusLog: observability.statusLog,
});

export const handler: DemoHttpHandler = (event, lambdaContext) => {
  observability.logger.addContext(lambdaContext);
  return statusHandler(event, lambdaContext);
};
