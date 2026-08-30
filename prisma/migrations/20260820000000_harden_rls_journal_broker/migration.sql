-- Journal and broker tables were added after 20260719075548_enable_rls_prisma_tables,
-- so they missed the blanket RLS/REVOKE pass. Prisma connects as the database owner
-- and bypasses RLS; this only closes the PostgREST (anon/authenticated) surface.

ALTER TABLE public."PersonalTrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PersonalReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PersonalTradeFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerOrderFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TradingSettings" ENABLE ROW LEVEL SECURITY;

-- FORCE also applies the (empty) policy set to the table owner, so a future
-- non-superuser owner cannot read these rows without an explicit policy.
ALTER TABLE public."PersonalTrade" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."PersonalReview" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."PersonalTradeFill" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerOrder" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerOrderFill" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerAuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."TradingSettings" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public."PersonalTrade",
  public."PersonalReview",
  public."PersonalTradeFill",
  public."BrokerOrder",
  public."BrokerOrderFill",
  public."BrokerAuditLog",
  public."TradingSettings"
FROM anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

REVOKE USAGE ON TYPE "PersonalTradeSide", "PersonalTradeStatus" FROM anon, authenticated;
