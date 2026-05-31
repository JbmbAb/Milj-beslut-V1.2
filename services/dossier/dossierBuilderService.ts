import { Client } from 'pg';
import type { EnvironmentalDataInput } from '../orchestrator/vertexDirigentService.js';

export class DossierBuilderService {
    constructor(private db: Client) {}

    private async getSguData(propertyEWKT: string): Promise<EnvironmentalDataInput['sgu']> {
        const query = `
            SELECT DISTINCT jordart_namn 
            FROM env.env_sgu_jordarter 
            WHERE ST_Intersects(geom, ST_Transform(ST_GeomFromEWKT($1), 3006))
        `;
        const res = await this.db.query(query, [propertyEWKT]);
        const soilTypes = res.rows.map(r => r.jordart_namn).filter(Boolean);
        
        return {
            soilTypes,
            bedrockTypes: [], 
            distanceToNearestWellMeters: null,
        };
    }

    private async getTopoData(propertyEWKT: string): Promise<{ distanceToSurfaceWaterMeters: number | null }> {
        const query = `
            SELECT ST_Distance(
                ST_Transform(ST_GeomFromEWKT($1), 3006),
                geom
            ) as dist
            FROM public.env_viss_vattenforekomster
            ORDER BY ST_Transform(ST_GeomFromEWKT($1), 3006) <-> geom
            LIMIT 1
        `;
        const res = await this.db.query(query, [propertyEWKT]);
        const distance = res.rows.length > 0 ? parseFloat(res.rows[0].dist) : null;

        return {
            distanceToSurfaceWaterMeters: distance,
        };
    }

    private async getSluLakeContext(propertyEWKT: string): Promise<Record<string, unknown> | null> {
        const query = `
            SELECT
              c.lake_name,
              c.monitor_program,
              ch.stationname,
              ch.ph_start,
              ch.totp_start,
              ch.totn_start,
              ch.toc_start
            FROM hydro.slu_lake_catchment c
            LEFT JOIN hydro.slu_lake_characteristics ch
              ON ch.mvm_id = c.mvm_id AND ch.monitor_program = c.monitor_program
            WHERE ST_Intersects(c.geom, ST_Transform(ST_GeomFromEWKT($1), 3006))
            ORDER BY ST_Area(c.geom) ASC
            LIMIT 1
        `;
        try {
            const res = await this.db.query(query, [propertyEWKT]);
            if (res.rows.length === 0) return null;
            return res.rows[0];
        } catch {
            return null;
        }
    }

    /**
     * Bygger hela EnvironmentalDataInput-objektet för en fastighet
     */
    async buildDossierPayload(propertyDesignation: string): Promise<EnvironmentalDataInput | null> {
        // 1. Hämta fastighetens geometri (UNION om det är flera polygoner)
        const propRes = await this.db.query(
            "SELECT ST_AsEWKT(ST_Union(geom)) as ewkt FROM core.property_unit WHERE designation LIKE $1",
            [propertyDesignation + '%']
        );
        
        if (propRes.rows.length === 0 || !propRes.rows[0].ewkt) {
            return null;
        }
        const propertyEWKT = propRes.rows[0].ewkt;

        // 2. Kör alla datatjänster parallellt för extrem prestanda
        const [sguData, topoData, sluLake] = await Promise.all([
            this.getSguData(propertyEWKT),
            this.getTopoData(propertyEWKT),
            this.getSluLakeContext(propertyEWKT),
        ]);

        // 3. Tvätta PII och pussla ihop till Vertex AI formatet
        const aiData: EnvironmentalDataInput = {
            propertyId: propertyDesignation.replace(/[^A-Za-z0-9]/g, '_'),
            geometry: { type: 'Polygon' }, // Dold för AI:n (PII-tvättad)
            sgu: sguData,
            hydrography: {
                distanceToSurfaceWaterMeters: topoData.distanceToSurfaceWaterMeters,
                isWaterProtectionArea: false, // TODO: Lägg till Vattenskyddsområde-tjänst
            },
            smhi: sluLake
                ? {
                      monitoredLake: {
                          name: sluLake.lake_name ?? sluLake.stationname,
                          program: sluLake.monitor_program,
                          phStart: sluLake.ph_start ?? null,
                          totpStart: sluLake.totp_start ?? null,
                          totnStart: sluLake.totn_start ?? null,
                          tocStart: sluLake.toc_start ?? null,
                      },
                  }
                : undefined,
            ebh: { contaminatedAreasWithin500m: 0 }, // TODO: Lägg till MIFO-tjänst
            requestType: 'ENSKILT_AVLOPP'
        };

        return aiData;
    }
}
