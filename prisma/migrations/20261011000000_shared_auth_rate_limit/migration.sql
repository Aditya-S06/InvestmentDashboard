CREATE TABLE "AuthRateLimit" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AuthRateLimit_resetAt_idx" ON "AuthRateLimit" ("resetAt");
ALTER TABLE "AuthRateLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthRateLimit" FORCE ROW LEVEL SECURITY;
-- Local PostgreSQL may not have Supabase API roles.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "AuthRateLimit" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "AuthRateLimit" FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON "AuthRateLimit" FROM PUBLIC;
