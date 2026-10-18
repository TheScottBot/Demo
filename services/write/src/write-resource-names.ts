import { demoResourceName, type DemoStage } from '@demo/construct-contracts';

// The write path's resource names, stated once for the constructs that create
// the resources and the operator scripts that find them (§8.1).

export function commandJournalTableName(stage: DemoStage): string {
  return demoResourceName(stage, 'command-journal');
}

// SQS requires a FIFO queue's name to end .fifo.
export function commandQueueName(stage: DemoStage): string {
  return `${demoResourceName(stage, 'commands')}.fifo`;
}

export function commandDeadLetterQueueName(stage: DemoStage): string {
  return `${demoResourceName(stage, 'commands-dlq')}.fifo`;
}
