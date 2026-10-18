import { describe, expect, it } from 'vitest';
import { OperationStateSchema, OperationStatusSchema, operationStateKind } from '../src/index';
import {
  syntheticProviderVersion,
  syntheticRecordIdentifier,
  syntheticTimestamp,
  syntheticUlid,
} from './support/synthetic-values';

const acceptedOperation = {
  operationId: syntheticUlid,
  state: 'ACCEPTED',
  recordId: syntheticRecordIdentifier,
  providerId: 'provider-b',
  attempts: 0,
  createdAt: syntheticTimestamp,
  updatedAt: syntheticTimestamp,
};

describe('operation states', () => {
  it('are exactly the Spec 00 §3.10 states', () => {
    expect(OperationStateSchema.options).toEqual([
      'ACCEPTED',
      'QUEUED',
      'APPLYING',
      'SUCCEEDED',
      'CONFLICT',
      'FAILED',
      'DEAD_LETTERED',
    ]);
  });

  it.each([
    ['ACCEPTED', 'in-progress'],
    ['QUEUED', 'in-progress'],
    ['APPLYING', 'in-progress'],
    ['DEAD_LETTERED', 'awaiting-operator'],
    ['SUCCEEDED', 'terminal'],
    ['CONFLICT', 'terminal'],
    ['FAILED', 'terminal'],
  ] as const)('classes %s as %s', (state, expectedKind) => {
    expect(operationStateKind(state)).toBe(expectedKind);
  });
});

describe('OperationStatus', () => {
  it.each([
    ['an accepted operation', acceptedOperation],
    [
      'a success with its result',
      {
        ...acceptedOperation,
        state: 'SUCCEEDED',
        result: { providerVersion: syntheticProviderVersion },
      },
    ],
    [
      'a conflict with its detail',
      { ...acceptedOperation, state: 'CONFLICT', conflict: { reason: 'stale-base-version' } },
    ],
    [
      'a failure with its detail',
      {
        ...acceptedOperation,
        state: 'FAILED',
        failure: { code: 'rejected', reason: 'provider-rejected' },
      },
    ],
    [
      'a dead letter with its detail',
      {
        ...acceptedOperation,
        state: 'DEAD_LETTERED',
        failure: { code: 'poison', reason: 'retries-exhausted' },
      },
    ],
  ])('accepts %s', (_caseName, candidate) => {
    expect(OperationStatusSchema.safeParse(candidate).success).toBe(true);
  });

  it.each([
    ['a success without its result', { ...acceptedOperation, state: 'SUCCEEDED' }],
    [
      'a result on a conflict',
      {
        ...acceptedOperation,
        state: 'CONFLICT',
        conflict: { reason: 'x' },
        result: { providerVersion: 'v1' },
      },
    ],
    ['a conflict without its detail', { ...acceptedOperation, state: 'CONFLICT' }],
    ['a failure without its detail', { ...acceptedOperation, state: 'FAILED' }],
    [
      'a failure detail on an accepted operation',
      { ...acceptedOperation, failure: { code: 'x', reason: 'y' } },
    ],
    ['an unknown state', { ...acceptedOperation, state: 'CANCELLED' }],
    [
      'a lower case operationId',
      { ...acceptedOperation, operationId: syntheticUlid.toLowerCase() },
    ],
    ['negative attempts', { ...acceptedOperation, attempts: -1 }],
    ['an unknown key', { ...acceptedOperation, payload: {} }],
  ])('refuses %s', (_caseName, candidate) => {
    expect(OperationStatusSchema.safeParse(candidate).success).toBe(false);
  });
});
