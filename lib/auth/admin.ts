import 'server-only';

import { prisma } from '@/lib/prisma';

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}


export function isInsightsAdmin(email?: string | null, role?: string | null): boolean {
  if (role === 'admin') return true;
  const normalizedEmail = email?.trim().toLowerCase();
  return !!normalizedEmail && getAdminEmails().includes(normalizedEmail);
}

/** Keeps User.role in step with ADMIN_EMAILS, promoting and demoting. */
export async function syncAdminRole(userId: string, email?: string | null): Promise<string | null> {
  const adminEmails = getAdminEmails();
  const emailIsAdmin = !!email && adminEmails.includes(email.trim().toLowerCase());

  if (emailIsAdmin) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: 'admin' },
      select: { role: true },
    });
    return user.role;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  // Only demote when ADMIN_EMAILS is actually configured, so a missing env var
  // cannot silently strip the operator's own admin role.
  if (user?.role === 'admin' && adminEmails.length > 0) {
    const demoted = await prisma.user.update({
      where: { id: userId },
      data: { role: 'user' },
      select: { role: true },
    });
    return demoted.role;
  }
  return user?.role ?? null;
}
