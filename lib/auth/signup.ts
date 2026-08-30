export const MIN_PASSWORD_LENGTH = 12;

/**
 * Self-hosted desks should not accept strangers. Opt in explicitly with
 * ALLOW_PUBLIC_SIGNUP=true when you actually want open registration.
 */
export function isPublicSignupEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.ALLOW_PUBLIC_SIGNUP || '').trim().toLowerCase());
}
