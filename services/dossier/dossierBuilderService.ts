import { Client } from 'pg';
import type { EnvironmentalDataInput } from '../orchestrator/vertexDirigentService.js';

export class DossierBuilderService {
    constructor(private db: Client) {}

    private async getSguData(_propertyEWKT: string): Promise<EnvironmentalDataInput['sgu']> {
        return {
            soilTypes: [],
            bedrockTypes: [],
            distanceToNearestWellMeters: null,
        };
    }

    private async getTopoData(_propertyEWKT: string): Promise<{ distanceToSurfaceWaterMeters: number | null }> {
        return {
            distanceToSurfaceWaterMeters: null,
        };
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
        const [sguData, topoData] = await Promise.all([
            this.getSguData(propertyEWKT),
            this.getTopoData(propertyEWKT)
        ]);

        // 3. Tvätta PII och pussla ihop till Vertex AI formatet
        const aiData: EnvironmentalDataInput = {
            propertyId: propertyDesignation.replace(/[^A-Za-z0-9]/g, '_'),
            geometry: { type: 'Polygon' }, // Dold för AI:n (PII-tvättad)
            sgu: sguData,
            hydrography: {
                distanceToSurfaceWaterMeters: topoData.distanceToSurfaceWaterMeters,
                isWaterProtectionArea: false // TODO: Lägg till Vattenskyddsområde-tjänst
            },
            ebh: { contaminatedAreasWithin500m: 0 }, // TODO: Lägg till MIFO-tjänst
            requestType: 'ENSKILT_AVLOPP'
        };

        return aiData;
    }
}
