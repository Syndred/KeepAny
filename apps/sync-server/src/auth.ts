import { createHash, timingSafeEqual } from 'node:crypto';
import type { Authenticate } from './app';
import { createBoundTokenAuthenticator } from './bound-auth';
import type { BoundStateStore } from './bound-state';

// Self-hosted single-subject bootstrap. Replace this verifier with Better Auth before official multi-user sync.
export function createStaticTokenAuthenticator(token: string, subjectId = 'self-host-owner'): Authenticate {
  if (token.length < 32 || token.length > 4096) throw Error('sync-token-configuration');
  const expected = createHash('sha256').update(token).digest();
  return async authorization => {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 4103) return null;
    const supplied = createHash('sha256').update(authorization.slice(7)).digest();
    return timingSafeEqual(expected, supplied) ? subjectId : null;
  };
}

export function createConfiguredAuthenticator(env: Record<string, string | undefined>, boundStateStore?: BoundStateStore): Authenticate {
  if (env.KEEPANY_SYNC_AUTH_MODE === 'self-host') {
    if (!env.KEEPANY_SYNC_TOKEN) throw Error('KEEPANY_SYNC_TOKEN-required');
    return createStaticTokenAuthenticator(env.KEEPANY_SYNC_TOKEN);
  }
  if (env.KEEPANY_SYNC_AUTH_MODE === 'bound') {
    if (env.KEEPANY_SYNC_TOKEN) throw Error('KEEPANY_SYNC_TOKEN-not-allowed-in-bound-mode');
    const issuer = env.KEEPANY_BOUND_ISSUER;
    const publicOrigin = env.KEEPANY_SYNC_PUBLIC_ORIGIN;
    const jwks = env.KEEPANY_BOUND_JWKS_JSON;
    if (env.KEEPANY_BOUND_BINDINGS_JSON !== undefined) throw Error('KEEPANY_BOUND_BINDINGS_JSON-not-allowed');
    if (!issuer || !publicOrigin || !jwks || !boundStateStore) throw Error('bound-auth-configuration-required');
    return createBoundTokenAuthenticator({ issuer, publicOrigin, jwks: JSON.parse(jwks), stateStore: boundStateStore });
  }
  throw Error('KEEPANY_SYNC_AUTH_MODE-required');
}
