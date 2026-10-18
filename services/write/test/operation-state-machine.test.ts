// Spec 03 §7 and WE1: the operation state machine, held as data.
import { OperationStateSchema, type OperationState } from '@demo/contracts';
import { describe, expect, it } from 'vitest';
import {
  allowedSourceStates,
  isTransitionAllowed,
  transitionEffects,
  transitionOrigins,
  type TransitionOrigin,
} from '../src/operation-state-machine';

// §7 restated here on purpose: the test is the specification's table, kept
// apart from the module's, so a change to either alone fails.
const specifiedTransitions: readonly [OperationState, OperationState, TransitionOrigin][] = [
  ['ACCEPTED', 'QUEUED', 'relay'],
  ['ACCEPTED', 'QUEUED', 'sweep'],
  ['ACCEPTED', 'APPLYING', 'worker'],
  ['QUEUED', 'APPLYING', 'worker'],
  ['APPLYING', 'APPLYING', 'worker'],
  ['APPLYING', 'SUCCEEDED', 'worker'],
  ['APPLYING', 'CONFLICT', 'worker'],
  ['APPLYING', 'FAILED', 'worker'],
  ['APPLYING', 'DEAD_LETTERED', 'worker'],
  ['DEAD_LETTERED', 'QUEUED', 'operator'],
  ['APPLYING', 'QUEUED', 'operator'],
  ['DEAD_LETTERED', 'FAILED', 'operator'],
  ['APPLYING', 'FAILED', 'operator'],
];

const everyState = OperationStateSchema.options;

describe('the operation state machine (§7)', () => {
  it('names the five origins of datum 0.14 and §4.3', () => {
    expect([...transitionOrigins]).toEqual(['intake', 'relay', 'sweep', 'worker', 'operator']);
  });

  it('allows every transition in §7 and refuses every other source, target and origin', () => {
    const allowed: string[] = [];
    for (const sourceState of everyState) {
      for (const targetState of everyState) {
        for (const origin of transitionOrigins) {
          if (isTransitionAllowed(sourceState, targetState, origin)) {
            allowed.push([sourceState, targetState, origin].join(' '));
          }
        }
      }
    }
    expect(allowed.sort()).toEqual(
      specifiedTransitions.map((transition) => transition.join(' ')).sort(),
    );
  });

  it('gives a transition its sources by target and origin, so the store can condition on them', () => {
    expect(allowedSourceStates('APPLYING', 'worker')).toEqual(['ACCEPTED', 'QUEUED', 'APPLYING']);
    expect(allowedSourceStates('QUEUED', 'relay')).toEqual(['ACCEPTED']);
    expect(allowedSourceStates('QUEUED', 'operator')).toEqual(['DEAD_LETTERED', 'APPLYING']);
    expect(allowedSourceStates('FAILED', 'operator')).toEqual(['DEAD_LETTERED', 'APPLYING']);
  });

  it('has no source for ACCEPTED: only intake creates it, by a conditional put (§4)', () => {
    for (const origin of transitionOrigins) {
      expect(allowedSourceStates('ACCEPTED', origin)).toEqual([]);
    }
  });

  it('adds an attempt on every move to APPLYING, and a redrive on the operator move to QUEUED', () => {
    expect(transitionEffects('APPLYING', 'worker')).toEqual({
      addAttempt: true,
      addRedrive: false,
    });
    expect(transitionEffects('QUEUED', 'operator')).toEqual({
      addAttempt: false,
      addRedrive: true,
    });
    expect(transitionEffects('QUEUED', 'relay')).toEqual({ addAttempt: false, addRedrive: false });
    expect(transitionEffects('FAILED', 'operator')).toEqual({
      addAttempt: false,
      addRedrive: false,
    });
  });
});
