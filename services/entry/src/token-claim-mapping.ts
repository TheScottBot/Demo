import { TenantIdentifierSchema, scopeResourceServerIdentifier } from '@demo/contracts';

// Spec 01 §4.2: the pre token generation trigger's claim mapping, kept pure.
// Every handler refuses a token without tenant_id (Spec 00 §3.5), so the
// mapping refuses rather than issue one.
//
// EQ3, answered 18 October 2026: one app client per tenant. EQ5, answered the
// same day: the client's tenant comes from the one tenant scope its app client
// is allowed, so the trigger holds no table of client identifiers, and the
// pool, trigger and clients form no dependency cycle. A user's tenant comes
// from the tenant attribute, as §4.2 states.

export const demoPoolTenants = ['tenant-1', 'tenant-2'] as const;

export const tenantAttributeName = 'tenant_id';

const tenantScopePrefix = 'tenant:';

// The scope's name on the resource server; a token carries it as the resource
// server identifier, a slash and this name.
export function tenantScopeName(tenantId: string): string {
  return `${tenantScopePrefix}${tenantId}`;
}

const issuedTenantScopePrefix = `${scopeResourceServerIdentifier}/${tenantScopePrefix}`;

export interface TokenGenerationRequest {
  readonly triggerSource: string;
  readonly scopes: readonly string[] | undefined;
  readonly userAttributes: Readonly<Record<string, string>>;
}

export interface AccessTokenOverrides {
  readonly claimsToAddOrOverride: { readonly tenant_id: string };
  readonly scopesToSuppress: readonly string[];
}

// Carries the reason alone: never a scope, attribute or other input value
// (Spec 00 CD5).
export class TokenClaimMappingError extends Error {
  readonly reasonCategory: string;

  constructor(reasonCategory: string) {
    super(`token-claim-mapping-refused: ${reasonCategory}`);
    this.name = 'TokenClaimMappingError';
    this.reasonCategory = reasonCategory;
  }
}

function refuse(reasonCategory: string): never {
  throw new TokenClaimMappingError(reasonCategory);
}

export function mapAccessTokenClaims(request: TokenGenerationRequest): AccessTokenOverrides {
  const tenantScopes = (request.scopes ?? []).filter((scope) =>
    scope.startsWith(issuedTenantScopePrefix),
  );
  if (request.triggerSource !== 'TokenGeneration_ClientCredentials') {
    if (tenantScopes.length > 0) {
      refuse('tenant-scope-on-user-token');
    }
    const tenantAttribute = request.userAttributes[`custom:${tenantAttributeName}`];
    if (tenantAttribute === undefined) {
      refuse('tenant-attribute-missing');
    }
    const parsedTenant = TenantIdentifierSchema.safeParse(tenantAttribute);
    if (!parsedTenant.success) {
      refuse('tenant-attribute-invalid');
    }
    return { claimsToAddOrOverride: { tenant_id: parsedTenant.data }, scopesToSuppress: [] };
  }
  const [tenantScope, ...furtherTenantScopes] = tenantScopes;
  if (tenantScope === undefined) {
    refuse('tenant-scope-missing');
  }
  if (furtherTenantScopes.length > 0) {
    refuse('tenant-scope-ambiguous');
  }
  const parsedTenant = TenantIdentifierSchema.safeParse(
    tenantScope.slice(issuedTenantScopePrefix.length),
  );
  if (!parsedTenant.success) {
    refuse('tenant-scope-invalid');
  }
  // The tenant scope only says which tenant the client serves; it grants
  // nothing, so it is kept out of the token's scope claim.
  return {
    claimsToAddOrOverride: { tenant_id: parsedTenant.data },
    scopesToSuppress: [tenantScope],
  };
}
