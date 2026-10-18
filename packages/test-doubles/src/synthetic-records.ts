import {
  commandTypes,
  mockProviderBehaviour,
  mockProviderFaults,
  type CommandRequest,
  type SectionName,
  type SectionsBySectionName,
} from '@demo/contracts';

// The shared synthetic fixtures (Spec 00 §3.7, datum 0.17 item 17). Every
// value is made up and generated from its position, so the set is the same on
// every machine and in every stream. The local mock provider servers (CE4)
// seed from this same set.

export const syntheticTenants = mockProviderBehaviour.seedTenants;

export type SyntheticTenant = (typeof syntheticTenants)[number];

export interface SyntheticRecord {
  readonly tenantId: SyntheticTenant;
  readonly recordId: string;
  readonly updatedAt: string;
  readonly sections: Partial<SectionsBySectionName>;
}

const ordinaryRecordCount = mockProviderBehaviour.seedRecordsPerTenant - mockProviderFaults.length;

// One record per fault prefix, then ordinary records to make up the CU11
// count of 20 per tenant.
const recordIdentifiers: readonly string[] = [
  ...mockProviderFaults.map((fault) => `${fault.prefix}0001`),
  ...Array.from(
    { length: ordinaryRecordCount },
    (_unused, ordinaryIndex) => `record-${String(ordinaryIndex + 1).padStart(4, '0')}`,
  ),
];

// Records whose shape some test depends on: a provider holding nothing of a
// record (provider-c, record-0006) and a record with a single section.
const recordWithoutPreferences = 'record-0006';
const recordWithSummaryOnly = 'record-0007';

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function syntheticTimestamp(position: number): string {
  return `2026-10-${twoDigits(1 + (position % 28))}T${twoDigits(8 + (position % 10))}:${twoDigits((position * 7) % 60)}:00.000Z`;
}

// Digits only after the 01JB prefix: every digit is valid Crockford base 32,
// so the result is a valid ULID without any encoding step.
function syntheticUlid(position: number): string {
  return `01JB${String(position).padStart(22, '0')}`;
}

const contactWindows = ['morning', 'afternoon', 'evening'] as const;
const summaryStatuses = ['active', 'paused', 'closed'] as const;
const languagesByTenant: Record<SyntheticTenant, string> = {
  'tenant-1': 'en-GB',
  'tenant-2': 'cy-GB',
};

function syntheticSections(
  tenantId: SyntheticTenant,
  recordId: string,
  position: number,
): Partial<SectionsBySectionName> {
  const summary: SectionsBySectionName['summary'] = {
    title: `Synthetic summary ${tenantId} ${recordId}`,
    status: summaryStatuses[position % summaryStatuses.length] ?? 'active',
  };
  if (recordId === recordWithSummaryOnly) {
    return { summary };
  }
  const sections: Partial<SectionsBySectionName> = {
    summary,
    tasks: {
      entries: [1, 2].map((taskNumber) => ({
        taskId: `task-${twoDigits(taskNumber)}`,
        label: `Synthetic task ${twoDigits(taskNumber)} for ${tenantId}`,
        done: (position + taskNumber) % 2 === 0,
      })),
    },
    schedule: {
      entries: [
        {
          startsAt: syntheticTimestamp(position + 1),
          endsAt: syntheticTimestamp(position + 2),
          label: `Synthetic slot for ${tenantId}`,
        },
      ],
    },
    notes: {
      entries: [
        {
          noteId: syntheticUlid(position),
          writtenAt: syntheticTimestamp(position),
          text: `Synthetic note for ${tenantId} ${recordId}`,
        },
      ],
    },
  };
  if (recordId !== recordWithoutPreferences) {
    sections.preferences = {
      contactWindow: contactWindows[position % contactWindows.length] ?? 'morning',
      language: position % 5 === 0 ? 'ga-IE' : languagesByTenant[tenantId],
    };
  }
  return sections;
}

export const syntheticRecords: readonly SyntheticRecord[] = syntheticTenants.flatMap(
  (tenantId, tenantIndex) =>
    recordIdentifiers.map((recordId, recordIndex) => {
      const position = tenantIndex * 100 + recordIndex;
      return {
        tenantId,
        recordId,
        updatedAt: syntheticTimestamp(position),
        sections: syntheticSections(tenantId, recordId, position),
      };
    }),
);

export function syntheticRecordsForTenant(tenantId: string): SyntheticRecord[] {
  return syntheticRecords.filter((syntheticRecord) => syntheticRecord.tenantId === tenantId);
}

export function findSyntheticRecord(
  tenantId: string,
  recordId: string,
): SyntheticRecord | undefined {
  return syntheticRecords.find(
    (syntheticRecord) =>
      syntheticRecord.tenantId === tenantId && syntheticRecord.recordId === recordId,
  );
}

const replacementPayloads = {
  summary: { title: 'Synthetic replacement title', status: 'paused' },
  tasks: { entries: [{ taskId: 'task-09', label: 'Synthetic replacement task', done: false }] },
  schedule: {
    entries: [
      {
        startsAt: '2026-10-20T09:00:00.000Z',
        endsAt: '2026-10-20T10:00:00.000Z',
        label: 'Synthetic replacement slot',
      },
    ],
  },
  preferences: { contactWindow: 'evening', language: 'en-GB' },
} as const satisfies Omit<SectionsBySectionName, 'notes'>;

// A valid command for any section: a replace for every section but notes,
// which only takes an append (Spec 00 §4.2).
export function syntheticCommandFor(
  section: SectionName,
  recordId: string,
  baseVersion: string,
): CommandRequest {
  if (section === 'notes') {
    return {
      type: commandTypes.notesAppend,
      recordId,
      section,
      baseVersion,
      payload: { text: 'Synthetic appended note' },
    };
  }
  const replaceFields = { type: commandTypes.sectionReplace, recordId, baseVersion } as const;
  switch (section) {
    case 'summary':
      return { ...replaceFields, section, payload: replacementPayloads.summary };
    case 'tasks':
      return { ...replaceFields, section, payload: replacementPayloads.tasks };
    case 'schedule':
      return { ...replaceFields, section, payload: replacementPayloads.schedule };
    case 'preferences':
      return { ...replaceFields, section, payload: replacementPayloads.preferences };
  }
}
