-- CreateTable
CREATE TABLE "TransportBooking" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "wasteCode" TEXT NOT NULL,
    "tons" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "co2EstimateKg" DOUBLE PRECISION NOT NULL,
    "plannedPickupAt" TIMESTAMP(3) NOT NULL,
    "plannedDeliveryAt" TIMESTAMP(3) NOT NULL,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverJournal" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "wasteCode" TEXT NOT NULL,
    "tons" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "odometerStartKm" DOUBLE PRECISION NOT NULL,
    "odometerEndKm" DOUBLE PRECISION,
    "gpsTrackHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "signedByDriver" BOOLEAN NOT NULL DEFAULT false,
    "signedByReviewer" BOOLEAN NOT NULL DEFAULT false,
    "driverSignatureId" TEXT,
    "reviewerSignatureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LimsReport" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "sampleId" TEXT NOT NULL,
    "labName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "rawReference" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "verifiedByHuman" BOOLEAN NOT NULL DEFAULT false,
    "reviewer" TEXT,
    "reviewerSignatureId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LimsReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransportBooking_status_idx" ON "TransportBooking"("status");

-- CreateIndex
CREATE INDEX "TransportBooking_receiverId_idx" ON "TransportBooking"("receiverId");

-- CreateIndex
CREATE INDEX "DriverJournal_driverName_idx" ON "DriverJournal"("driverName");

-- CreateIndex
CREATE INDEX "DriverJournal_status_idx" ON "DriverJournal"("status");

-- CreateIndex
CREATE INDEX "LimsReport_sampleId_idx" ON "LimsReport"("sampleId");

-- AddForeignKey
ALTER TABLE "DriverJournal" ADD CONSTRAINT "DriverJournal_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransportBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LimsReport" ADD CONSTRAINT "LimsReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransportBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
