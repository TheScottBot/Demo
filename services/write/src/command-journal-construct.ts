import type { DemoStage } from '@demo/construct-contracts';
import { aws_dynamodb as dynamodb } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { commandJournalAttributes, pendingIndexName } from './journal-store';
import { commandJournalTableName } from './write-resource-names';

// Spec 03 §4: the command journal table, its sparse pending index (§4.2) and
// its stream (§5.1). The WritePath construct (WE8) builds on it and grants
// each function only what §10 lists.

export interface CommandJournalProperties {
  stage: DemoStage;
}

export class CommandJournal extends Construct {
  readonly journalTable: dynamodb.Table;

  constructor(scope: Construct, constructId: string, properties: CommandJournalProperties) {
    super(scope, constructId);
    this.journalTable = new dynamodb.Table(this, 'JournalTable', {
      tableName: commandJournalTableName(properties.stage),
      partitionKey: {
        name: commandJournalAttributes.partitionKey,
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: commandJournalAttributes.sortKey, type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // §5.1: the relay reads inserts, and TTL removals for §4.5's count.
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: commandJournalAttributes.expiresAt,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // No removal policy is set, so the CDK default of retaining the table
      // holds: it keeps commands clients were told are accepted, and removing
      // a stack must never delete them (datum 0.14).
    });
    this.journalTable.addGlobalSecondaryIndex({
      indexName: pendingIndexName,
      partitionKey: {
        name: commandJournalAttributes.pendingBucket,
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: commandJournalAttributes.pendingSince, type: dynamodb.AttributeType.STRING },
      // §4.2: the keys and tenantId; the sweep reads the rest itself.
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['tenantId'],
    });
  }
}
