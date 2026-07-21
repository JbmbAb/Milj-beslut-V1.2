-- CreateTable
CREATE TABLE "public"."InteractionPrototypeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT,
    "lastInteractionId" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
    "purpose" TEXT NOT NULL DEFAULT 'INTERACTIONS_PROTOTYPE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractionPrototypeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InteractionPrototypeSession_userId_createdAt_idx" ON "public"."InteractionPrototypeSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InteractionPrototypeSession_organisationId_idx" ON "public"."InteractionPrototypeSession"("organisationId");

-- CreateIndex
CREATE INDEX "InteractionPrototypeSession_projectId_idx" ON "public"."InteractionPrototypeSession"("projectId");

-- AddForeignKey
ALTER TABLE "public"."InteractionPrototypeSession" ADD CONSTRAINT "InteractionPrototypeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InteractionPrototypeSession" ADD CONSTRAINT "InteractionPrototypeSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InteractionPrototypeSession" ADD CONSTRAINT "InteractionPrototypeSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
