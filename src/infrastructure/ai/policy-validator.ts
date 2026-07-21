// src/infrastructure/ai/policy-validator.ts

import { Logger } from '../observability/logger';

export interface IPolicyValidator {
  validate(prompt: string, policies?: string[]): { valid: boolean; reason?: string };
}

export class PolicyValidator implements IPolicyValidator {
  private logger = new Logger('PolicyValidator');

  validate(prompt: string, policies?: string[]): { valid: boolean; reason?: string } {
    const lowerPrompt = prompt.toLowerCase();

    // Sökbegränsningar - förhindra sökningar utanför Mimers Brunn
    const forbiddenKeywords = [
      'sök på internet',
      'sök på google',
      'search the web',
      'search the internet',
      'search google',
      'wikipedia',
      'external api',
      'hämta live-data från externa',
    ];

    for (const keyword of forbiddenKeywords) {
      if (lowerPrompt.includes(keyword)) {
        this.logger.warn(`Inkommande prompt blockerad av policy: "${keyword}" hittades.`);
        return {
          valid: false,
          reason: `Prompt bryter mot Mimers Brunn-policyn: tillåter inte externa nätverkssökningar ("${keyword}").`,
        };
      }
    }

    // Om vi har specifika policies angivna, kontrollera dem
    if (policies && policies.includes('OFFLINE_ONLY')) {
      const liveUrlPattern = /https?:\/\/(?!localhost|127\.0\.0\.1|miljobeslut\.local)/;
      if (liveUrlPattern.test(lowerPrompt)) {
        this.logger.warn('Inkommande prompt blockerad av OFFLINE_ONLY policy pga extern URL-referens.');
        return {
          success: false,
          valid: false,
          reason: 'Mimers Brunn OFFLINE_ONLY: Externa live-URL:er får inte skickas i prompter.',
        } as any;
      }
    }

    return { valid: true };
  }
}
