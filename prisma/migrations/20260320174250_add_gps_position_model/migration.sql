-- CreateTable
CREATE TABLE "GpsPosition" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT,

    CONSTRAINT "GpsPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GpsPosition_bookingId_timestamp_idx" ON "GpsPosition"("bookingId", "timestamp");

-- AddForeignKey
ALTER TABLE "GpsPosition" ADD CONSTRAINT "GpsPosition_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransportBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
