import type { CommandQueueMessage, CommandQueueSender } from '../../src/command-queue';
import type { NewOperation } from '../../src/journal-store';

// Synthetic values shared by the write path's suites (datum 0.7, 0.17 item 17).

export function newOperation(overrides: Partial<NewOperation> = {}): NewOperation {
  return {
    operationId: '01JB0000000000000000000101',
    tenantId: 'tenant-1',
    recordId: 'record-0001',
    providerId: 'provider-a',
    section: 'summary',
    commandType: 'record.section.replace',
    baseVersion: '0123456789abcdef',
    payload: { title: 'Synthetic summary', status: 'active' },
    idempotencyKey: '00000000-0000-4000-8000-000000000101',
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}

export interface RecordingCommandQueue extends CommandQueueSender {
  readonly sent: CommandQueueMessage[];
}

// A stand in for the commands queue that keeps what it is sent. A failure,
// when given, is thrown for every send whose operation it names, or for every
// send when it names none.
export function createRecordingCommandQueue(
  options: { failWith?: Error; failForOperationId?: string } = {},
): RecordingCommandQueue {
  const sent: CommandQueueMessage[] = [];
  return {
    sent,
    sendCommandMessage: (message) => {
      if (
        options.failWith !== undefined &&
        (options.failForOperationId === undefined ||
          message.messageDeduplicationId === options.failForOperationId)
      ) {
        return Promise.reject(options.failWith);
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}
