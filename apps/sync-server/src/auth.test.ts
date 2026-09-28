import { expect, it } from 'vitest';
import { createStaticTokenAuthenticator } from './auth';

it('requires a strong configured bearer token and never authenticates anonymous requests', async () => {
  expect(() => createStaticTokenAuthenticator('short')).toThrow('sync-token-configuration');
  const token = '0123456789abcdef0123456789abcdef';
  const authenticate = createStaticTokenAuthenticator(token);
  expect(await authenticate(undefined)).toBeNull();
  expect(await authenticate(`Basic ${token}`)).toBeNull();
  expect(await authenticate(`Bearer ${token.slice(0, -1)}x`)).toBeNull();
  expect(await authenticate(`Bearer ${token}`)).toBe('self-host-owner');
});
