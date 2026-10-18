import { describe, expect, it } from 'vitest';
import {
  ProviderIdentifierSchema,
  commandTypeForSection,
  owningProviderForSection,
  publicRoutes,
  scopeNames,
  scopeResourceServerIdentifier,
  sectionRoutingTable,
  sectionsOwnedByProvider,
} from '../src/index';

describe('the section routing table', () => {
  it('holds exactly the Spec 00 §4.2 rows', () => {
    expect(sectionRoutingTable).toEqual([
      {
        section: 'summary',
        owningProvider: 'provider-a',
        readable: true,
        writeCommandType: 'record.section.replace',
      },
      {
        section: 'tasks',
        owningProvider: 'provider-a',
        readable: true,
        writeCommandType: 'record.section.replace',
      },
      {
        section: 'schedule',
        owningProvider: 'provider-b',
        readable: true,
        writeCommandType: 'record.section.replace',
      },
      {
        section: 'notes',
        owningProvider: 'provider-b',
        readable: true,
        writeCommandType: 'record.notes.append',
      },
      {
        section: 'preferences',
        owningProvider: 'provider-c',
        readable: true,
        writeCommandType: 'record.section.replace',
      },
    ]);
  });

  it('gives every section exactly one owning provider', () => {
    const sectionNames = sectionRoutingTable.map((routingRow) => routingRow.section);
    expect(new Set(sectionNames).size).toBe(sectionNames.length);
  });

  it('answers ownership both ways', () => {
    expect(owningProviderForSection('notes')).toBe('provider-b');
    expect(sectionsOwnedByProvider('provider-a')).toEqual(['summary', 'tasks']);
    expect(sectionsOwnedByProvider('provider-b')).toEqual(['schedule', 'notes']);
    expect(sectionsOwnedByProvider('provider-c')).toEqual(['preferences']);
    expect(commandTypeForSection('notes')).toBe('record.notes.append');
    expect(commandTypeForSection('summary')).toBe('record.section.replace');
  });

  it('derives the provider identifiers from the table', () => {
    expect(ProviderIdentifierSchema.options).toEqual(['provider-a', 'provider-b', 'provider-c']);
  });

  // Secrets Manager appends a hyphen and six characters to a secret's ARN, and
  // warns against names that already end that way (CU8). Provider identifiers
  // end secret names, so none may.
  it('has no provider identifier ending in a hyphen followed by six characters', () => {
    for (const providerIdentifier of ProviderIdentifierSchema.options) {
      expect(providerIdentifier).not.toMatch(/-[^-]{6}$/);
    }
  });
});

describe('the public routes', () => {
  it('are exactly the three Spec 00 §3.2 routes', () => {
    expect(publicRoutes).toEqual([
      {
        method: 'GET',
        path: '/v1/records/{recordId}',
        handlerOwner: 'spec-02-read-handler',
        successStatuses: [200, 304],
        scopeRule: { kind: 'scope', requiredScope: 'records:read' },
      },
      {
        method: 'POST',
        path: '/v1/commands',
        handlerOwner: 'spec-03-command-handler',
        successStatuses: [202],
        scopeRule: { kind: 'scope', requiredScope: 'records:write' },
      },
      {
        method: 'GET',
        path: '/v1/operations/{operationId}',
        handlerOwner: 'spec-03-status-handler',
        successStatuses: [200],
        // Contract 1.1.0, WQ8: the scope Spec 03 WD4 decided, replacing the
        // 1.0.0 entry that named the open decision.
        scopeRule: { kind: 'scope', requiredScope: 'records:write' },
      },
    ]);
  });

  it('all sit under the version prefix', () => {
    for (const publicRoute of publicRoutes) {
      expect(publicRoute.path.startsWith('/v1/')).toBe(true);
    }
  });

  it('name the two scopes', () => {
    expect(scopeNames).toEqual({ recordsRead: 'records:read', recordsWrite: 'records:write' });
  });

  // Contract 1.2.0, EQ6: the identifier Spec 01's resource server carries.
  it('name the resource server that issues them', () => {
    expect(scopeResourceServerIdentifier).toBe('demo');
  });
});
