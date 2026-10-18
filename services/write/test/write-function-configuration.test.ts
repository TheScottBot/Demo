// Spec 00 §2.3 and WE3: the relay and sweep environments, built in one place
// for the construct and read strictly at cold start.
import { describe, expect, it } from 'vitest';
import {
  parseWriteFunctionConfiguration,
  writeFunctionEnvironment,
} from '../src/write-function-configuration';

const queueUrl = 'https://sqs.eu-west-2.amazonaws.com/000000000000/demo-dev-commands.fifo';

describe('writeFunctionEnvironment and parseWriteFunctionConfiguration', () => {
  it('reads back what the construct sets', () => {
    const environment = writeFunctionEnvironment({
      stage: 'dev',
      journalTableName: 'demo-dev-command-journal',
      commandQueueUrl: queueUrl,
      relayEnabled: false,
    });
    expect(environment).toEqual({
      DEMO_STAGE: 'dev',
      JOURNAL_TABLE_NAME: 'demo-dev-command-journal',
      COMMAND_QUEUE_URL: queueUrl,
      RELAY_ENABLED: 'false',
    });
    expect(parseWriteFunctionConfiguration({ ...environment, AWS_REGION: 'eu-west-2' })).toEqual({
      stage: 'dev',
      journalTableName: 'demo-dev-command-journal',
      commandQueueUrl: queueUrl,
      relayEnabled: false,
    });
  });

  it.each([
    ['a missing table name', { JOURNAL_TABLE_NAME: undefined }],
    ['an unknown stage', { DEMO_STAGE: 'prod' }],
    ['a queue URL that is not https', { COMMAND_QUEUE_URL: 'http://example.test/queue' }],
    ['a relay switch that is not true or false', { RELAY_ENABLED: 'yes' }],
    ['a missing relay switch', { RELAY_ENABLED: undefined }],
  ])('refuses %s', (_caseName, override) => {
    const environment = {
      DEMO_STAGE: 'dev',
      JOURNAL_TABLE_NAME: 'demo-dev-command-journal',
      COMMAND_QUEUE_URL: queueUrl,
      RELAY_ENABLED: 'true',
      ...override,
    };
    expect(() => parseWriteFunctionConfiguration(environment)).toThrow();
  });
});
