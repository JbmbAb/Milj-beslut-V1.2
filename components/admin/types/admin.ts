/**
 * Admin Module Types
 * Prisma-kompatibla TypeScript interfaces för alla admin-moduler
 */

/* ===== PERMIT PORTAL ===== */

export interface DocumentRecord {
  id: string;
  filename: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  status: 'DRAFT' | 'UPLOADED' | 'VERIFIED' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
  projectId: string;
  organisationId: string;
}

export interface Project {
  id: string;
  organisationId: string;
  propertyDesignation: string;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  createdAt: string;
  closedAt?: string;
  complianceScore?: number;
  environmentalScore?: number;
  fundingRating?: string;
  regulatoryRiskScore?: number;
  documents?: DocumentRecord[];
}

export interface PermitApplication extends Project {
  applicant?: string;
  submittedAt?: string;
  documents: DocumentRecord[];
}

/* ===== LOGISTICS ===== */

export interface GpsPosition {
  id: string;
  bookingId: string;
  lat: number;
  lng: number;
  altitude?: number;
  speedKmh?: number;
  heading?: number;
  accuracy?: number;
  timestamp: string;
}

export interface DriverJournal {
  id: string;
  bookingId: string;
  driverName: string;
  vehicleId: string;
  origin: string;
  destination: string;
  wasteCode: string;
  tons: number;
  startedAt: string;
  endedAt?: string;
  odometerStartKm: number;
  odometerEndKm?: number;
  status: string;
  signedByDriver: boolean;
  signedByReviewer: boolean;
}

export interface LimsReport {
  id: string;
  bookingId?: string;
  sampleId: string;
  labName: string;
  source: string;
  analyzedAt: string;
  rawReference: string;
  metrics: Record<string, unknown>;
  passed: boolean;
  verifiedByHuman: boolean;
  verifiedAt?: string;
}

export interface TransportBooking {
  id: string;
  quoteId: string;
  provider: string;
  status: 'PENDING' | 'CONFIRMED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  co2EstimateKg: number;
  plannedPickupAt: string;
  plannedDeliveryAt: string;
  externalReference?: string;
  createdAt: string;
  updatedAt: string;
  journals?: DriverJournal[];
  gpsPositions?: GpsPosition[];
  limsReports?: LimsReport[];
}

export interface LogisticsStats {
  totalTransports: number;
  activeTransports: number;
  totalCo2kg: number;
  totalTonnage: number;
}

/* ===== PROJECT PLAN ===== */

export interface ProjectPhase {
  id: string;
  name: string;
  progress: number;
  status: 'TODO' | 'ONGOING' | 'DONE';
  startDate: string;
  endDate: string;
}

export interface ProjectPlanSnapshot {
  id: string;
  projectId: string;
  schemaVersion: number;
  plan: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPlanState {
  templateId?: string;
  projectType?: string;
  phases?: ProjectPhase[];
  stakeholders?: ProjectMember[];
  risks?: unknown[];
}

/* ===== GREEN CHECK ===== */

export interface RiskMetric {
  name: string;
  score: number;
  threshold: number;
  status: 'low' | 'medium' | 'high';
  lastUpdated?: string;
}

export interface CarbonResult {
  totalKgCo2e: number;
  quality: 'ESTIMATED' | 'CALCULATED' | 'VERIFIED';
  method: 'MANUAL' | 'FORMULA' | 'DATABASE';
  breakdown?: Record<string, number>;
}

export interface ESGRating {
  overall: string;
  environmental?: string;
  social?: string;
  governance?: string;
  carbonReady: boolean;
  complianceScore: number;
  loanEligible: boolean;
}

export interface GreenCheckDashboard {
  project: Project;
  esg: ESGRating;
  carbonResult?: CarbonResult;
  riskMetrics: RiskMetric[];
  updatedAt: string;
}

/* ===== SEWAGE PORTAL ===== */

export interface SewageApplication {
  id: string;
  organisationId: string;
  propertyAddress: string;
  latitude: number;
  longitude: number;
  householdSize: number;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  submittedAt?: string;
  approvedAt?: string;
  propertyDesignation?: string;
  documents?: DocumentRecord[];
}

/* ===== PROJECT MEMBER ===== */

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER' | 'AUDITOR';
  joinedAt: string;
}

/* ===== API RESPONSE TYPES ===== */

export interface ApiResponse<T> {
  ok: boolean;
  error?: string;
  data?: T;
  [key: string]: unknown;
}

export interface AdminProjectsResponse {
  ok: boolean;
  projects: Project[];
}

export interface TransportBookingResponse {
  ok: boolean;
  booking: TransportBooking;
}

export interface ProjectPlanResponse {
  ok: boolean;
  plan: ProjectPlanSnapshot;
}
