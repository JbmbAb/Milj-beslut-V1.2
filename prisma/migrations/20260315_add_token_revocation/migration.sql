-- CreateTable TokenRevocation
CREATE TABLE "TokenRevocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex for efficient lookups
CREATE UNIQUE INDEX "TokenRevocation_jti_key" ON "TokenRevocation"("jti");
CREATE INDEX "TokenRevocation_userId_revokedAt_idx" ON "TokenRevocation"("userId", "revokedAt");
CREATE INDEX "TokenRevocation_expiresAt_idx" ON "TokenRevocation"("expiresAt");
