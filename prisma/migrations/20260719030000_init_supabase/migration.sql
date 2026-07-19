-- CreateEnum
CREATE TYPE "PaperTradeSide" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PaperTradeStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaperFillSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PaperFillType" AS ENUM ('ENTRY', 'ADD', 'REDUCE', 'EXIT');

-- CreateEnum
CREATE TYPE "JournalReviewType" AS ENUM ('DAY', 'WEEK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "sector" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsightSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YoutubeVideoSummary" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channelHandle" TEXT NOT NULL,
    "channelId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "transcriptLength" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "rawTranscriptSnippet" TEXT,
    "stockMentions" TEXT[],
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoutubeVideoSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startingEquity" DECIMAL(20,4) NOT NULL DEFAULT 100000,
    "cash" DECIMAL(20,4) NOT NULL DEFAULT 100000,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "side" "PaperTradeSide" NOT NULL,
    "status" "PaperTradeStatus" NOT NULL DEFAULT 'PLANNED',
    "thesis" TEXT NOT NULL,
    "invalidation" TEXT NOT NULL,
    "plannedEntry" DECIMAL(20,4),
    "plannedStop" DECIMAL(20,4),
    "plannedTarget" DECIMAL(20,4),
    "plannedRisk" DECIMAL(20,4),
    "plannedRiskPct" DECIMAL(12,6),
    "plannedShares" DECIMAL(20,6),
    "setupTag" TEXT,
    "strategyTag" TEXT,
    "qty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "avgEntry" DECIMAL(20,4),
    "avgExit" DECIMAL(20,4),
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "stop" DECIMAL(20,4) NOT NULL,
    "target" DECIMAL(20,4),
    "regimeSnapshot" JSONB,
    "quantSnapshot" JSONB,
    "insightMessageId" TEXT,
    "realizedPnl" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "realizedR" DECIMAL(12,6),
    "fees" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "mfe" DECIMAL(20,4),
    "mae" DECIMAL(20,4),
    "exitEfficiency" DECIMAL(12,6),
    "planFollowed" BOOLEAN,
    "emotionTags" TEXT[],
    "mistakeTags" TEXT[],
    "rating" INTEGER,
    "preNotes" TEXT,
    "managementNotes" TEXT,
    "postNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTradeFill" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "side" "PaperFillSide" NOT NULL,
    "type" "PaperFillType" NOT NULL,
    "qty" DECIMAL(20,6) NOT NULL,
    "price" DECIMAL(20,4) NOT NULL,
    "fee" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperTradeFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalReview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewType" "JournalReviewType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "grade" INTEGER,
    "reflections" TEXT,
    "whatWentWell" TEXT,
    "whatToImprove" TEXT,
    "focusNext" TEXT,
    "adherenceSnapshot" JSONB,
    "ruleAdherencePct" DECIMAL(12,6),
    "netPnl" DECIMAL(20,4),
    "tradeCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "Watchlist_userId_sector_idx" ON "Watchlist"("userId", "sector");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_ticker_key" ON "Watchlist"("userId", "ticker");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_userId_provider_key" ON "ApiKey"("userId", "provider");

-- CreateIndex
CREATE INDEX "InsightSession_userId_idx" ON "InsightSession"("userId");

-- CreateIndex
CREATE INDEX "InsightMessage_sessionId_idx" ON "InsightMessage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeVideoSummary_videoId_key" ON "YoutubeVideoSummary"("videoId");

-- CreateIndex
CREATE INDEX "YoutubeVideoSummary_channelHandle_idx" ON "YoutubeVideoSummary"("channelHandle");

-- CreateIndex
CREATE INDEX "YoutubeVideoSummary_publishedAt_idx" ON "YoutubeVideoSummary"("publishedAt");

-- CreateIndex
CREATE INDEX "YoutubeVideoSummary_stockMentions_idx" ON "YoutubeVideoSummary"("stockMentions");

-- CreateIndex
CREATE UNIQUE INDEX "PaperAccount_userId_key" ON "PaperAccount"("userId");

-- CreateIndex
CREATE INDEX "PaperAccount_createdAt_idx" ON "PaperAccount"("createdAt");

-- CreateIndex
CREATE INDEX "PaperTrade_userId_status_idx" ON "PaperTrade"("userId", "status");

-- CreateIndex
CREATE INDEX "PaperTrade_userId_symbol_idx" ON "PaperTrade"("userId", "symbol");

-- CreateIndex
CREATE INDEX "PaperTrade_userId_closedAt_idx" ON "PaperTrade"("userId", "closedAt");

-- CreateIndex
CREATE INDEX "PaperTrade_accountId_status_idx" ON "PaperTrade"("accountId", "status");

-- CreateIndex
CREATE INDEX "PaperTrade_insightMessageId_idx" ON "PaperTrade"("insightMessageId");

-- CreateIndex
CREATE INDEX "PaperTradeFill_tradeId_filledAt_idx" ON "PaperTradeFill"("tradeId", "filledAt");

-- CreateIndex
CREATE INDEX "PaperTradeFill_filledAt_idx" ON "PaperTradeFill"("filledAt");

-- CreateIndex
CREATE INDEX "JournalReview_accountId_reviewType_periodStart_idx" ON "JournalReview"("accountId", "reviewType", "periodStart");

-- CreateIndex
CREATE INDEX "JournalReview_userId_periodStart_idx" ON "JournalReview"("userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "JournalReview_userId_reviewType_periodStart_key" ON "JournalReview"("userId", "reviewType", "periodStart");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightSession" ADD CONSTRAINT "InsightSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightMessage" ADD CONSTRAINT "InsightMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InsightSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperAccount" ADD CONSTRAINT "PaperAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_insightMessageId_fkey" FOREIGN KEY ("insightMessageId") REFERENCES "InsightMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTradeFill" ADD CONSTRAINT "PaperTradeFill_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "PaperTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalReview" ADD CONSTRAINT "JournalReview_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalReview" ADD CONSTRAINT "JournalReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
