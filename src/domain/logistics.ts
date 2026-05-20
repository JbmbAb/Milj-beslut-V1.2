/**
 * LOGISTICS DOMAIN
 * Hanterar massflöden, transporter, lagringsytor och realtidsspårning.
 */

export enum TransportStatus {
  PLANNED = 'PLANNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export interface GpsPosition {
  id: string;
  bookingId: string;
  lat: number;
  lng: number;
  altitude?: number;
  speedKmh?: number;
  heading?: number;
  accuracy?: number;
  timestamp: Date;
  hash: string;
  prevHash: string | null;
}

export interface GpsTrack {
  bookingId: string;
  positions: GpsPosition[];
  totalDistance?: number; // km, estimated
}

export interface StorageArea {
  id: string;
  projectId: string;
  name: string;
  capacityM3: number;
  currentLoadM3: number;
  allowedWasteCodes: string[];
}

export interface TransportBooking {
  id: string;
  projectId: string;
  wasteCode: string;
  tons: number;
  status: TransportStatus;
  originAreaId?: string;
  destinationAreaId?: string;
  plannedDate: Date;
}
