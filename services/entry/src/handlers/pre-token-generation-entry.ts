import type {
  PreTokenGenerationV2TriggerEvent,
  PreTokenGenerationV3TriggerEvent,
} from 'aws-lambda';
import { mapAccessTokenClaims } from '../token-claim-mapping';

// The bundled entry point of the pre token generation trigger (Spec 01 §4.2),
// on the V3_0 event (EU6). It reads no configuration and logs nothing: the
// event holds the client's scopes and the user's attributes, and a refusal
// thrown here makes Cognito refuse the token.

type TokenGenerationEvent = PreTokenGenerationV2TriggerEvent | PreTokenGenerationV3TriggerEvent;

export const handler = (event: TokenGenerationEvent): Promise<TokenGenerationEvent> =>
  // A refusal rejects the promise rather than throwing before it exists.
  Promise.resolve().then(() => answer(event));

function answer(event: TokenGenerationEvent): TokenGenerationEvent {
  const accessTokenGeneration = mapAccessTokenClaims({
    triggerSource: event.triggerSource,
    scopes: event.request.scopes,
    userAttributes: event.request.userAttributes,
  });
  return {
    ...event,
    response: {
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: { ...accessTokenGeneration.claimsToAddOrOverride },
          scopesToSuppress: [...accessTokenGeneration.scopesToSuppress],
        },
      },
    },
  };
}
