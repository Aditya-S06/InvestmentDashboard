-- Personal (live) trade journal — separate from paper simulation

CREATE TYPE "PersonalTradeSide" AS ENUM ('LONG', 'SHORT');
CREATE TYPE "PersonalTradeStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "PersonalTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "side" "PersonalTradeSide" NOT NULL,
    "status" "PersonalTradeStatus" NOT NULL DEFAULT 'OPEN',
    "broker" VARCHAR(40),
    "thesis" TEXT,
    "invalidation" TEXT,
    "entryPrice" DECIMAL(20,4) NOT NULL,
    "exitPrice" DECIMAL(20,4),
    "stop" DECIMAL(20,4),
    "target" DECIMAL(20,4),
    "qty" DECIMAL(20,6) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "fees" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(20,4),
    "setupTag" TEXT,
    "strategyTag" TEXT,
    "planFollowed" BOOLEAN,
    "emotionTags" TEXT[],
    "mistakeTags" TEXT[],
    "rating" INTEGER,
    "preNotes" TEXT,
    "managementNotes" TEXT,
    "postNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewType" "JournalReviewType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "grade" INTEGER,
    "whatWentWell" TEXT,
    "whatToImprove" TEXT,
    "focusNext" TEXT,
    "netPnl" DECIMAL(20,4),
    "tradeCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalTrade_userId_status_idx" ON "PersonalTrade"("userId", "status");
CREATE INDEX "PersonalTrade_userId_symbol_idx" ON "PersonalTrade"("userId", "symbol");
CREATE INDEX "PersonalTrade_userId_openedAt_idx" ON "PersonalTrade"("userId", "openedAt");
CREATE INDEX "PersonalTrade_userId_closedAt_idx" ON "PersonalTrade"("userId", "closedAt");

CREATE INDEX "PersonalReview_userId_periodStart_idx" ON "PersonalReview"("userId", "periodStart");
CREATE UNIQUE INDEX "PersonalReview_userId_reviewType_periodStart_key" ON "PersonalReview"("userId", "reviewType", "periodStart");

ALTER TABLE "PersonalTrade" ADD CONSTRAINT "PersonalTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalReview" ADD CONSTRAINT "PersonalReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
