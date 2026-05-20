/**
 * Service for interacting with SLU Artdatabanken API
 * Handles species observations, red-listed species, and taxonomy.
 */
export class SluService {
    private readonly obsBaseUrl = 'https://api.artdatabanken.se/observation/v1';
    private readonly taxonomyBaseUrl = 'https://api.artdatabanken.se/taxonomy/v1';
    private readonly keys: {
        obs: string | undefined;
        taxonomy: string | undefined;
    };

    constructor() {
        this.keys = {
            obs: process.env.SLU_ARTDATA_OBS_KEY,
            taxonomy: process.env.SLU_ARTDATA_TAXONOMY_KEY
        };
    }

    /**
     * Hämtar artobservationer inom ett visst område (bbox eller radie).
     * @param lat Latitude
     * @param lon Longitude
     * @param radiusMeters Radie i meter
     */
    async getSpeciesObservations(lat: number, lon: number, radiusMeters: number = 500): Promise<any> {
        if (!this.keys.obs) {
            console.warn('SLU_ARTDATA_OBS_KEY saknas. Returnerar mock-data för SLU.');
            return this.getMockObservations();
        }

        try {
            // SLU API kräver ofta OCP-Apim-Subscription-Key
            // Vi använder sökning baserat på koordinater
            // Exempel: /observations/search
            const response = await fetch(`${this.obsBaseUrl}/Observations/Search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Ocp-Apim-Subscription-Key': this.keys.obs
                },
                body: JSON.stringify({
                    searchArea: {
                        type: 'Circle',
                        center: { lat, lon },
                        radius: radiusMeters
                    },
                    // Vi filtrerar ofta på rödlistade eller skyddade arter för miljöbeslut
                    isRedlisted: true
                })
            });

            if (!response.ok) {
                console.error(`SLU Obs API fel: ${response.status}`);
                return this.getMockObservations();
            }

            return await response.json();
        } catch (error) {
            console.error('Kunde inte kontakta SLU Obs API:', error);
            return this.getMockObservations();
        }
    }

    private getMockObservations() {
        return {
            status: 'mock',
            totalCount: 0,
            observations: []
        };
    }
}

export const sluService = new SluService();
