import { createHash, timingSafeEqual } from 'node:crypto';
import type { Authenticate } from './app';

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
