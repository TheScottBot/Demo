// Spec 03 §4 and §4.2, WE1: the command journal table and its sparse index,
// by synth assertions.
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { CommandJournal } from '../src/command-journal-construct';

let template: Template;
let commandJournal: CommandJournal;

beforeAll(() => {
  const stack = new Stack(new App(), 'CommandJournalTest');
  commandJournal = new CommandJournal(stack, 'CommandJournal', { stage: 'dev' });
  template = Template.fromStack(stack);
  // Synthesis can be slow when the whole suite runs at once, as for RE5.
}, 180_000);

describe('the command journal table (§4)', () => {
  it('is configured as §4 requires', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'demo-dev-command-journal',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'partitionKey', KeyType: 'HASH' },
        { AttributeName: 'sortKey', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'partitionKey', AttributeType: 'S' },
        { AttributeName: 'sortKey', AttributeType: 'S' },
      ]),
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('has the sparse pending-index, projecting the keys and tenantId (§4.2)', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'pendingBucket', AttributeType: 'S' },
        { AttributeName: 'pendingSince', AttributeType: 'S' },
      ]),
      GlobalSecondaryIndexes: [
        {
          IndexName: 'pending-index',
          KeySchema: [
            { AttributeName: 'pendingBucket', KeyType: 'HASH' },
            { AttributeName: 'pendingSince', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['tenantId'] },
        },
      ],
    });
  });

  it('is kept when the stack is removed, since it holds accepted commands (datum 0.14)', () => {
    const [table] = Object.values(template.findResources('AWS::DynamoDB::Table'));
    expect((table as { DeletionPolicy?: string }).DeletionPolicy).toBe('Retain');
  });

  it('exposes the table for the write path functions to be granted on', () => {
    expect(commandJournal.journalTable.node.id).toBe('JournalTable');
  });
});
