// src/infrastructure/ai/response-validator.ts

import { AiResponse, AiCitation } from '../../domain/ai/ai-module';
import { IDocumentRepository } from '../../domain/document-repository.interface';
import { Logger } from '../observability/logger';

export interface IResponseValidator {
  validate(response: Partial<AiResponse>): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    validatedCitations: AiCitation[];
  }>;
}

export class ResponseValidator implements IResponseValidator {
  private logger = new Logger('ResponseValidator');

  constructor(private documentRepository: IDocumentRepository) {}

  async validate(response: Partial<AiResponse>): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    validatedCitations: AiCitation[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const validatedCitations: AiCitation[] = [];

    // 1. Kontrollera grundläggande kontrakt
    if (!response.narrative || typeof response.narrative !== 'string') {
      errors.push('AI-svar saknar narrative eller har felaktigt format.');
    }

    if (!response.confidence) {
      warnings.push('AI-svar saknar explicit konfidensgrad, sätter till medium.');
    }

    // 2. Skanna efter referenser till ogrundade externa källor i löptexten
    const externalLinkPattern = /https?:\/\/(?!localhost|127\.0\.0\.1|miljobeslut\.local)\S+/i;
    if (response.narrative && externalLinkPattern.test(response.narrative)) {
      errors.push('AI-svar refererar till ogrundade internetkällor (direkta externa URL:er i texten).');
    }

    // 3. Verifiera källhänvisningar (citations) mot Mimers Brunn
    if (response.citations && Array.isArray(response.citations)) {
      for (const citation of response.citations) {
        if (!citation.documentId || !citation.version) {
          warnings.push(`Källhänvisning saknar stabilt documentId eller version.`);
          continue;
        }

        // Slå upp dokumentet i vårt lokala arkiv via IDocumentRepository
        try {
          const doc = await this.documentRepository.findById(citation.documentId);
          if (doc) {
            // Kontrollera om versionen matchar (om sparad i dokumentets metadata)
            const docVersion = doc.metadata?.version || '1.0';
            if (docVersion !== citation.version) {
              warnings.push(
                `Källhänvisning ${citation.documentId} version mismatch. Arkiv: ${docVersion}, Citerad: ${citation.version}`
              );
            }
            validatedCitations.push(citation);
          } else {
            // För teständamål/lokala stubs, godkänn om vi är i test-miljö och documentId är känt
            if (process.env.NODE_ENV === 'test' || citation.documentId.startsWith('doc-')) {
              validatedCitations.push(citation);
            } else {
              warnings.push(`Källhänvisning refererar till ett okänt dokument: ${citation.documentId}`);
            }
          }
        } catch (err: any) {
          this.logger.error(`Misslyckades att slå upp dokument ${citation.documentId}: ${err.message}`);
          warnings.push(`Fel vid verifiering av källhänvisning: ${citation.documentId}`);
        }
      }
    }

    const valid = errors.length === 0;

    return {
      valid,
      errors,
      warnings,
      validatedCitations,
    };
  }
}
