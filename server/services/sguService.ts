
import { logger } from "../logger";

export interface GeologicalData {
    soilType?: string;
    groundwaterVulnerability?: string;
    groundwaterFlow?: string;
    riskDescription?: string;
    groundLayerScale?: string;
    landslideFeatureHits?: Array<{
        featureCode?: number | null;
        featureLabel: string;
        distanceMeters: number;
    }>;
    landslideRiskLevel?: "NONE" | "ADVISORY" | "HIGH";
    manualReviewRequired?: boolean;
    coverageMode?: "sample" | "complete";
}

/**
 * Fetches geological data from SGU OGC API Features.
 * We focus on soil types and groundwater vulnerability.
 */
export async function fetchGeologicalData(lat: number, lng: number): Promise<GeologicalData> {
    const radiusInDegrees = 0.002; // Approx 200m
    const bbox = `${lng - radiusInDegrees},${lat - radiusInDegrees},${lng + radiusInDegrees},${lat + radiusInDegrees}`;

    const result: GeologicalData = {
        soilType: "Okänd",
        groundwaterVulnerability: "Ej bedömd"
    };

    // 1. Fetch Soil Types (Jordarter)
    try {
        const jordartUrl = `https://resource.sgu.se/service/ogc/features/jordarter-25-100-tusen/collections/jordarter/items?bbox=${bbox}&limit=1`;
        const res = await fetch(jordartUrl);
        if (res.ok) {
            const data = await res.json();
            if (data.features?.length > 0) {
                const prop = data.features[0].properties;
                result.soilType = prop.jordnamn || prop.jordart_namn || "Information saknas";
            }
        }
    } catch (e) {
        logger.error('SGU Jordarter fetch failed', { err: String(e) });
    }

    // 2. Fetch Groundwater Vulnerability (Sårbarhet)
    try {
        const sarbarhetUrl = `https://resource.sgu.se/service/ogc/features/sarbarhet-grundvatten/collections/sarbarhet/items?bbox=${bbox}&limit=1`;
        const res = await fetch(sarbarhetUrl);
        if (res.ok) {
            const data = await res.json();
            if (data.features?.length > 0) {
                const prop = data.features[0].properties;
                result.groundwaterVulnerability = prop.klass_namn || prop.beskrivning || "Låg";
            }
        }
    } catch (e) {
        logger.error('SGU Sårbarhet fetch failed', { err: String(e) });
    }

    // 3. Simple heuristic for flow/risk if missing
    if (result.groundwaterVulnerability.toLowerCase().includes("hög")) {
        result.riskDescription = "Hög risk för föroreningsspridning till grundvatten p.g.a. genomsläppliga jordlager.";
    } else {
        result.riskDescription = "Normala geologiska förutsättningar för området.";
    }

    return result;
}
