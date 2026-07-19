/**
 * Service for interacting with Naturvårdsverkets API
 * Primärt fokus: EBH (Efterbehandling / Förorenade områden) och Skyddad Natur
 * Många av dessa API:er är öppna data och använder WFS/REST.
 */
export class NaturvardsverketService {
  private readonly ebhBaseUrl: string;
  private readonly vicBaseUrl: string;

  constructor() {
    // Exempel på Naturvårdsverkets publika WFS / karttjänster
    this.ebhBaseUrl = 'https://vic-wfs.naturvardsverket.se/ebh';
    this.vicBaseUrl = 'https://vic-wfs.naturvardsverket.se/skyddadnatur';
  }

  /**
   * Söker efter potentiellt förorenade områden (EBH) utifrån en radie kring en punkt.
   * Detta är avgörande för miljöbeslut vid markarbeten.
   */
  async getContaminatedAreas(lat: number, lng: number, radiusMeters: number = 500): Promise<any> {
    // Denna funktion förutsätter att vi senare kan göra geometriska sökningar
    // via deras WFS eller en PostGIS-lokal spegling om vi drar ner hela lagret.
    console.log(`🔎 Letar efter EBH-objekt inom ${radiusMeters}m från [${lat}, ${lng}]...`);

    // Returnerar en mockad "öppen" respons för nu, tills vi drar in deras fulla WFS-definition
    return {
      status: 'ok',
      source: 'Naturvårdsverket (EBH)',
      features: [],
      note: 'Integrationen mot EBH WFS för radiesökning förberedd.',
    };
  }

  /**
   * Kontrollerar om en fastighet/koordinat överlappar skyddad natur (Natura 2000, Naturreservat)
   */
  async checkProtectedNature(lat: number, lng: number): Promise<any> {
    console.log(`🌲 Kontrollerar skyddad natur för [${lat}, ${lng}]...`);
    return {
      status: 'ok',
      source: 'Naturvårdsverket (Skyddad Natur)',
      protected_areas_found: [],
      note: 'Integrationen mot Skyddad Natur WFS förberedd.',
    };
  }
}

export const naturvardsverketService = new NaturvardsverketService();
