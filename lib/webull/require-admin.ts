import 'server-only';

import { requireAdmin } from '@/lib/auth/require-admin';

/** Broker-facing alias for the shared admin gate. */
export const requireBrokerAdmin = requireAdmin;
