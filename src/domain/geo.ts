/**
 * GEO DOMAIN
 * Hanterar geografiska riskbedömningar, GIS-data och fastighetsinformation.
 */

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  UNKNOWN = 'UNKNOWN',
}

export enum GeoLayerType {
  WATER_PROTECTION = 'WATER_PROTECTION',
  SOIL_CONTAMINATION = 'SOIL_CONTAMINATION',
  NATURA_2000 = 'NATURA_2000',
  FLOOD_RISK = 'FLOOD_RISK',
}

export interface GeoAssessment {
  id: string;
  projectId: string;
  layerType: GeoLayerType;
  riskLevel: RiskLevel;
  distanceMeters?: number;
  details: string;
  assessedAt: Date;
}

export interface PropertyInfo {
  id: string;
  designation: string; // T.ex. "STOCKHOLM ADOLF FREDRIK 1:1"
  municipality: string;
  areaM2?: number;
  ownerName?: string;
  boundaryWkt?: string; // Well-Known Text representation of geometry
  geometry?: unknown; // WGS84 GeoJSON geometry/feature when local PostGIS can provide it
  centroid?: { lat: number; lng: number };
}

export interface MunicipalityInfo {
  code: string;
  name: string;
  county: string;
  contactEmail?: string;
}
