import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { authenticationClaimBounds, contractBounds } from './bounds';
import { DemoError } from './errors';
import { TenantIdentifierSchema, scopeNamePattern } from './grammars';
import { scopeNames, scopeResourceServerIdentifier, type ScopeName } from './routing';

// Spec 00 §3.5. The gateway verifies the token (Spec 01); handlers trust the
// claims it passes and never verify the token again. They still bound and
// check each claim, because a claim the gateway passed is not a claim the
// platform has checked against its own contract.

export interface AuthenticationContext {
  // The sub claim. Personal data: never logged (CD5).
  readonly subject: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
}

function refuseClaim(reasonCategory: string): never {
  throw new DemoError('unauthorised', reasonCategory);
}

// CU4 is unsettled: no AWS page states how the gateway renders the scope
// claim, and the family runs locally, so the experiment is not run. Both a
// space separated string (RFC 6749 §3.3, as Cognito issues it) and a list of
// names are therefore read, each held to the same bound and grammar.
function readScopes(scopeClaim: unknown): string[] {
  if (typeof scopeClaim === 'string') {
    if (scopeClaim.length > contractBounds.scopeClaimMaximumCharacters) {
      refuseClaim('scope-claim-too-long');
    }
    return scopeClaim === '' ? [] : scopeClaim.split(' ').map(checkedScopeName);
  }
  if (Array.isArray(scopeClaim)) {
    const scopeNames: unknown[] = scopeClaim;
    const joinedLength = scopeNames.reduce<number>(
      (runningLength, scopeName) =>
        runningLength + (typeof scopeName === 'string' ? scopeName.length : 0),
      Math.max(scopeNames.length - 1, 0),
    );
    if (joinedLength > contractBounds.scopeClaimMaximumCharacters) {
      refuseClaim('scope-claim-too-long');
    }
    return scopeNames.map(checkedScopeName);
  }
  return refuseClaim(scopeClaim === undefined ? 'scope-claim-missing' : 'scope-claim-wrong-type');
}

// Contract 1.2.0, EQ6: exactly the resource server form of a contract scope
// is read as that scope; any other name, prefixed or not, is kept as it is.
const contractScopeByResourceServerForm: ReadonlyMap<string, ScopeName> = new Map(
  Object.values(scopeNames).map((scopeName) => [
    `${scopeResourceServerIdentifier}/${scopeName}`,
    scopeName,
  ]),
);

function checkedScopeName(scopeName: unknown): string {
  if (typeof scopeName !== 'string' || !scopeNamePattern.test(scopeName)) {
    refuseClaim('scope-name-outside-grammar');
  }
  return contractScopeByResourceServerForm.get(scopeName) ?? scopeName;
}

function childObject(parent: unknown, key: string): Readonly<Record<string, unknown>> | undefined {
  if (typeof parent !== 'object' || parent === null) {
    return undefined;
  }
  const child: unknown = (parent as Readonly<Record<string, unknown>>)[key];
  return typeof child === 'object' && child !== null && !Array.isArray(child)
    ? (child as Readonly<Record<string, unknown>>)
    : undefined;
}

export function readAuthenticationContext(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): AuthenticationContext {
  // The declared types say these are present; the event comes from outside
  // the process, so each level is checked rather than assumed.
  const claims = childObject(
    childObject(childObject(event.requestContext, 'authorizer'), 'jwt'),
    'claims',
  );
  if (claims === undefined) {
    return refuseClaim('authoriser-context-missing');
  }
  const subjectClaim = claims['sub'];
  if (typeof subjectClaim !== 'string' || subjectClaim.length === 0) {
    refuseClaim(subjectClaim === undefined ? 'subject-claim-missing' : 'subject-claim-invalid');
  }
  if (subjectClaim.length > authenticationClaimBounds.subjectClaimMaximumCharacters) {
    refuseClaim('subject-claim-too-long');
  }
  const tenantClaim = claims['tenant_id'];
  if (tenantClaim === undefined) {
    refuseClaim('tenant-claim-missing');
  }
  const parsedTenant = TenantIdentifierSchema.safeParse(tenantClaim);
  if (!parsedTenant.success) {
    return refuseClaim('tenant-claim-invalid');
  }
  return {
    subject: subjectClaim,
    tenantId: parsedTenant.data,
    scopes: readScopes(claims['scope']),
  };
}

export function requireScope(
  authenticationContext: AuthenticationContext,
  requiredScope: ScopeName,
): void {
  if (!authenticationContext.scopes.includes(requiredScope)) {
    throw new DemoError('forbidden', 'scope-missing');
  }
}
