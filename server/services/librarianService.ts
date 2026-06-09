/**
 * librarianService.ts
 *
 * Tjänst för Mimer Bibliotekarie — plattformens geodata-expert och arkivarie.
 * Använder LIBRARIAN_SYSTEM_PROMPT för att planera och granska dataflöden.
 */

import { generateTextWithVertex } from './vertexAiService';
import { LIBRARIAN_SYSTEM_PROMPT } from './librarianSystemPrompt';
import { logger } from '../logger';

export interface LibrarianPlanRequest {
  datasetName: string;
  provider: string;
  sourceUrl?: string;
  description?: string;
  format?: string;
}

export interface LibrarianReviewRequest {
  tableName: string;
  currentSchema: string;
  sampleData?: any[];
}

export class LibrarianService {
  /**
   * Planerar en ny datainhämtning (Harvesting Plan).
   */
  static async planHarvesting(req: LibrarianPlanRequest): Promise<string> {
    const prompt = `
Planera en ny datainhämtning (Harvesting) för följande dataset:
- Namn: ${req.datasetName}
- Leverantör: ${req.provider}
- Källa: ${req.sourceUrl || 'Ej angiven'}
- Beskrivning: ${req.description || 'Ingen beskrivning'}
- Format: ${req.format || 'Okänt'}

Skapa en konkret handlingsplan enligt Mimers Brunn-policyn.
Inkludera strategi för bulk-nedladdning och rate-limiting.
`;

    try {
      return await generateTextWithVertex(prompt, {
        systemInstruction: LIBRARIAN_SYSTEM_PROMPT,
        profile: 'text',
        temperature: 0.2,
      });
    } catch (e) {
      logger.error('LibrarianService.planHarvesting failed', e);
      throw e;
    }
  }

  /**
   * Planerar anslutning till myndighetsdiarier.
   */
  static async planDiaryIntegration(authority: string, region: string): Promise<string> {
    const prompt = `
Planera en systematisk anslutning och övervakning av diariet för:
- Myndighet: ${authority}
- Region/Kommun: ${region}

Identifiera kända mönster för denna myndighets webbdiarium och föreslå en scraping- och arkiveringsstrategi.
`;

    try {
      return await generateTextWithVertex(prompt, {
        systemInstruction: LIBRARIAN_SYSTEM_PROMPT,
        profile: 'text',
        temperature: 0.2,
      });
    } catch (e) {
      logger.error('LibrarianService.planDiaryIntegration failed', e);
      throw e;
    }
  }

  /**
   * Planerar selektiv dammsugning baserat på metadata.
   */
  static async planSelectiveScraping(metadataSource: string, targetCriteria: string): Promise<string> {
    const prompt = `
Planera en selektiv dammsugning (Scraping) baserat på följande:
- Metadatakälla: ${metadataSource}
- Kriterier för relevans: ${targetCriteria}

Skapa en strategi för att identifiera, ladda ner och arkivera relevanta filer utan att belasta servern onödigt.
`;

    try {
      return await generateTextWithVertex(prompt, {
        systemInstruction: LIBRARIAN_SYSTEM_PROMPT,
        profile: 'text',
        temperature: 0.2,
      });
    } catch (e) {
      logger.error('LibrarianService.planSelectiveScraping failed', e);
      throw e;
    }
  }

  /**
   * Granskar och optimerar en befintlig PostGIS-tabell.
   */
  static async reviewPostGisTable(req: LibrarianReviewRequest): Promise<string> {
    const prompt = `
Granska och optimera följande PostGIS-tabell:
- Tabellnamn: ${req.tableName}
- Nuvarande schema:
${req.currentSchema}

${req.sampleData ? `Exempeldata:\n${JSON.stringify(req.sampleData, null, 2)}` : ''}

Föreslå indexering, partitionering och eventuella semantiska vyer (Context Bridge).
`;

    try {
      return await generateTextWithVertex(prompt, {
        systemInstruction: LIBRARIAN_SYSTEM_PROMPT,
        profile: 'text',
        temperature: 0.1,
      });
    } catch (e) {
      logger.error('LibrarianService.reviewPostGisTable failed', e);
      throw e;
    }
  }

  /**
   * Allmän kontext-fråga till bibliotekarien.
   */
  static async askLibrarian(question: string, context?: string): Promise<string> {
    const prompt = `
Fråga till Mimer Bibliotekarie:
${question}

${context ? `Kontext:\n${context}` : ''}
`;

    try {
      return await generateTextWithVertex(prompt, {
        systemInstruction: LIBRARIAN_SYSTEM_PROMPT,
        profile: 'text',
        temperature: 0.3,
      });
    } catch (e) {
      logger.error('LibrarianService.askLibrarian failed', e);
      throw e;
    }
  }
}
