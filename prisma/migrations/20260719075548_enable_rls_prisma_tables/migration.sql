-- Prisma uses the database password role (bypasses RLS).
-- Enabling RLS with no anon/authenticated policies blocks PostgREST public access.
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Watchlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InsightSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InsightMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."YoutubeVideoSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PaperAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PaperTrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PaperTradeFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JournalReview" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON TYPE "PaperTradeSide", "PaperTradeStatus", "PaperFillSide", "PaperFillType", "JournalReviewType" FROM anon, authenticated;
