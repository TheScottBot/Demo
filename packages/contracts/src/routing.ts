import { z } from 'zod';
import type { SectionName } from './sections';

export const commandTypes = {
  sectionReplace: 'record.section.replace',
  notesAppend: 'record.notes.append',
} as const;

export type CommandType = (typeof commandTypes)[keyof typeof commandTypes];

export const providerIdentifiers = ['provider-a', 'provider-b', 'provider-c'] as const;

export const ProviderIdentifierSchema = z.enum(providerIdentifiers);

export type ProviderIdentifier = z.infer<typeof ProviderIdentifierSchema>;

export interface SectionRoutingRow {
  readonly section: SectionName;
  readonly owningProvider: ProviderIdentifier;
  readonly readable: boolean;
  readonly writeCommandType: CommandType;
}

// Spec 00 §4.2: the single source for read fan-out and write routing. Each
// section has exactly one owner, so a read merge never chooses between
// competing values and one command touches exactly one provider.
export const sectionRoutingTable: readonly SectionRoutingRow[] = [
  {
    section: 'summary',
    owningProvider: 'provider-a',
    readable: true,
    writeCommandType: commandTypes.sectionReplace,
  },
  {
    section: 'tasks',
    owningProvider: 'provider-a',
    readable: true,
    writeCommandType: commandTypes.sectionReplace,
  },
  {
    section: 'schedule',
    owningProvider: 'provider-b',
    readable: true,
    writeCommandType: commandTypes.sectionReplace,
  },
  {
    section: 'notes',
    owningProvider: 'provider-b',
    readable: true,
    writeCommandType: commandTypes.notesAppend,
  },
  {
    section: 'preferences',
    owningProvider: 'provider-c',
    readable: true,
    writeCommandType: commandTypes.sectionReplace,
  },
];

function routingRowForSection(section: SectionName): SectionRoutingRow {
  const routingRow = sectionRoutingTable.find((candidateRow) => candidateRow.section === section);
  if (routingRow === undefined) {
    // Unreachable while the table lists every SectionName; the routing tests
    // prove it does.
    throw new Error(`section-not-routed: ${section}`);
  }
  return routingRow;
}

export function owningProviderForSection(section: SectionName): ProviderIdentifier {
  return routingRowForSection(section).owningProvider;
}

export function commandTypeForSection(section: SectionName): CommandType {
  return routingRowForSection(section).writeCommandType;
}

export function sectionsOwnedByProvider(providerIdentifier: ProviderIdentifier): SectionName[] {
  return sectionRoutingTable
    .filter((routingRow) => routingRow.owningProvider === providerIdentifier)
    .map((routingRow) => routingRow.section);
}

export const scopeNames = {
  recordsRead: 'records:read',
  recordsWrite: 'records:write',
} as const;

export type ScopeName = (typeof scopeNames)[keyof typeof scopeNames];

// Contract 1.2.0, EQ6: Cognito issues a custom scope as its resource server's
// identifier, a slash and the scope name. Spec 01's demo pool names its
// resource server this, and readAuthenticationContext reads that form of the
// two scopes above as the scopes themselves.
export const scopeResourceServerIdentifier = 'demo';

export type RouteScopeRule =
  | { readonly kind: 'scope'; readonly requiredScope: ScopeName }
  // Used in 1.0.0 while Spec 03 WD4 was open. No route has used it since 1.1.0;
  // it stays so the type does not narrow within the 1.x versions.
  | { readonly kind: 'decided-by'; readonly decision: 'Spec 03 WD4' };

export interface PublicRoute {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly handlerOwner:
    'spec-02-read-handler' | 'spec-03-command-handler' | 'spec-03-status-handler';
  readonly successStatuses: readonly number[];
  readonly scopeRule: RouteScopeRule;
}

// Spec 00 §3.2: exactly these three routes.
export const publicRoutes: readonly PublicRoute[] = [
  {
    method: 'GET',
    path: '/v1/records/{recordId}',
    handlerOwner: 'spec-02-read-handler',
    successStatuses: [200, 304],
    scopeRule: { kind: 'scope', requiredScope: scopeNames.recordsRead },
  },
  {
    method: 'POST',
    path: '/v1/commands',
    handlerOwner: 'spec-03-command-handler',
    successStatuses: [202],
    scopeRule: { kind: 'scope', requiredScope: scopeNames.recordsWrite },
  },
  {
    method: 'GET',
    path: '/v1/operations/{operationId}',
    handlerOwner: 'spec-03-status-handler',
    successStatuses: [200],
    // Spec 03 WD4, answered 18 October 2026; in the contract from 1.1.0 (WQ8).
    scopeRule: { kind: 'scope', requiredScope: scopeNames.recordsWrite },
  },
];

// Short names for the three routes, shared by the stub functions (CE5) and the
// event builder (CE2) so neither keeps its own list.
export const PublicRouteNameSchema = z.enum(['read-record', 'submit-command', 'read-operation']);

export type PublicRouteName = z.infer<typeof PublicRouteNameSchema>;

const handlerOwnersByRouteName: Record<PublicRouteName, PublicRoute['handlerOwner']> = {
  'read-record': 'spec-02-read-handler',
  'submit-command': 'spec-03-command-handler',
  'read-operation': 'spec-03-status-handler',
};

export function publicRouteNamed(routeName: PublicRouteName): PublicRoute {
  const publicRoute = publicRoutes.find(
    (candidateRoute) => candidateRoute.handlerOwner === handlerOwnersByRouteName[routeName],
  );
  if (publicRoute === undefined) {
    // Unreachable while publicRoutes holds all three; the route tests prove it.
    throw new Error(`public-route-missing: ${routeName}`);
  }
  return publicRoute;
}
