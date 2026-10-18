import type { OperationState } from '@demo/contracts';

// Spec 03 §7 as data. The journal store takes every transition's allowed
// sources from this table, so a transition missing here cannot be made, and
// is a defect (§7). This module is pure: it imports only types.

// The surfaces that may change an operation (§4.3, datum 0.14). Every
// transition names one, so the journal says which surface acted.
export const transitionOrigins = ['intake', 'relay', 'sweep', 'worker', 'operator'] as const;

export type TransitionOrigin = (typeof transitionOrigins)[number];

interface OperationTransition {
  readonly sourceStates: readonly OperationState[];
  readonly targetState: OperationState;
  readonly origins: readonly TransitionOrigin[];
  // §6.3 step 4: every move to APPLYING is an attempt.
  readonly addAttempt: boolean;
  // §8.2 step 1: a redrive is counted.
  readonly addRedrive: boolean;
}

// APPLYING is a source of both operator rows, because a worker that times out
// on its last receive leaves the operation there while SQS moves the message
// (WU18).
// single-definition: the source states of §7's operator rows, not the state list.
const operatorSourceStates: readonly OperationState[] = ['DEAD_LETTERED', 'APPLYING'];

// none to ACCEPTED, by intake, is not a transition: intake creates the
// operation with a conditional put (§4), so ACCEPTED has no source here.
const operationTransitions: readonly OperationTransition[] = [
  {
    sourceStates: ['ACCEPTED'],
    targetState: 'QUEUED',
    origins: ['relay', 'sweep'],
    addAttempt: false,
    addRedrive: false,
  },
  {
    // ACCEPTED, because the sweep can send before the relay's own
    // transition lands; APPLYING, when received again after a retryable
    // outcome (§6.3 step 4).
    // single-definition: the source states of one §7 row, not the state list.
    sourceStates: ['ACCEPTED', 'QUEUED', 'APPLYING'],
    targetState: 'APPLYING',
    origins: ['worker'],
    addAttempt: true,
    addRedrive: false,
  },
  // single-definition: the worker's outcome states of §6.3, not the state list.
  ...(['SUCCEEDED', 'CONFLICT', 'FAILED', 'DEAD_LETTERED'] as const).map((targetState) => ({
    sourceStates: ['APPLYING'] as const,
    targetState,
    origins: ['worker'] as const,
    addAttempt: false,
    addRedrive: false,
  })),
  {
    sourceStates: operatorSourceStates,
    targetState: 'QUEUED',
    origins: ['operator'],
    addAttempt: false,
    addRedrive: true,
  },
  {
    sourceStates: operatorSourceStates,
    targetState: 'FAILED',
    origins: ['operator'],
    addAttempt: false,
    addRedrive: false,
  },
];

function transitionFor(
  targetState: OperationState,
  origin: TransitionOrigin,
): OperationTransition | undefined {
  return operationTransitions.find(
    (transition) => transition.targetState === targetState && transition.origins.includes(origin),
  );
}

export function allowedSourceStates(
  targetState: OperationState,
  origin: TransitionOrigin,
): readonly OperationState[] {
  return transitionFor(targetState, origin)?.sourceStates ?? [];
}

export function isTransitionAllowed(
  sourceState: OperationState,
  targetState: OperationState,
  origin: TransitionOrigin,
): boolean {
  return allowedSourceStates(targetState, origin).includes(sourceState);
}

export function transitionEffects(
  targetState: OperationState,
  origin: TransitionOrigin,
): { addAttempt: boolean; addRedrive: boolean } {
  const transition = transitionFor(targetState, origin);
  return {
    addAttempt: transition?.addAttempt ?? false,
    addRedrive: transition?.addRedrive ?? false,
  };
}
