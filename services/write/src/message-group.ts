import { createHash } from 'node:crypto';

// Spec 03 §5.2: the SQS message group. Commands for one record share a group,
// so they apply in order, while different records run in parallel. Hashing
// keeps the group within SQS's 128 character limit (WU22: 64 here) whatever
// the identifiers' lengths, and keeps them out of SQS's own records. This
// module is pure.
export function messageGroupFor(tenantId: string, recordId: string): string {
  return createHash('sha256').update(`${tenantId}#${recordId}`, 'utf8').digest('hex');
}
