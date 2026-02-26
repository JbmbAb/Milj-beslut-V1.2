
export enum DecisionType {
  BIFALL = 'BIFALL',
  AVSLAG = 'AVSLAG',
  UNKNOWN = 'OKÄNT'
}

export enum ApplicationStatus {
  DRAFT = 'UTKAST',
  SUBMITTED = 'INSKICKAD',
  REVIEWING = 'HANDLÄGGS',
  COMPLETED = 'AVSLUTAD'
}

export type InterfaceMode = 'LOGISTICS_MARKET' | 'PERMIT_PORTAL' | 'PROJECT_MANAGER' | 'COMPLIANCE_AUDIT';

export interface User {
  id: string;
  name: string;
  personalNumber: string;
  isAuthenticated: boolean;
}

export interface WasteCode {
  code: string;
  name: string;
  type: 'SNI' | 'EWC';
  requirements: {
    storageTime?: string;
    maxAmount?: string;
    safetyDistance?: string;
    legalReference: string;
  };
}

export interface Receiver {
  id: string;
  name: string;
  lat: number;
  lng: number;
  allowedCodes: string[];
  type: 'DEPONI' | 'MELLANLAGRING' | 'RECYCLING';
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

export interface ComplianceScore {
  score: number;
  totalSteps: number;
  completedSteps: number;
  missingDocuments: string[];
}

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  required: boolean;
  value: string;
  options?: string[];
}

export interface EnvironmentalForm {
  id: string;
  title: string;
  wasteCode: string;
  sections: {
    title: string;
    fields: FormField[];
  }[];
}

export interface SpeciesObservation {
  name: string;
  status: 'Rödlistad' | 'Fridlyst' | 'Livskraftig';
  distance: number;
}

export interface WeatherRisk {
  level: 'Låg' | 'Medel' | 'Hög';
  description: string;
  action: string;
}

export interface Stats {
  total: number;
  bifall: number;
  avslag: number;
  municipalities: number;
}

export interface Task {
  id: string;
  title: string;
  startWeek: number;
  duration: number;
  type: 'LEGAL' | 'TECHNICAL' | 'FIELD' | 'ADMIN';
  status: 'DONE' | 'ONGOING' | 'TODO';
}

export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  relevance: string;
}

export interface ProjectPlan {
  name: string;
  revision: string;
  background: string;
  description: string;
  goals: { id: string; text: string }[];
  location: { lat: number; lng: number; address: string; propertyId: string };
  stakeholders: Stakeholder[];
  phases: ProjectPhase[];
  complianceScore: number;
  auditTrail: AuditEntry[];
}

export interface ProjectPhase {
  id: string;
  title: string;
  status: 'TODO' | 'ONGOING' | 'DONE';
  tasks: Task[];
  isLocked: boolean;
  requiresSignature: boolean;
}

export interface Permit {
  id: number;
  filename: string;
  checksum: string;
  received_date: string;
  property_id: string;
  municipality: string;
  waste_codes: string;
  decision_type: DecisionType;
  full_text: string;
  processed_at: string;
  applicant_company?: string;
  lat?: number;
  lng?: number;
  consultant_company?: string;
  contact_person?: string;
  email?: string;
}
