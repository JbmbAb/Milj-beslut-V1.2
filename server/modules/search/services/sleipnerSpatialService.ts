/**
 * 🜄 Sleipner — Spatial Evidence & PostGIS Query Service
 * 
 * Implementerar det rumsliga PostGIS-kontraktet för Mimer Engine.
 * Ansvarar för deterministisk geografisk indexering, fastighetskopplingar,
 * GiST-optimering samt koordinatverifiering (SWEREF99 TM / EPSG:3006).
 */

import { prisma } from '../../../db/prisma';
import { logger } from '../../../logger';
import { SpatialQueryContract, PropertyToCaseRelation } from '../../../../scripts/import/sleipner/spatialContract';

export class SleipnerSpatialService implements SpatialQueryContract {
  
  /**
   * Automatiskt skapande av GiST-index på geografiska kolumner (GiST-optimering)
   */
  async ensureSpatialIndexes(): Promise<void> {
    try {
      logger.info('[Sleipner Spatial] Säkrar rumsliga index (GiST) i PostGIS...');
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "environmental_cases_geom_idx" ON "environmental_cases" USING GIST ("geometry")`
      );
      logger.info('[Sleipner Spatial] GiST-index säkrat framgångsrikt.');
    } catch (err) {
      logger.warn('[Sleipner Spatial] Kunde inte skapa GiST-index (kan bero på begränsade behörigheter eller saknad PostGIS i test-DB)', { err });
    }
  }

  /**
   * Uppdaterar eller infogar ett ärendes PostGIS-geometri utifrån WKT (Well-Known Text)
   * 
   * SpatialEvidenceArtifact SHALL explicitly declare its CRS (default EPSG:3006 SWEREF99 TM).
   */
  async upsertCaseGeometry(caseId: string, wktGeometry: string, epsg = 3006): Promise<void> {
    logger.info(`[Sleipner Spatial] Upsertar geometri för ärende '${caseId}' (EPSG:${epsg})...`);
    
    // Verifiera först att ärendet (Tier 1) existerar i databasen
    const dbCase = await prisma.environmentalCase.findUnique({
      where: { caseId }
    });

    if (!dbCase) {
      throw new Error(`Ärende '${caseId}' hittades inte i databasen. Kan inte lägga till geometri.`);
    }

    try {
      // Skriv geometrin direkt via PostGIS WKT-tolkning (WKB-konvertering under huven)
      // ST_GeomFromText skapar geometrin, ST_Transform säkerställer rätt EPSG-målprojektion (3006)
      await prisma.$executeRawUnsafe(
        `UPDATE "environmental_cases" 
         SET "geometry" = ST_Transform(ST_GeomFromText($1, $2), 3006) 
         WHERE id = $3`,
        wktGeometry,
        epsg,
        dbCase.id
      );
      logger.info(`   ✅ Geometri sparad deterministiskt i PostGIS för '${caseId}'.`);
    } catch (err: any) {
      logger.error(`[Sleipner Spatial] Misslyckades med att spara PostGIS-geometri för '${caseId}'`, { err });
      throw new Error(`PostGIS-exekveringsfel: ${err.message || err}`);
    }
  }

  /**
   * Hittar alla miljöärenden som skär (intersect) en fastighets geometri
   * Beräknar även den exakta överlappningsarean (m2) samt fördelning deterministiskt!
   */
  async findCasesIntersectingProperty(propertyWkt: string, epsg = 3006): Promise<PropertyToCaseRelation[]> {
    logger.info(`[Sleipner Spatial] Söker efter ärenden som skär fastighetsgeometri (WKT, EPSG:${epsg})...`);

    try {
      // Genomför en deterministisk rumslig sammanfogning (Spatial Join) via ST_Intersects
      // Beräknar överlappningsyta i kvadratmeter via ST_Area(ST_Intersection(...))
      const results: any[] = await prisma.$queryRawUnsafe(
        `SELECT 
           c.id as "case_db_id",
           c.case_id,
           c.operator,
           c.activity_code,
           ST_AsText(c.geometry) as "case_wkt",
           ST_Area(ST_Intersection(c.geometry, ST_Transform(ST_GeomFromText($1, $2), 3006))) as "overlap_area",
           ST_Area(ST_Transform(ST_GeomFromText($1, $2), 3006)) as "property_area"
         FROM "environmental_cases" c
         WHERE c.geometry IS NOT NULL 
           AND ST_Intersects(c.geometry, ST_Transform(ST_GeomFromText($1, $2), 3006))
         ORDER BY "overlap_area" DESC`,
        propertyWkt,
        epsg
      );

      const relations: PropertyToCaseRelation[] = results.map((row, idx) => {
        const overlap = Number(row.overlap_area || 0);
        const propArea = Number(row.property_area || 1); // Undvik division med 0
        const ratio = propArea > 0 ? overlap / propArea : 0;

        return {
          relation_id: `sleipner-rel-${crypto.randomUUID().substring(0, 8)}`,
          property_designation: 'Sökfastighet',
          case_id: row.case_id,
          intersection_area_m2: parseFloat(overlap.toFixed(2)),
          intersection_ratio: parseFloat(ratio.toFixed(4)),
          confidence: parseFloat(Math.min(1.0, ratio + 0.1).toFixed(2)), // Enkel heuristisk konfidensmatchning
          source_evidence_id: row.case_db_id, // Länka till ärendets bevisgrund
          created_at: new Date().toISOString()
        };
      });

      logger.info(`   🔍 Hittade ${relations.length} skärande miljöärenden.`);
      return relations;

    } catch (err: any) {
      logger.error('[Sleipner Spatial] Misslyckades med att utföra spatial sökning', { err });
      throw new Error(`PostGIS spatial sökfel: ${err.message || err}`);
    }
  }

  /**
   * Snabbsökning av alla ärenden inom ett rektangulärt sökområde (Bounding Box)
   * Drar nytta av GiST-indexets snabba bounding-box-jämförelse operators (&<, &>, ~)
   */
  async findCasesWithinBbox(minX: number, minY: number, maxX: number, maxY: number, epsg = 3006): Promise<string[]> {
    logger.info(`[Sleipner Spatial] Söker efter ärenden inom BBOX: [${minX}, ${minY}, ${maxX}, ${maxY}] (EPSG:${epsg})...`);

    // Skapa en rektangulär Polygon-WKT utifrån BBox koordinaterna
    const bboxWkt = `POLYGON((${minX} ${minY}, ${minX} ${maxY}, ${maxX} ${maxY}, ${maxX} ${minY}, ${minX} ${minY}))`;

    try {
      const results: any[] = await prisma.$queryRawUnsafe(
        `SELECT c.case_id 
         FROM "environmental_cases" c
         WHERE c.geometry IS NOT NULL 
           AND ST_Contains(ST_Transform(ST_GeomFromText($1, $2), 3006), c.geometry)
         ORDER BY c.case_id ASC`,
        bboxWkt,
        epsg
      );

      return results.map(row => row.case_id);
    } catch (err: any) {
      logger.error('[Sleipner Spatial] Misslyckades med att utföra BBox spatial sökning', { err });
      throw new Error(`PostGIS BBox sökfel: ${err.message || err}`);
    }
  }
}

import * as crypto from 'crypto';
