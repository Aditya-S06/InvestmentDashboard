-- Trading Desk runs (wrapper around the local TradingAgents graph)

-- CreateTable
CREATE TABLE "DeskRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tickers" TEXT[],
    "activeTicker" TEXT,
    "asOf" TEXT NOT NULL,
    "depth" TEXT NOT NULL,
    "analysts" TEXT[],
    "assetType" TEXT NOT NULL DEFAULT 'stock',
    "checkpoint" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "signal" TEXT,
    "params" JSONB,
    "finalState" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DeskRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeskRun_userId_createdAt_idx" ON "DeskRun"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeskRun" ADD CONSTRAINT "DeskRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Close the PostgREST (anon/authenticated) surface, matching
-- 20260820000000_harden_rls_journal_broker. Prisma connects as the database
-- owner and bypasses RLS; this table is only reachable through the app.
ALTER TABLE public."DeskRun" ENABLE ROW LEVEL SECURITY;

-- FORCE also applies the (empty) policy set to the table owner, so a future
-- non-superuser owner cannot read these rows without an explicit policy.
ALTER TABLE public."DeskRun" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."DeskRun" FROM anon, authenticated;
