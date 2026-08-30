-- Webull in-app trading ledger + journal sync fields

ALTER TABLE "PersonalTrade" ADD COLUMN "source" TEXT;
ALTER TABLE "PersonalTrade" ADD COLUMN "webullClientOrderId" TEXT;
ALTER TABLE "PersonalTrade" ADD COLUMN "brokerOrderId" TEXT;

CREATE INDEX "PersonalTrade_webullClientOrderId_idx" ON "PersonalTrade"("webullClientOrderId");

CREATE TABLE "PersonalTradeFill" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "qty" DECIMAL(20,6) NOT NULL,
    "price" DECIMAL(20,4) NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTradeFill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalTradeFill_tradeId_filledAt_idx" ON "PersonalTradeFill"("tradeId", "filledAt");

ALTER TABLE "PersonalTradeFill" ADD CONSTRAINT "PersonalTradeFill_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "PersonalTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BrokerOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "webullOrderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "tif" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "qty" DECIMAL(20,6) NOT NULL,
    "limitPrice" DECIMAL(20,4),
    "stopPrice" DECIMAL(20,4),
    "status" TEXT NOT NULL,
    "filledQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "avgFillPrice" DECIMAL(20,4),
    "fees" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "thesis" TEXT,
    "invalidation" TEXT,
    "preNotes" TEXT,
    "setupTag" TEXT,
    "strategyTag" TEXT,
    "sourceUrl" TEXT,
    "personalTradeId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "previewId" TEXT,
    "previewExpiresAt" TIMESTAMP(3),
    "previewConsumed" BOOLEAN NOT NULL DEFAULT false,
    "webullPreview" JSONB,
    "rawPlace" JSONB,
    "lastWebullDetail" JSONB,
    "instrumentType" TEXT NOT NULL DEFAULT 'EQUITY',
    "comboType" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerOrder_clientOrderId_key" ON "BrokerOrder"("clientOrderId");
CREATE UNIQUE INDEX "BrokerOrder_previewId_key" ON "BrokerOrder"("previewId");
CREATE INDEX "BrokerOrder_userId_status_idx" ON "BrokerOrder"("userId", "status");
CREATE INDEX "BrokerOrder_userId_symbol_idx" ON "BrokerOrder"("userId", "symbol");
CREATE INDEX "BrokerOrder_accountId_status_idx" ON "BrokerOrder"("accountId", "status");
CREATE INDEX "BrokerOrder_environment_createdAt_idx" ON "BrokerOrder"("environment", "createdAt");

ALTER TABLE "BrokerOrder" ADD CONSTRAINT "BrokerOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerOrder" ADD CONSTRAINT "BrokerOrder_personalTradeId_fkey" FOREIGN KEY ("personalTradeId") REFERENCES "PersonalTrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BrokerOrderFill" (
    "id" TEXT NOT NULL,
    "brokerOrderId" TEXT NOT NULL,
    "filledQty" DECIMAL(20,6) NOT NULL,
    "filledPrice" DECIMAL(20,4) NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "sceneType" TEXT,
    "raw" JSONB,

    CONSTRAINT "BrokerOrderFill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerOrderFill_brokerOrderId_filledQty_filledAt_key" ON "BrokerOrderFill"("brokerOrderId", "filledQty", "filledAt");
ALTER TABLE "BrokerOrderFill" ADD CONSTRAINT "BrokerOrderFill_brokerOrderId_fkey" FOREIGN KEY ("brokerOrderId") REFERENCES "BrokerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BrokerAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "clientOrderId" TEXT,
    "ip" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrokerAuditLog_createdAt_idx" ON "BrokerAuditLog"("createdAt");
CREATE INDEX "BrokerAuditLog_clientOrderId_idx" ON "BrokerAuditLog"("clientOrderId");
CREATE INDEX "BrokerAuditLog_userId_createdAt_idx" ON "BrokerAuditLog"("userId", "createdAt");
ALTER TABLE "BrokerAuditLog" ADD CONSTRAINT "BrokerAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TradingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "TradingSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TradingSettings" ("id", "killSwitch", "updatedAt") VALUES ('default', false, CURRENT_TIMESTAMP);

ALTER TABLE public."PersonalTradeFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerOrderFill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BrokerAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TradingSettings" ENABLE ROW LEVEL SECURITY;
