import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { identityDb as prisma } from '@/lib/identity-db';
import { consumeSecondFactor, currentSessionUser } from '@/lib/auth/identity';
import bcrypt from 'bcryptjs';
import {
  clientIpFromHeaders,
  consumeRateLimit,
  LOGIN_IP_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  LOGIN_WINDOW_MS,
  loginIpRateLimitKey,
  loginRateLimitKey,
} from '@/lib/auth/rate-limit';

/** bcrypt of a non-user password so missing accounts still pay compare cost. */
const DUMMY_PASSWORD_HASH = '$2a$12$hXDLaH7Gkv5dgRWqRcmzNeD.CQmH3FxY2cxi0WniH89TorS18VmC.';

const PLACEHOLDER_SECRETS = new Set([
  '',
  'replace-with-a-long-random-string',
  'changeme',
  'secret',
  'your-secret',
]);

function isPlaceholderSecret(secret: string | undefined): boolean {
  const value = (secret ?? '').trim();
  return value.length < 16 || PLACEHOLDER_SECRETS.has(value);
}

function isNextProductionBuild(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

/** Refuse to run a public process with the example placeholder (skipped during `next build`). */
export function assertProductionAuthSecret(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (isNextProductionBuild()) return;
  if (isPlaceholderSecret(process.env.NEXTAUTH_SECRET)) {
    throw new Error(
      'NEXTAUTH_SECRET must be a long random string in production (not the .env.example placeholder).',
    );
  }
}

assertProductionAuthSecret();

const authUrl = (process.env.NEXTAUTH_URL || '').trim();
const useSecureCookies =
  authUrl.startsWith('https://') ||
  (process.env.NODE_ENV === 'production' &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(authUrl));

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        code: { label: 'Authenticator or recovery code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.trim().toLowerCase();
        const ip = clientIpFromHeaders(req.headers);
        try {
          const ipLimited = await consumeRateLimit(
            loginIpRateLimitKey(ip),
            LOGIN_IP_RATE_LIMIT,
            LOGIN_WINDOW_MS,
          );
          if (!ipLimited.allowed) return null;
          const limited = await consumeRateLimit(
            loginRateLimitKey(ip, email),
            LOGIN_RATE_LIMIT,
            LOGIN_WINDOW_MS,
          );
          if (!limited.allowed) return null;
          const accountLimited = await consumeRateLimit(`login-email:${email}`, LOGIN_RATE_LIMIT, LOGIN_WINDOW_MS);
          if (!accountLimited.allowed) return null;
          const user = await prisma.user.findUnique({ where: { email } });
          const isValid = await bcrypt.compare(
            credentials.password,
            user?.password || DUMMY_PASSWORD_HASH,
          );
          if (!user?.password || !isValid || user.disabledAt) return null;
          if (!await consumeSecondFactor(prisma, user, credentials.code || '')) return null;
          return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  cookies: {
    sessionToken: {
      name: useSecureCookies ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }: any) {
      const user = await currentSessionUser(token);
      // Missing version rejects all pre-hardening JWTs. No fallback by email or token refresh.
      if (!user) return { ...session, user: undefined };
      return { ...session, user: { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion } };
    },
  },
  pages: {
    signIn: '/login',
  },
};
