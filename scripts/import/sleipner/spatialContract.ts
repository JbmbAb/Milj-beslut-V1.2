/**
 * 🜄 Sleipner — Spatial Evidence Contracts (Paket 1)
 * 
 * Definierar det strikta, omutliga kontraktet för geografisk bevisbindning
 * och relationerna mellan fastigheter, ärenden och rumsliga PostGIS-lager.
 * 
 * Normativa regler (SHALL-statements):
 *   - SpatialEvidenceArtifact SHALL be immutable.
 *   - SpatialEvidenceArtifact SHALL explicitly declare its CRS (default EPSG:3006 SWEREF99 TM).
 *   - Spatial queries SHALL be deterministic and reproducible.
 */

export interface SpatialEvidenceArtifact {
  artifact_id: string;          // Unikt ID (loke-spatial-UUID)
  case_id: string;              // Koppling till EnvironmentalCase
  geometry_wkt: string;         // Geometrin i Well-Known Text (WKT) format
  epsg_code: number;            // Koordinatsystem, standard 3006 (SWEREF99 TM)
  bounding_box: {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
  };
  provenance_file_hash: string; // Referens till källfilen (CaseEvidence) som gav koordinaterna
  created_at: string;
}

export interface PropertyToCaseRelation {
  relation_id: string;
  property_designation: string; // Fastighetsbeteckning (t.ex. 'Mora Sanden 1:15')
  case_id: string;
  intersection_area_m2?: number; // Yta av överlappet i kvadratmeter (PostGIS-beräknat)
  intersection_ratio?: number;   // Andel av fastigheten som överlappar [0.0 - 1.0]
  confidence: number;            // [0.0 - 1.0] baserat på matchningsstyrka
  source_evidence_id: string;    // Bevisdokumentet som etablerade kopplingen
  created_at: string;
}

export interface SpatialQueryContract {
  /**
   * Uppdaterar eller infogar ett ärendes PostGIS-geometri
   */
  upsertCaseGeometry(caseId: string, wktGeometry: string, epsg?: number): Promise<void>;

  /**
   * Hittar alla miljöärenden som skär (intersect) en fastighets geometri
   */
  findCasesIntersectingProperty(propertyWkt: string, epsg?: number): Promise<PropertyToCaseRelation[]>;

  /**
   * Hittar alla ärenden inom ett rektangulärt sökområde (Bounding Box)
   */
  findCasesWithinBbox(minX: number, minY: number, maxX: number, maxY: number, epsg?: number): Promise<string[]>;
}
