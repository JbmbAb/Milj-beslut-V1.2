import fetch from 'node-fetch';

/**
 * Service for interacting with Boverkets API (Digitala Författningar och Ordbok)
 * API Reference: https://api-portal.boverket.se/reference
 */
export class BoverketService {
    private readonly baseUrl: string;
    private readonly apiKey: string | undefined;

    constructor() {
        // Huvud-URL för API-portalen
        this.baseUrl = 'https://api.boverket.se';
        this.apiKey = process.env.BOVERKET_API_KEY;
    }

    private async request(endpoint: string): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
            'Accept': 'application/json'
        };

        if (this.apiKey) {
            headers['Ocp-Apim-Subscription-Key'] = this.apiKey;
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers
            });

            if (!response.ok) {
                throw new Error(`Boverket API fel vid anrop till ${endpoint}: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`Fel vid hämtning från Boverket (${endpoint}):`, error);
            throw error;
        }
    }

    /**
     * Hämtar en lista med alla författningar (BBR, EKS m.fl.)
     */
    async getForfattningar(): Promise<any> {
        return this.request('/forfattningssamling/v1/forfattningar');
    }

    /**
     * Hämtar detaljer för en specifik författning baserat på BFS-nummer
     * Exempel BFS-nummer: "BFS 2011:6" (BBR)
     */
    async getForfattning(bfsNummer: string): Promise<any> {
        // URL-koda BFS-numret ifall det innehåller mellanslag etc.
        const encodedNummer = encodeURIComponent(bfsNummer);
        return this.request(`/forfattningssamling/v1/forfattningar/${encodedNummer}`);
    }

    /**
     * Hämtar Boverkets begrepp och termer (Ordbok)
     * Ger systemet en gemensam vokabulär för plan- och byggfrågor.
     */
    async getTermbank(): Promise<any> {
        // Observera: Den exakta endpointen för Boverkets ordbok kan variera beroende på vilken version
        // av deras Termbank-API som publicerats (ofta kallat begrepp/ordbok).
        // Standardiserad gissning baserat på deras portalstruktur:
        return this.request('/termbank/v1/begrepp');
    }

    /**
     * Söker i författningar efter relevanta paragrafer (t.ex. vid miljöbeslut/bygglov)
     */
    async searchRegler(query: string): Promise<any> {
        const encodedQuery = encodeURIComponent(query);
        return this.request(`/forfattningssamling/v1/sok?query=${encodedQuery}`);
    }
}

// Singleton export if needed
export const boverketService = new BoverketService();
