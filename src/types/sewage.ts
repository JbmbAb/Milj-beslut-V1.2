// ============================================================================
// SEWAGE PORTAL TYPES
// ============================================================================

// ============================================================================
// SEWAGE SYSTEM TYPES
// ============================================================================

export type SewageSystemTypeId =
  | 'CLOSED_TANK'
  | 'INFILTRATION'
  | 'SOIL_BED'
  | 'MINI_PLANT_BDTA'
  | 'MINI_PLANT_BDT'
  | 'PHOSPHORUS_TRAP';

export interface SewageSystemType {
  id: SewageSystemTypeId;
  name: string; // e.g., "Infiltrationssystem (markbÃ¤dd)"
  description: string;
  type: 'STORAGE' | 'TREATMENT' | 'POLISHING';
  requiresSoilTest: boolean; // KrÃ¤ver perkolationsprov
  maxProtectionLevel: 'NORMAL' | 'HIGH'; // Vilken skyddsnivÃ¥ den klarar
  requiredDistance: {
    toWell: number; // meters
    toWaterCourse: number; // meters
    toPropertyLine: number; // meters
    toNeighborWell: number; // meters
  };
  typicalLoadingRate?: number; // kg/mÂ²/Ã¥r fÃ¶r dimensionering
  costPerPE?: number; // SEK per PE (used for dynamic scaling)
  areaPerPE?: number; // mÂ² per PE (used for dynamic sizing)
  baseCost?: number; // SEK base cost (for non-scaled systems)
  lifespan: number; // years
  maintenanceInterval: number; // months
}

// ============================================================================
// SEWAGE PROTECTION PROFILE
// ============================================================================

export interface SewageProtectionProfile {
  propertyId: string;
  protectionLevel: 'NORMAL' | 'HIGH';
  reason: string; // E.g., "Ligger inom vattenskyddsomrÃ¥de"

  // GIS findings
  nearestWell: {
    distance: number; // meters
    owner: 'OWN' | 'NEIGHBOR' | 'PUBLIC';
    coordinates: { lat: number; lng: number };
  };

  nearestWaterCourse: {
    distance: number;
    type: string; // E.g., "BÃ¤ck", "Ã…", "SjÃ¶"
    name?: string;
  };

  distanceToPropertyLine: number;

  soilProfile: {
    soilType: string; // E.g., "IsÃ¤lvssand", "MorÃ¤n", "Lera"
    depthToRock: number; // meters
    groundwaterLevel: number; // meters below surface
    infiltrationCapacity: 'LOW' | 'MEDIUM' | 'HIGH'; // Based on LTAR-potential
    permeability: number; // mm/h (estimated)
  };

  floodRisk: 'LOW' | 'MEDIUM' | 'HIGH'; // Based on climate models
  protectedNatureNearby: boolean;

  recommendedSystem: SewageSystemTypeId;

  timelineEstimateWeeks: number; // Municipal processing time
  requiredGates: Gate[];
}

export interface Gate {
  id: string; // e.g., 'gate-SEWAGE_PROTECTION_LEVEL'
  name: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  blockingFactor?: string; // Why it's blocked
  estimatedCompletionDate?: string;
}

// ============================================================================
// SEWAGE APPLICATION
// ============================================================================

export interface SewageApplication {
  id: string;
  projectId: string;
  propertyDesignation: string;
  pe: number; // Person equivalents (1-200)

  selectedSystemType: SewageSystemTypeId;
  protectionProfile: SewageProtectionProfile;

  // Soil test results
  soilTestCompleted: boolean;
  ltar?: number; // Loading Rate from soil test (mm/h)
  percolationTestDate?: string;

  // Dimensioning (calculated based on PE)
  dimensionedArea?: number; // mÂ² calculated
  dimensionedDepth?: number; // m
  estimatedCost?: number; // Scaled to PE

  // Neighbor consent (if required)
  neighborConsentRequired: boolean;
  neighborConsentObtained?: boolean;
  neighborDetails?: {
    address: string;
    distance: number;
  };

  // Entrepreneur/Consultant
  entrepreneurId?: string;
  entrepreneurName?: string;
  entrepreneurLicense?: string;

  // Documents
  situationPlan?: {
    generatedDate: string;
    url: string; // S3 or storage
  };

  crossSection?: {
    generatedDate: string;
    url: string;
  };

  performanceDeclaration?: {
    productName: string;
    manufacturerId: string;
    url: string;
  };

  // Status
  status: 'DRAFT' | 'UNDER_REVIEW' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedDate?: string;
  approvedDate?: string;

  // Metadata
  createdAt: string;
  updatedAt: string;
  currentGates: Gate[];
}

// ============================================================================
// GIS ANALYSIS RESULT
// ============================================================================

export interface SewageGISAnalysis {
  propertyId: string;
  timestamp: string;

  // SGU Data
  sguJordartData: {
    soilType: string;
    depthToRock: number;
    groundwaterLevel: number;
    loadingCapacity: 'LOW' | 'MEDIUM' | 'HIGH';
  };

  sguBrunnarData: {
    nearestOwnWell?: {
      distance: number;
      coordinates: { lat: number; lng: number };
    };
    nearestNeighborWells: Array<{
      distance: number;
      coordinates: { lat: number; lng: number };
    }>;
  };

  // NaturvÃ¥rdsverket Data
  protectedAreas: Array<{
    name: string;
    type: 'NATURA2000' | 'WATER_PROTECTION' | 'NATURE_RESERVE';
    distance: number;
  }>;

  // LantmÃ¤teriet Data
  propertyBoundaries: {
    area: number; // mÂ²
    perimeter: number; // m
    nearestNeighbor: number; // distance to property line
  };

  // Climate/Hydrology
  floodRiskZone?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    floodFrequency: string; // e.g., "1:100 years"
  };

  // Summary & Risk
  overallRiskScore: number; // 0-100
  feasibilityScore: number; // 0-100 (how suitable for sewage)
  recommendedSystems: SewageSystemTypeId[];
  blockedSystems: SewageSystemTypeId[];
  reasoning: string[];
}

// ============================================================================
// SOURCE TRACING (for AI-generated content)
// ============================================================================

export interface SewageSourceTracing {
  source: 'GEMINI_AI' | 'SGU' | 'LANTMATERIET' | 'NATURVARDSVERK' | 'LOCAL_RULES' | 'MUNICIPAL_DATABASE';
  timestamp: string;
  version: string;
  confidence?: number; // 0-100 for AI
}

// ============================================================================
// SEWAGE REQUIREMENTS CHECKLIST
// ============================================================================

export interface SewageRequirement {
  id: string;
  category: 'DESIGN' | 'DISTANCE' | 'SOIL' | 'NEIGHBOR' | 'DOCUMENT' | 'PERMISSION';
  requirement: string;
  reason: string;
  status: 'DRAFT' | 'REVIEW' | 'COMPLETED' | 'BLOCKED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  applicableTo: SewageSystemTypeId[]; // Which system types need this
  relatedMunicipalCode?: string;
  sourceTracing: SewageSourceTracing;
  blockingFactor?: string;
}

// ============================================================================
// SEWAGE MUNICIPAL PROFILE
// ============================================================================

export interface SewageMunicipalProfile {
  municipalityCode: string; // Comuna-kod
  municipalityName: string;

  generalRequirements: SewageRequirement[];
  protectionLevelRequirements: {
    normal: SewageRequirement[];
    high: SewageRequirement[];
  };

  allowedSystems: SewageSystemTypeId[];
  prohibitedSystems: SewageSystemTypeId[];

  processingTimeWeeks: number;
  contactEmail: string;
  eServiceUrl?: string;

  updatedAt: string;
}

