import { Storage } from '@google-cloud/storage';
import { logger } from '../logger';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_RERANK_PROMPT = `Du är en expert på svensk miljö- och fastighetsanalys. Gradera relevansen för följande textavsnitt i förhållande till sökfrågan: "{{QUERY}}".
Returnera en JSON-array med relevanspoäng (mellan 0.0 och 1.0) för varje ID i exakt samma ordning.
Exempelformat: [{"id": "chunk-1", "score": 0.95}]

Dokumentavsnitt:
{{DOCUMENTS}}`;

interface CachedPrompt {
  version: string;
  template: string;
  timestamp: number;
}

export class RerankPromptService {
  private static cache: CachedPrompt | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  /**
   * Helper to parse a gs:// URI into bucket and object name.
   */
  public static parseGsUri(uri: string): { bucket: string; name: string } {
    const clean = uri.trim().replace(/^gs:\/\//, '');
    const slashIndex = clean.indexOf('/');
    if (slashIndex === -1 || slashIndex === 0) {
      throw new Error(`Ogiltig gs://-URI: ${uri}`);
    }
    return {
      bucket: clean.slice(0, slashIndex),
      name: clean.slice(slashIndex + 1),
    };
  }

  /**
   * Loads the prompt template from the configured GCS URI, local file, or environment variable.
   * Leverages in-memory caching with TTL and version matching.
   */
  public static async getTemplate(): Promise<{ template: string; version: string }> {
    const gcsUri = (process.env.LEGAL_RERANKER_PROMPT_GCS || '').trim();
    const configVersion = (process.env.LEGAL_RERANKER_PROMPT_VERSION || 'default').trim();
    const localFilePath = (process.env.LEGAL_RERANKER_PROMPT_FILE || '').trim();

    const now = Date.now();

    // 1. Check in-memory cache
    if (
      this.cache &&
      this.cache.version === configVersion &&
      now - this.cache.timestamp < this.CACHE_TTL_MS
    ) {
      return { template: this.cache.template, version: this.cache.version };
    }

    // 2. Try loading from GCS if configured
    if (gcsUri.startsWith('gs://')) {
      try {
        logger.info(`Laddar reranker-prompt från GCS: ${gcsUri} (version: ${configVersion})`);
        const storage = new Storage();
        const { bucket, name } = this.parseGsUri(gcsUri);
        const [contentBuffer] = await storage.bucket(bucket).file(name).download();
        const template = contentBuffer.toString('utf8').trim();

        this.cache = { version: configVersion, template, timestamp: now };
        return { template, version: configVersion };
      } catch (error) {
        logger.error(`Misslyckades att ladda prompt från GCS (${gcsUri}): ${(error as Error).message}. Faller tillbaka.`);
      }
    }

    // 3. Try loading from a local file if configured
    if (localFilePath) {
      try {
        const resolvedPath = path.resolve(localFilePath);
        logger.info(`Laddar reranker-prompt från lokal fil: ${resolvedPath}`);
        if (fs.existsSync(resolvedPath)) {
          const template = await fs.promises.readFile(resolvedPath, 'utf8');
          const version = `local-${localFilePath}-${configVersion}`;
          this.cache = { version, template, timestamp: now };
          return { template, version };
        } else {
          logger.warn(`Lokal prompt-fil hittades inte: ${resolvedPath}`);
        }
      } catch (error) {
        logger.error(`Misslyckades att ladda lokal prompt-fil: ${(error as Error).message}`);
      }
    }

    // 4. Fallback to default hardcoded prompt
    logger.debug('Använder standard hårdkodad reranker-prompt.');
    return { template: DEFAULT_RERANK_PROMPT, version: 'default' };
  }

  /**
   * Formats the loaded prompt template with the actual search query and candidates.
   */
  public static async getFormattedPrompt(
    query: string,
    candidates: Array<{ id: string; chunkText: string }>
  ): Promise<{ prompt: string; version: string }> {
    const { template, version } = await this.getTemplate();

    const documentsText = candidates
      .map((c) => `ID: ${c.id}\nText: ${c.chunkText}`)
      .join('\n\n');

    let formatted = template
      .replace(/\{\{QUERY\}\}/g, query)
      .replace(/\$\{query\}/g, query);

    if (formatted.includes('{{DOCUMENTS}}')) {
      formatted = formatted.replace(/\{\{DOCUMENTS\}\}/g, documentsText);
    } else if (formatted.includes('${documents}')) {
      formatted = formatted.replace(/\$\{documents\}/g, documentsText);
    } else {
      formatted = formatted + '\n\n' + documentsText;
    }

    return { prompt: formatted, version };
  }

  /**
   * Clears the in-memory cache (primarily for unit tests).
   */
  public static clearCache(): void {
    this.cache = null;
  }
}
