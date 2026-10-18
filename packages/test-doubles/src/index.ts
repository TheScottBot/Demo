// Spec 00 §4.3: the shared test doubles every stream uses, so none
// reimplements them (datum 0.7).
export * from './canonical-version';
export * from './provider-simulation';
export * from './provider-simulation-store';
export * from './synthetic-records';
export * from './verified-claims-event-builder';
export * from './msw-provider-doubles';
// Route names moved to the contract in CE5; re-exported so existing callers keep working.
export { publicRouteNamed, type PublicRouteName } from '@demo/contracts';
