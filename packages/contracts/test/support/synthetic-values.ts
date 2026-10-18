// Synthetic values only (Spec 00 §3.7, datum 0.17 item 17). Every identifier and
// timestamp here was made up for these tests and names nothing real.
//
// These values serve the contract package's own suite. The shared fixtures for
// the other streams are CE2's, in packages/test-doubles.

export const syntheticUlid = '01JAZ5Q8Z1X2Y3W4V5T6S7R8Q9';
export const secondSyntheticUlid = '01JAZ5Q8Z1X2Y3W4V5T6S7R8QA';
export const syntheticUuidVersion4 = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
export const syntheticTimestamp = '2026-10-18T09:30:00.000Z';
export const laterSyntheticTimestamp = '2026-10-18T10:45:00.000Z';
export const syntheticRecordIdentifier = 'record-0001';
export const syntheticTenantIdentifier = 'tenant-1';
export const syntheticProviderVersion = '0123456789abcdef';

// A value that must never appear in a problem document or a log line. Tests
// plant it in input and then search everything the code under test emitted.
export const plantedSecretValue = 'PLANTED-SECRET-7c41f9';

export const syntheticSections = {
  summary: { title: 'Synthetic summary', status: 'active' },
  tasks: {
    entries: [{ taskId: 'task-1', label: 'Synthetic task', done: false }],
  },
  schedule: {
    entries: [
      { startsAt: syntheticTimestamp, endsAt: laterSyntheticTimestamp, label: 'Synthetic slot' },
    ],
  },
  notes: {
    entries: [{ noteId: syntheticUlid, writtenAt: syntheticTimestamp, text: 'Synthetic note' }],
  },
  preferences: { contactWindow: 'morning', language: 'en-GB' },
} as const;

export function syntheticReplaceCommand(): Record<string, unknown> {
  return {
    type: 'record.section.replace',
    recordId: syntheticRecordIdentifier,
    section: 'summary',
    baseVersion: syntheticProviderVersion,
    payload: { title: 'Replacement title', status: 'paused' },
  };
}

export function syntheticAppendCommand(): Record<string, unknown> {
  return {
    type: 'record.notes.append',
    recordId: syntheticRecordIdentifier,
    section: 'notes',
    baseVersion: syntheticProviderVersion,
    payload: { text: 'Appended synthetic note' },
  };
}
