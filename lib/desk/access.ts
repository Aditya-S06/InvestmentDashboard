import 'server-only';

// Trading Desk shares the Insights access gate and OpenRouter key resolution;
// there is no Desk-specific key path. lib/insights/access.ts is local-only
// (gitignored) — provision the operator-owned bundle per README before starting.
export {
  requireInsightsAccess as requireDeskAccess,
  resolveOpenRouterKey,
  type InsightsAccessContext as DeskAccessContext,
  type ResolvedOpenRouterKey,
} from '@/lib/insights/access';
