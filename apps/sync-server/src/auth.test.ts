import { expect, it } from 'vitest';
import { createConfiguredAuthenticator, createStaticTokenAuthenticator } from './auth';

it('requires a strong configured bearer token and never authenticates anonymous requests', async () => {
  expect(() => createStaticTokenAuthenticator('short')).toThrow('sync-token-configuration');
  const token = '0123456789abcdef0123456789abcdef';
  const authenticate = createStaticTokenAuthenticator(token);
  expect(await authenticate(undefined)).toBeNull();
  expect(await authenticate(`Basic ${token}`)).toBeNull();
  expect(await authenticate(`Bearer ${token.slice(0, -1)}x`)).toBeNull();
  expect(await authenticate(`Bearer ${token}`)).toBe('self-host-owner');
});

it('requires an explicit auth mode and fails closed when bound trust is missing', async () => {
  const token = '0123456789abcdef0123456789abcdef';
  expect(() => createConfiguredAuthenticator({ KEEPANY_SYNC_TOKEN: token })).toThrow('KEEPANY_SYNC_AUTH_MODE-required');
  expect(() => createConfiguredAuthenticator({ KEEPANY_SYNC_AUTH_MODE: 'bound', KEEPANY_SYNC_TOKEN: token })).toThrow('not-allowed');
  expect(() => createConfiguredAuthenticator({ KEEPANY_SYNC_AUTH_MODE: 'bound' })).toThrow('bound-auth-configuration-required');
  expect(() => createConfiguredAuthenticator({ KEEPANY_SYNC_AUTH_MODE: 'bound', KEEPANY_BOUND_BINDINGS_JSON: '[]' }, {
    claimProof: async () => false, pruneExpiredProofs: async () => {},
  })).toThrow('KEEPANY_BOUND_BINDINGS_JSON-not-allowed');
  const selfHost = createConfiguredAuthenticator({ KEEPANY_SYNC_AUTH_MODE: 'self-host', KEEPANY_SYNC_TOKEN: token });
  expect(await selfHost(`Bearer ${token}`)).toBe('self-host-owner');
  expect(await selfHost(`DPoP ${token}`)).toBeNull();
});
