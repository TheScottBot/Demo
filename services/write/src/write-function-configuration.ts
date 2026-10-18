import type { DemoStage } from '@demo/construct-contracts';
import { z } from 'zod';

// Spec 00 §2.3: a write function's configuration comes only from its
// environment. The construct builds the environment here and the entry points
// parse it here, strictly, at cold start, so the two cannot drift. It imports
// no CDK, only types.

export interface WriteFunctionConfiguration {
  readonly stage: DemoStage;
  readonly journalTableName: string;
  readonly commandQueueUrl: string;
  // Spec 03 §5.1: false only in test; the sweep logs the absence.
  readonly relayEnabled: boolean;
}

const WriteFunctionEnvironmentSchema = z.strictObject({
  DEMO_STAGE: z.enum(['dev', 'stub', 'test', 'demo']),
  JOURNAL_TABLE_NAME: z.string().regex(/^demo-[a-z]+-command-journal$/),
  COMMAND_QUEUE_URL: z.url().startsWith('https://'),
  // Exactly the two words, never a truthy guess.
  RELAY_ENABLED: z.enum(['true', 'false']),
});

export function writeFunctionEnvironment(
  configuration: WriteFunctionConfiguration,
): Record<string, string> {
  return {
    DEMO_STAGE: configuration.stage,
    JOURNAL_TABLE_NAME: configuration.journalTableName,
    COMMAND_QUEUE_URL: configuration.commandQueueUrl,
    RELAY_ENABLED: String(configuration.relayEnabled),
  };
}

export function parseWriteFunctionConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): WriteFunctionConfiguration {
  // Only the function's own variables; the runtime sets many others.
  const writeEnvironment = WriteFunctionEnvironmentSchema.parse({
    DEMO_STAGE: environment['DEMO_STAGE'],
    JOURNAL_TABLE_NAME: environment['JOURNAL_TABLE_NAME'],
    COMMAND_QUEUE_URL: environment['COMMAND_QUEUE_URL'],
    RELAY_ENABLED: environment['RELAY_ENABLED'],
  });
  return {
    stage: writeEnvironment.DEMO_STAGE,
    journalTableName: writeEnvironment.JOURNAL_TABLE_NAME,
    commandQueueUrl: writeEnvironment.COMMAND_QUEUE_URL,
    relayEnabled: writeEnvironment.RELAY_ENABLED === 'true',
  };
}
