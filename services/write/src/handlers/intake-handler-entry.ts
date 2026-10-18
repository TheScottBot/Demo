import { env as processEnvironment } from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DemoHttpHandler } from '@demo/contracts';
import { ulid } from 'ulid';
import { createJournalStore } from '../journal-store';
import { parseWriteFunctionConfiguration } from '../write-function-configuration';
import { createPowertoolsWriteObservability } from '../write-path-observability';
import { createIntakeHandler } from './intake-handler';

// The bundled entry point of the intake function. Configuration is read and
// checked once, at cold start (Spec 00 §2.3).

const configuration = parseWriteFunctionConfiguration(processEnvironment);
const observability = createPowertoolsWriteObservability({
  stage: configuration.stage,
  component: 'write-intake',
});

const intakeHandler = createIntakeHandler({
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
  intakeLog: observability.intakeLog,
  intakeMetrics: observability.intakeMetrics,
  // Every platform identifier is a ULID (Spec 00 §2.3).
  mintOperationId: () => ulid(),
});

export const handler: DemoHttpHandler = (event, lambdaContext) => {
  observability.logger.addContext(lambdaContext);
  return intakeHandler(event, lambdaContext);
};
