// Added in CE5: route names, moved here so the stubs and the test doubles
// share one definition, and the stub echo header CE5 names.
import { describe, expect, it } from 'vitest';
import { PublicRouteNameSchema, httpHeaders, publicRouteNamed } from '../src/index';

describe('public route names', () => {
  it('name each Spec 00 §3.2 route', () => {
    expect(PublicRouteNameSchema.options).toEqual([
      'read-record',
      'submit-command',
      'read-operation',
    ]);
    expect(publicRouteNamed('read-record').path).toBe('/v1/records/{recordId}');
    expect(publicRouteNamed('submit-command').path).toBe('/v1/commands');
    expect(publicRouteNamed('read-operation').path).toBe('/v1/operations/{operationId}');
  });
});

describe('the stub echo header', () => {
  it('is Demo-Stub-Echo, sent on responses in the stub stage only', () => {
    expect(httpHeaders.stubEcho).toEqual({
      wireName: 'Demo-Stub-Echo',
      direction: 'response',
      boundary: 'public-api',
    });
  });
});
