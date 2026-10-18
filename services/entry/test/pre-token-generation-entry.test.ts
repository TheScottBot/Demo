// Spec 01 §4.2 and EE2: the trigger's entry point puts the pure mapping's
// result where a V3_0 response carries it, and refuses by throwing, which
// makes Cognito refuse the token.
import { describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/pre-token-generation-entry';

function triggerEvent(scopes: string[]): Parameters<typeof handler>[0] {
  return {
    version: '3',
    triggerSource: 'TokenGeneration_ClientCredentials',
    region: 'eu-west-2',
    userPoolId: 'eu-west-2_synthetic',
    userName: 'synthetic-client',
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'synthetic-client-id' },
    request: { userAttributes: {}, groupConfiguration: {}, scopes },
    response: { claimsAndScopeOverrideDetails: {} },
  };
}

describe('the pre token generation entry point', () => {
  it('answers with the access token overrides alone', async () => {
    const answered = await handler(triggerEvent(['demo/records:read', 'demo/tenant:tenant-1']));
    expect(answered.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: { tenant_id: 'tenant-1' },
          scopesToSuppress: ['demo/tenant:tenant-1'],
        },
      },
    });
  });

  it('keeps the rest of the event as Cognito sent it', async () => {
    const sent = triggerEvent(['demo/tenant:tenant-2']);
    const answered = await handler(sent);
    expect(answered.request).toEqual(sent.request);
    expect(answered.callerContext).toEqual(sent.callerContext);
  });

  it('throws when the mapping refuses, so no token is issued', async () => {
    await expect(handler(triggerEvent(['demo/records:read']))).rejects.toThrow(
      'token-claim-mapping-refused: tenant-scope-missing',
    );
  });
});
