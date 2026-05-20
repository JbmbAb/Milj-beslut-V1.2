const API_URL = process.env.TRAFIKVERKET_API_BASE_URL || 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const API_KEY = process.env.TRAFIKVERKET_API_KEY;

export class TrafikverketService {
    /**
     * Hämtar vägdata för en specifik radie runt en koordinat.
     * Inkluderar ÅDT (Trafikmängd), Bärighetsklass och Farligt Gods.
     */
    async getRoadData(lat: number, lon: number, radiusMeters: number = 500): Promise<any> {
        if (!API_KEY) {
            console.warn('Varning: TRAFIKVERKET_API_KEY saknas i .env. Retunerar mock-data för Vertex AI.');
            return {
                status: 'pending_auth',
                message: 'Trafikverkets API kräver giltig nyckel. Integration inväntar API-nyckel.',
                mockData: {
                    nearbyRoads: [
                        { name: "Väg 70", aadt: 8500, bearingClass: "BK1", hazardousGoodsAllowed: true, distanceMeters: 45 }
                    ]
                }
            };
        }

        const xmlQuery = `
            <REQUEST>
                <LOGIN authenticationkey="${API_KEY}" />
                <QUERY objecttype="RoadData" schemaversion="1">
                    <FILTER>
                        <WITHIN name="Geometry" shape="center" value="${lon} ${lat}" radius="${radiusMeters}m" />
                    </FILTER>
                    <INCLUDE>AADT</INCLUDE>
                </QUERY>
            </REQUEST>`;
            
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml' },
                body: xmlQuery
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching data from Trafikverket:', error);
            throw error;
        }
    }
}

export const trafikverketService = new TrafikverketService();

