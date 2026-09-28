import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import type { Authenticate } from './app';

export function sessionPublicOrigin(value: string | undefined, nodeEnv: string | undefined): string {
  if (!value) throw Error('KEEPANY_SYNC_PUBLIC_ORIGIN-required');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== value || url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(nodeEnv !== 'production' && url.protocol === 'http:' && loopback))) {
    throw Error('KEEPANY_SYNC_PUBLIC_ORIGIN-invalid');
  }
  return url.origin;
}

export function createSelfHostSession(pool: Pool, env: Record<string, string | undefined>) {
  if (env.KEEPANY_SYNC_AUTH_MODE !== 'self-host-session') throw Error('session-auth-mode-required');
  if (env.KEEPANY_SYNC_TOKEN) throw Error('KEEPANY_SYNC_TOKEN-not-allowed-in-session-mode');
  if (env.KEEPANY_SYNC_WEB_ORIGIN) throw Error('KEEPANY_SYNC_WEB_ORIGIN-not-allowed-in-session-mode');
  const origin = sessionPublicOrigin(env.KEEPANY_SYNC_PUBLIC_ORIGIN, env.NODE_ENV);
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw Error('BETTER_AUTH_SECRET-required');
  const signupFlag = env.KEEPANY_SESSION_ALLOW_SIGNUP;
  if (signupFlag !== undefined && signupFlag !== 'true' && signupFlag !== 'false') {
    throw Error('KEEPANY_SESSION_ALLOW_SIGNUP-invalid');
  }
  const secure = origin.startsWith('https:');
  const auth = betterAuth({
    database: pool,
    baseURL: origin,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: true, disableSignUp: signupFlag !== 'true' },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
    },
  });
  const authenticate: Authenticate = async (authorization, request) => {
    if (authorization || !request?.headers) return null;
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id ? `selfhost:${session.user.id}` : null;
  };
  return { auth, authenticate, origin };
}
