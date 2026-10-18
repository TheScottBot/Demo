import type { ErrorCode, ProblemHandlingLog, ProblemHandlingMetrics } from '../../src/index';

// Spies standing in for the CQ3 logging and metrics interfaces. Each records
// everything it is given, so a test can search all emitted output for a
// planted input value.

export class SpyProblemHandlingLog implements ProblemHandlingLog {
  readonly boundKeys: Record<string, string>[] = [];
  readonly entries: Record<string, unknown>[] = [];
  clearedCount = 0;

  bindRequestKeys(requestKeys: { correlationId: string }): void {
    this.boundKeys.push({ ...requestKeys });
  }

  clearRequestKeys(): void {
    this.clearedCount += 1;
  }

  recordRejection(rejection: {
    errorCode: ErrorCode;
    status: number;
    reasonCategory: string;
  }): void {
    this.entries.push({ kind: 'rejection', ...rejection });
  }

  recordInternalFailure(failure: { errorName: string }): void {
    this.entries.push({ kind: 'internal-failure', ...failure });
  }
}

export class SpyProblemHandlingMetrics implements ProblemHandlingMetrics {
  readonly rejectedErrorCodes: ErrorCode[] = [];

  countRequestRejected(errorCode: ErrorCode): void {
    this.rejectedErrorCodes.push(errorCode);
  }
}
