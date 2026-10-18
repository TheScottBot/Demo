// Spec 01 §4.2 and EE2: the trigger's pure claim mapping. Under EQ3 and EQ5
// a client credentials token takes its tenant from the one tenant scope its
// app client is allowed; a user's token takes it from the tenant attribute.
import { describe, expect, it } from 'vitest';
import {
  TokenClaimMappingError,
  demoPoolTenants,
  mapAccessTokenClaims,
  tenantScopeName,
  type TokenGenerationRequest,
} from '../src/token-claim-mapping';

function clientCredentials(scopes: readonly string[] | undefined): TokenGenerationRequest {
  return { triggerSource: 'TokenGeneration_ClientCredentials', scopes, userAttributes: {} };
}

function userAuthentication(
  userAttributes: Readonly<Record<string, string>>,
  scopes: readonly string[] = ['aws.cognito.signin.user.admin'],
): TokenGenerationRequest {
  return { triggerSource: 'TokenGeneration_Authentication', scopes, userAttributes };
}

function expectRefusal(request: TokenGenerationRequest, reasonCategory: string): void {
  try {
    mapAccessTokenClaims(request);
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(TokenClaimMappingError);
    expect((thrown as TokenClaimMappingError).reasonCategory).toBe(reasonCategory);
    return;
  }
  throw new Error(`expected a refusal: ${reasonCategory}`);
}

describe('the tenant scopes (EQ5)', () => {
  it('are one per synthetic tenant, named for the tenant', () => {
    expect(demoPoolTenants).toEqual(['tenant-1', 'tenant-2']);
    expect(demoPoolTenants.map(tenantScopeName)).toEqual(['tenant:tenant-1', 'tenant:tenant-2']);
  });

  it('fit the scope name grammar Cognito holds a resource server scope to', () => {
    for (const tenantId of demoPoolTenants) {
      expect(tenantScopeName(tenantId)).toMatch(/^[\x21\x23-\x2E\x30-\x5B\x5D-\x7E]+$/);
    }
  });
});

describe('a client credentials token', () => {
  it('takes tenant_id from its tenant scope, and suppresses that scope', () => {
    expect(
      mapAccessTokenClaims(
        clientCredentials(['demo/records:read', 'demo/records:write', 'demo/tenant:tenant-2']),
      ),
    ).toEqual({
      claimsToAddOrOverride: { tenant_id: 'tenant-2' },
      scopesToSuppress: ['demo/tenant:tenant-2'],
    });
  });

  it('leaves the records scopes alone, for readAuthenticationContext to read (EQ6)', () => {
    const overrides = mapAccessTokenClaims(
      clientCredentials(['demo/records:read', 'demo/tenant:tenant-1']),
    );
    expect(overrides.scopesToSuppress).not.toContain('demo/records:read');
    expect(overrides).not.toHaveProperty('scopesToAdd');
  });

  it.each([
    ['no scopes at all', undefined, 'tenant-scope-missing'],
    ['no tenant scope', ['demo/records:read'], 'tenant-scope-missing'],
    [
      'two tenant scopes',
      ['demo/tenant:tenant-1', 'demo/tenant:tenant-2'],
      'tenant-scope-ambiguous',
    ],
    ['a tenant scope outside the grammar', ['demo/tenant:tenant.1'], 'tenant-scope-invalid'],
    ['an empty tenant', ['demo/tenant:'], 'tenant-scope-invalid'],
    ['a tenant of 65 characters', [`demo/tenant:${'t'.repeat(65)}`], 'tenant-scope-invalid'],
  ])('is refused with %s', (_caseName, scopes, reasonCategory) => {
    expectRefusal(clientCredentials(scopes), reasonCategory);
  });

  it('does not take a tenant from another resource server, or from the bare name', () => {
    expectRefusal(clientCredentials(['other/tenant:tenant-1']), 'tenant-scope-missing');
    expectRefusal(clientCredentials(['tenant:tenant-1']), 'tenant-scope-missing');
  });

  it('ignores a tenant attribute, since a client has no user', () => {
    expectRefusal(
      {
        triggerSource: 'TokenGeneration_ClientCredentials',
        scopes: ['demo/records:read'],
        userAttributes: { 'custom:tenant_id': 'tenant-1' },
      },
      'tenant-scope-missing',
    );
  });
});

describe("a user's token (§4.2)", () => {
  it.each([
    'TokenGeneration_HostedAuth',
    'TokenGeneration_Authentication',
    'TokenGeneration_NewPasswordChallenge',
    'TokenGeneration_AuthenticateDevice',
    'TokenGeneration_RefreshTokens',
  ])('copies the tenant attribute into tenant_id on %s', (triggerSource) => {
    expect(
      mapAccessTokenClaims({
        triggerSource,
        scopes: ['aws.cognito.signin.user.admin'],
        userAttributes: { 'custom:tenant_id': 'tenant-1' },
      }),
    ).toEqual({ claimsToAddOrOverride: { tenant_id: 'tenant-1' }, scopesToSuppress: [] });
  });

  it('is refused without the attribute, or with one outside the grammar', () => {
    expectRefusal(userAuthentication({}), 'tenant-attribute-missing');
    expectRefusal(
      userAuthentication({ 'custom:tenant_id': 'tenant 1' }),
      'tenant-attribute-invalid',
    );
  });

  it('is refused if it carries a tenant scope, which only an app client is allowed', () => {
    expectRefusal(
      userAuthentication({ 'custom:tenant_id': 'tenant-1' }, ['demo/tenant:tenant-2']),
      'tenant-scope-on-user-token',
    );
  });
});

describe('a refusal', () => {
  it('carries no input value, only its reason (CD5)', () => {
    try {
      mapAccessTokenClaims(clientCredentials(['demo/tenant:secret value']));
    } catch (thrown) {
      expect((thrown as Error).message).toBe('token-claim-mapping-refused: tenant-scope-invalid');
      return;
    }
    throw new Error('expected a refusal');
  });
});
