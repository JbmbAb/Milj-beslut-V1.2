export type DispatchProvider = 'TIMOCOM' | 'TRANS_EU' | 'MOCK_FRAKTBORS' | 'NOT_CONFIGURED';
export type DispatchBookingStatus =
  | 'QUOTED'
  | 'BOOKED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'BLOCKED';
export type DriverJournalStatus = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
export type LimsSourceType = 'API' | 'SFTP' | 'MANUAL';

export interface DispatchQuote {
  id: string;
  provider: DispatchProvider;
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  estimatedCostSek: number;
  etaHours: number;
  currency: 'SEK';
  createdAt: string;
}

export interface TransportBooking {
  id: string;
  quoteId: string;
  provider: DispatchProvider;
  status: DispatchBookingStatus;
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  co2EstimateKg: number;
  plannedPickupAt: string;
  plannedDeliveryAt: string;
  externalReference: string;
  createdAt: string;
  updatedAt: string;
}

export interface DriverJournalEntry {
  id: string;
  bookingId: string;
  driverName: string;
  vehicleId: string;
  origin: string;
  destination: string;
  wasteCode: string;
  tons: number;
  startedAt: string;
  endedAt: string | null;
  odometerStartKm: number;
  odometerEndKm: number | null;
  gpsTrackHash: string;
  status: DriverJournalStatus;
  signedByDriver: boolean;
  signedByReviewer: boolean;
  driverSignatureId: string | null;
  reviewerSignatureId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LimsMetric {
  key: string;
  value: number;
  unit: string;
  maxAllowed: number | null;
  exceeded: boolean;
}

export interface LimsReport {
  id: string;
  bookingId: string | null;
  sampleId: string;
  labName: string;
  source: LimsSourceType;
  analyzedAt: string;
  rawReference: string;
  metrics: LimsMetric[];
  passed: boolean;
  verifiedByHuman: boolean;
  reviewer: string | null;
  reviewerSignatureId: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface StorageAreaContents {
  [wasteCode: string]: number;
}

export interface ProjectStorageArea {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  capacityM3: number;
  contents: StorageAreaContents;
  geometry?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Receiver {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  allowedCodes: string[];
  type: 'DEPONI' | 'MELLANLAGRING' | 'RECYCLING' | 'UNKNOWN';
  isHazardousAllowed: boolean;
  distance?: number;
  co2Estimate?: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
  immutable: boolean;
  signatureId?: string;
}

export interface IntegrationSource {
  id: string;
  name: string;
  provider: string;
  dataType: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastSync: string;
  complexity: 1 | 2 | 3 | 4 | 5;
}

