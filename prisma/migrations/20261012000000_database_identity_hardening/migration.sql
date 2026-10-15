-- Separate runtime/identity roles; login passwords are provisioned out of band.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oracle_runtime') THEN
  CREATE ROLE oracle_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oracle_identity') THEN
  CREATE ROLE oracle_identity NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO oracle_runtime, oracle_identity;
ALTER TABLE "User"
 ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "disabledAt" TIMESTAMP(3),
 ADD COLUMN "mfaSecret" TEXT,
 ADD COLUMN "mfaPendingSecret" TEXT,
 ADD COLUMN "mfaPendingExpiresAt" TIMESTAMP(3),
 ADD COLUMN "mfaLastCounter" INTEGER NOT NULL DEFAULT -1,
 ADD COLUMN "mfaRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "AuthRateLimit" TO oracle_identity;
CREATE POLICY identity_access ON "User" TO oracle_identity USING (true) WITH CHECK (true);
CREATE POLICY identity_access ON "AuthRateLimit" TO oracle_identity USING (true) WITH CHECK (true);
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
GRANT SELECT ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt", "sessionVersion", "disabledAt") ON "User" TO oracle_runtime;
GRANT UPDATE ("role", "updatedAt", "disabledAt", "sessionVersion") ON "User" TO oracle_runtime;
CREATE POLICY own_identity ON "User" TO oracle_runtime
 USING ("id" = NULLIF(current_setting('app.user_id', true), ''))
 WITH CHECK ("id" = NULLIF(current_setting('app.user_id', true), ''));

ALTER TABLE "Watchlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Watchlist" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "Watchlist" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Watchlist" TO oracle_runtime;
CREATE POLICY scoped_access ON "Watchlist" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "ApiKey" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ApiKey" TO oracle_runtime;
CREATE POLICY scoped_access ON "ApiKey" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "InsightSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InsightSession" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "InsightSession" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "InsightSession" TO oracle_runtime;
CREATE POLICY scoped_access ON "InsightSession" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "PaperAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaperAccount" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PaperAccount" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PaperAccount" TO oracle_runtime;
CREATE POLICY scoped_access ON "PaperAccount" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "PersonalTrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonalTrade" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PersonalTrade" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PersonalTrade" TO oracle_runtime;
CREATE POLICY scoped_access ON "PersonalTrade" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "PersonalReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonalReview" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PersonalReview" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PersonalReview" TO oracle_runtime;
CREATE POLICY scoped_access ON "PersonalReview" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "BrokerAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrokerAuditLog" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BrokerAuditLog" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BrokerAuditLog" TO oracle_runtime;
CREATE POLICY scoped_access ON "BrokerAuditLog" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "DeskRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeskRun" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "DeskRun" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DeskRun" TO oracle_runtime;
CREATE POLICY scoped_access ON "DeskRun" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '')) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "InsightMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InsightMessage" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "InsightMessage" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "InsightMessage" TO oracle_runtime;
CREATE POLICY scoped_access ON "InsightMessage" TO oracle_runtime
 USING ((EXISTS (SELECT 1 FROM "InsightSession" p WHERE p."id" = "InsightMessage"."sessionId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK ((EXISTS (SELECT 1 FROM "InsightSession" p WHERE p."id" = "InsightMessage"."sessionId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "PaperTrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaperTrade" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PaperTrade" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PaperTrade" TO oracle_runtime;
CREATE POLICY scoped_access ON "PaperTrade" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '') AND EXISTS (SELECT 1 FROM "PaperAccount" p WHERE p."id" = "PaperTrade"."accountId") AND ("insightMessageId" IS NULL OR EXISTS (SELECT 1 FROM "InsightMessage" m WHERE m."id" = "PaperTrade"."insightMessageId"))) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '') AND EXISTS (SELECT 1 FROM "PaperAccount" p WHERE p."id" = "PaperTrade"."accountId") AND ("insightMessageId" IS NULL OR EXISTS (SELECT 1 FROM "InsightMessage" m WHERE m."id" = "PaperTrade"."insightMessageId"))) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "JournalReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalReview" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "JournalReview" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "JournalReview" TO oracle_runtime;
CREATE POLICY scoped_access ON "JournalReview" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '') AND EXISTS (SELECT 1 FROM "PaperAccount" p WHERE p."id" = "JournalReview"."accountId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '') AND EXISTS (SELECT 1 FROM "PaperAccount" p WHERE p."id" = "JournalReview"."accountId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "PaperTradeFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaperTradeFill" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PaperTradeFill" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PaperTradeFill" TO oracle_runtime;
CREATE POLICY scoped_access ON "PaperTradeFill" TO oracle_runtime
 USING ((EXISTS (SELECT 1 FROM "PaperTrade" p WHERE p."id" = "PaperTradeFill"."tradeId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK ((EXISTS (SELECT 1 FROM "PaperTrade" p WHERE p."id" = "PaperTradeFill"."tradeId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "PersonalTradeFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonalTradeFill" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "PersonalTradeFill" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PersonalTradeFill" TO oracle_runtime;
CREATE POLICY scoped_access ON "PersonalTradeFill" TO oracle_runtime
 USING ((EXISTS (SELECT 1 FROM "PersonalTrade" p WHERE p."id" = "PersonalTradeFill"."tradeId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK ((EXISTS (SELECT 1 FROM "PersonalTrade" p WHERE p."id" = "PersonalTradeFill"."tradeId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "BrokerOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrokerOrder" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BrokerOrder" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BrokerOrder" TO oracle_runtime;
CREATE POLICY scoped_access ON "BrokerOrder" TO oracle_runtime
 USING (("userId" = NULLIF(current_setting('app.user_id', true), '') AND ("personalTradeId" IS NULL OR EXISTS (SELECT 1 FROM "PersonalTrade" p WHERE p."id" = "BrokerOrder"."personalTradeId"))) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK (("userId" = NULLIF(current_setting('app.user_id', true), '') AND ("personalTradeId" IS NULL OR EXISTS (SELECT 1 FROM "PersonalTrade" p WHERE p."id" = "BrokerOrder"."personalTradeId"))) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "BrokerOrderFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrokerOrderFill" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "BrokerOrderFill" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BrokerOrderFill" TO oracle_runtime;
CREATE POLICY scoped_access ON "BrokerOrderFill" TO oracle_runtime
 USING ((EXISTS (SELECT 1 FROM "BrokerOrder" p WHERE p."id" = "BrokerOrderFill"."brokerOrderId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK ((EXISTS (SELECT 1 FROM "BrokerOrder" p WHERE p."id" = "BrokerOrderFill"."brokerOrderId")) AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "YoutubeVideoSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "YoutubeVideoSummary" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "YoutubeVideoSummary" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "YoutubeVideoSummary" TO oracle_runtime;
CREATE POLICY scoped_access ON "YoutubeVideoSummary" TO oracle_runtime
 USING ((current_setting('app.is_admin', true) = 'true') AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK ((current_setting('app.is_admin', true) = 'true') AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

ALTER TABLE "TradingSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradingSettings" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "TradingSettings" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TradingSettings" TO oracle_runtime;
CREATE POLICY scoped_access ON "TradingSettings" TO oracle_runtime
 USING ((current_setting('app.is_admin', true) = 'true') AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)))
 WITH CHECK ((current_setting('app.is_admin', true) = 'true') AND (SELECT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NULLIF(current_setting('app.user_id', true), '') AND u."disabledAt" IS NULL AND u."sessionVersion" = NULLIF(current_setting('app.session_version', true), '')::integer)));

-- No membership in elevated roles; no grants on Account/Session/VerificationToken.
-- Neither connection is a table owner or a migration role. GUC identity protects
-- against missing owner predicates, not arbitrary SQL execution or server compromise.
