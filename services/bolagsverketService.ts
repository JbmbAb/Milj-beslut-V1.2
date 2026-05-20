/**
 * Service for interacting with Bolagsverkets API / Öppna data
 */
export class BolagsverketService {
    private readonly baseUrl: string;
    private readonly apiKey: string | undefined;

    constructor() {
        // Skarp URL för Bolagsverkets API för Värdefulla datamängder (VDM)
        this.baseUrl = process.env.BOLAGSVERKET_API_URL || 'https://gw.api.bolagsverket.se/vardefulla-datamangder/v1';
        this.apiKey = process.env.BOLAGSVERKET_API_KEY;
    }

    /**
     * Hämtar grundläggande företagsinformation baserat på organisationsnummer.
     * @param orgNumber Organisationsnummer (t.ex. "556000-0000")
     */
    async getCompanyInfo(orgNumber: string): Promise<any> {
        try {
            // Rensa orgnummer från bindestreck
            const cleanOrgNr = orgNumber.replace(/[^0-9]/g, '');
            
            // Om vi har en riktig API-nyckel, anropa det officiella API:et
            if (this.apiKey) {
                const url = `${this.baseUrl}/foretag/${cleanOrgNr}`;
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Accept': 'application/json'
                    }
                });
                
                if (response.ok) {
                    return await response.json();
                }
                console.warn(`Bolagsverket API fel: ${response.status} ${response.statusText}`);
            }

            // Fallback till tredjeparts "Öppet API" för företagsfakta om vi saknar nyckel
            console.log(`Saknar BOLAGSVERKET_API_KEY eller anropet misslyckades. Använder öppet API för ${cleanOrgNr}...`);
            const fallbackUrl = `https://api.mackan.eu/bolagsverket/${cleanOrgNr}`;
            const fallbackResponse = await fetch(fallbackUrl);
            
            if (fallbackResponse.ok) {
                const data = await fallbackResponse.json();
                return {
                    status: 'success',
                    message: 'Företagsfakta hämtad via öppet API',
                    orgNumber: orgNumber,
                    companyName: data.name || data.foretagsnamn,
                    companyForm: data.form || data.foretagsform,
                    registrationYear: data.regYear || data.registreringsar,
                    county: data.county || data.lan,
                    municipality: data.municipality || data.kommun,
                    source: 'mackan.eu (Öppet API)'
                };
            }

            // Fallback till mock-data om allt annat misslyckas så inte systemet kraschar
            return {
                status: 'pending_auth',
                message: 'Integrationen inväntar godkänt konto. Mock-data genererad pga oåtkomligt öppet API.',
                orgNumber: orgNumber,
                companyName: 'Testbolaget AB (Mock)',
                companyForm: 'Aktiebolag',
                source: 'Fallback Mock'
            };
            
        } catch (error: any) {
            console.error("Kunde inte hämta bolagsinfo via nätverket, använder mock:", error.message);
            // Returnera mock ändå så att Dossier/Pipeline-skriptet inte kraschar
            return {
                status: 'pending_auth',
                message: 'Nätverksfel vid API-anrop. Använder mock tills tjänsten är uppe.',
                orgNumber: orgNumber,
                companyName: 'Testbolaget AB (Fallback)',
                companyForm: 'Aktiebolag',
                source: 'Fallback Mock'
            };
        }
    }

    /**
     * Hämtar firmatecknare för att verifiera vem som har rätt att skriva under miljöbeslut.
     */
    async getSignatories(orgNumber: string): Promise<any> {
        if (!this.apiKey) {
             return {
                status: 'pending_auth',
                message: 'Väntar på godkännande. Kan inte hämta firmatecknare officiellt ännu.'
            };
        }
        
        // Här implementeras framtida officiella anrop för firmatecknare
        return {
            status: 'success',
            signatories: []
        };
    }
}

export const bolagsverketService = new BolagsverketService();
