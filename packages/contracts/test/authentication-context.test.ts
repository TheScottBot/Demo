import { describe, expect, it } from 'vitest';
import { DemoError, readAuthenticationContext, requireScope } from '../src/index';
import {
  defaultVerifiedClaims,
  verifiedClaimsEvent,
  type JwtClaims,
} from './support/verified-claims-event';

function expectDemoError(action: () => unknown, errorCode: string): void {
  try {
    action();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(DemoError);
    expect((thrown as DemoError).errorCode).toBe(errorCode);
    return;
  }
  throw new Error(`expected a DemoError ${errorCode}`);
}

describe('readAuthenticationContext', () => {
  it('reads the subject, tenant and space separated scopes', () => {
    expect(readAuthenticationContext(verifiedClaimsEvent())).toEqual({
      subject: 'synthetic-subject-0001',
      tenantId: 'tenant-1',
      scopes: ['records:read', 'records:write'],
    });
  });

  // CU4 is unsettled: how the gateway renders the scope claim was not observed,
  // so both renderings are read (see the evaluation record).
  it('reads scopes delivered as a list', () => {
    const event = verifiedClaimsEvent({
      claims: { ...defaultVerifiedClaims(), scope: ['records:read'] },
    });
    expect(readAuthenticationContext(event).scopes).toEqual(['records:read']);
  });

  it('reads an empty scope claim as no scopes, leaving the refusal to requireScope', () => {
    const event = verifiedClaimsEvent({ claims: { ...defaultVerifiedClaims(), scope: '' } });
    expect(readAuthenticationContext(event).scopes).toEqual([]);
  });

  it.each([
    ['a missing sub', { sub: undefined }],
    ['an empty sub', { sub: '' }],
    ['a numeric sub', { sub: 42 }],
    ['a missing tenant_id', { tenant_id: undefined }],
    ['a tenant_id of 65 characters', { tenant_id: 't'.repeat(65) }],
    ['a tenant_id outside the grammar', { tenant_id: 'tenant.1' }],
    ['a missing scope', { scope: undefined }],
    ['a scope of 1,025 characters', { scope: 'a'.repeat(1_025) }],
    ['a scope list totalling 1,025 characters', { scope: ['a'.repeat(512), 'b'.repeat(512)] }],
    ['a scope with a doubled space', { scope: 'records:read  records:write' }],
    ['a scope with a leading space', { scope: ' records:read' }],
    ['a scope name with a quotation mark', { scope: 'records:"read"' }],
    ['a boolean scope', { scope: true }],
  ])('refuses %s as unauthorised', (_caseName, claimOverride) => {
    const claims: Record<string, unknown> = { ...defaultVerifiedClaims(), ...claimOverride };
    for (const [claimName, claimValue] of Object.entries(claims)) {
      if (claimValue === undefined) {
        Reflect.deleteProperty(claims, claimName);
      }
    }
    // Deliberately outside the declared claim types: the gateway's rendering is
    // not trusted to match them (CU3, CU4).
    const event = verifiedClaimsEvent({ claims: claims as JwtClaims });
    expectDemoError(() => readAuthenticationContext(event), 'unauthorised');
  });

  it('refuses an event with no authoriser context as unauthorised', () => {
    const event = verifiedClaimsEvent();
    Reflect.deleteProperty(event.requestContext, 'authorizer');
    expectDemoError(() => readAuthenticationContext(event), 'unauthorised');
  });
});

describe('requireScope', () => {
  const authenticationContext = {
    subject: 'synthetic-subject-0001',
    tenantId: 'tenant-1',
    scopes: ['records:read'],
  };

  it('passes when the scope is held', () => {
    expect(() => {
      requireScope(authenticationContext, 'records:read');
    }).not.toThrow();
  });

  it('refuses a missing scope as forbidden', () => {
    expectDemoError(() => {
      requireScope(authenticationContext, 'records:write');
    }, 'forbidden');
  });

  it('does not accept a scope that merely starts with the required one', () => {
    expectDemoError(() => {
      requireScope({ ...authenticationContext, scopes: ['records:readx'] }, 'records:read');
    }, 'forbidden');
  });
});
