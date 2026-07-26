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
  variant?: string;
  hash?: string;
}

/** Metadata parsed from `# prompt_version=...` header in best_prompt.txt. */
export interface PromptMetadata {
  promptVersion?: string;
  variant?: string;
  hash?: string;
  gitCommit?: string;
}

export class RerankPromptService {
  private static cache: CachedPrompt | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  // Request Coalescing (Single Flight)
  private static activeFetchPromise: Promise<{ template: string; version: string }> | null = null;

  // Cache Hydration Daemon
  private static hydrationInterval: NodeJS.Timeout | null = null;

  // Token-Bucket Rate Limiter State
  private static tokens = 5;
  private static readonly MAX_TOKENS = 5;
  private static lastRefill = Date.now();
  private static readonly REFILL_RATE_PER_MS = 5 / 10000; // 5 tokens per 10,000ms (10 seconds)

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
   * Refills the token bucket based on elapsed time.
   */
  private static refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.MAX_TOKENS, this.tokens + elapsed * this.REFILL_RATE_PER_MS);
    this.lastRefill = now;
  }

  /**
   * Tries to acquire a token from the bucket. Returns true on success, false if rate-limited.
   */
  public static acquireToken(): boolean {
    this.refillTokens();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Downloads prompt from GCS with exponential backoff and jitter.
   */
  private static async downloadWithRetry(
    storage: Storage,
    bucket: string,
    name: string,
    maxRetries = 3,
    baseDelayMs = 100
  ): Promise<Buffer> {
    let attempt = 0;
    while (true) {
      try {
        const [contentBuffer] = await storage.bucket(bucket).file(name).download();
        return contentBuffer;
      } catch (error) {
        attempt++;
        if (attempt > maxRetries) {
          throw error;
        }
        // Exponential backoff with random jitter
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
        logger.warn(
          `GCS-nedladdning misslyckades (försök ${attempt}/${maxRetries + 1}). Försöker igen om ${Math.round(
            delay
          )}ms. Fel: ${(error as Error).message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Parses optional metadata header written by prompt_optimizer (best_prompt.txt).
   */
  public static parsePromptFile(raw: string): { template: string; metadata: PromptMetadata } {
    const lines = raw.split('\n');
    const metadata: PromptMetadata = {};
    let bodyLines = lines;

    const first = lines[0]?.trim() ?? '';
    if (first.startsWith('# prompt_version=')) {
      const header = first.slice(1).trim();
      for (const token of header.split(/\s+/)) {
        const eq = token.indexOf('=');
        if (eq <= 0) continue;
        const key = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (key === 'prompt_version') metadata.promptVersion = value;
        if (key === 'variant') metadata.variant = value;
        if (key === 'hash') metadata.hash = value;
        if (key === 'git') metadata.gitCommit = value;
      }
      bodyLines = lines.slice(1);
    }

    return {
      template: bodyLines.join('\n').trim(),
      metadata,
    };
  }

  private static resolveVersion(configVersion: string, metadata: PromptMetadata): string {
    const trimmed = configVersion.trim();
    if (trimmed && trimmed !== 'auto') {
      return trimmed;
    }
    if (metadata.hash) {
      return metadata.hash;
    }
    if (metadata.promptVersion) {
      return metadata.promptVersion;
    }
    return trimmed || 'default';
  }

  /**
   * Loads the prompt template from the configured GCS URI, local file, or environment variable.
   * Leverages in-memory caching with TTL, request coalescing, and retry wrapping.
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

    // 2. Request Coalescing (Single Flight)
    if (this.activeFetchPromise) {
      logger.info('Ansluter till pågående GCS-nedladdning (Request Coalescing/Single Flight).');
      return this.activeFetchPromise;
    }

    // 3. Try loading from GCS if configured
    if (gcsUri.startsWith('gs://')) {
      // Check Rate Limiting
      if (!this.acquireToken()) {
        logger.warn(
          `Hastighetsbegränsning överskriden för GCS-nedladdning (Rate Limit: 5 anrop/10s). Faller tillbaka direkt.`
        );
        return this.fallbackToLocalOrDefault(localFilePath, configVersion);
      }

      this.activeFetchPromise = (async () => {
        try {
          logger.info(`Laddar reranker-prompt från GCS: ${gcsUri} (version: ${configVersion})`);
          const storage = new Storage();
          const { bucket, name } = this.parseGsUri(gcsUri);
          const contentBuffer = await this.downloadWithRetry(storage, bucket, name);
          const raw = contentBuffer.toString('utf8');
          const { template, metadata } = this.parsePromptFile(raw);
          const version = this.resolveVersion(configVersion, metadata);

          logger.info(
            `Rerank prompt loaded from GCS (variant=${metadata.variant ?? 'n/a'}, hash=${metadata.hash ?? 'n/a'}, version=${version})`
          );

          this.cache = {
            version,
            template,
            timestamp: Date.now(),
            variant: metadata.variant,
            hash: metadata.hash,
          };

          // Automatically trigger the background hydration daemon if not already running
          this.startHydrationDaemon();

          return { template, version };
        } catch (error) {
          logger.error(
            `Misslyckades att ladda prompt från GCS (${gcsUri}) efter omförsök: ${(error as Error).message}. Faller tillbaka.`
          );
          // Return fallback paths
          return this.fallbackToLocalOrDefault(localFilePath, configVersion);
        } finally {
          this.activeFetchPromise = null;
        }
      })();

      return this.activeFetchPromise;
    }

    return this.fallbackToLocalOrDefault(localFilePath, configVersion);
  }

  /**
   * Fallback routing: local file or hardcoded default.
   */
  private static async fallbackToLocalOrDefault(
    localFilePath: string,
    configVersion: string
  ): Promise<{ template: string; version: string }> {
    const now = Date.now();
    // Try loading from a local file if configured
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

    // Fallback to default hardcoded prompt
    logger.debug('Använder standard hårdkodad reranker-prompt.');
    return { template: DEFAULT_RERANK_PROMPT, version: 'default' };
  }

  /**
   * Starts the background cache hydration daemon to refresh the prompt before it expires.
   */
  public static startHydrationDaemon(intervalMs = 4 * 60 * 1000): void {
    const gcsUri = (process.env.LEGAL_RERANKER_PROMPT_GCS || '').trim();
    if (!gcsUri.startsWith('gs://')) {
      return; // No need to hydrate if not using GCS
    }

    if (this.hydrationInterval) {
      return; // Already running
    }

    logger.info(`Startar bakgrundshydrering för reranker-prompter (intervall: ${intervalMs}ms)`);
    this.hydrationInterval = setInterval(async () => {
      try {
        logger.debug('Kör bakgrundshydrering för GCS-reranker-prompt...');
        
        // We use acquireToken to respect rate limits even in the background daemon
        if (!this.acquireToken()) {
          logger.warn('Bakgrundshydrering hoppas över p.g.a. hastighetsbegränsning.');
          return;
        }

        const configVersion = (process.env.LEGAL_RERANKER_PROMPT_VERSION || 'default').trim();
        const storage = new Storage();
        const { bucket, name } = this.parseGsUri(gcsUri);
        const contentBuffer = await this.downloadWithRetry(storage, bucket, name);
        const raw = contentBuffer.toString('utf8');
        const { template, metadata } = this.parsePromptFile(raw);
        const version = this.resolveVersion(configVersion, metadata);

        this.cache = {
          version,
          template,
          timestamp: Date.now(),
          variant: metadata.variant,
          hash: metadata.hash,
        };
        logger.info(
          `Bakgrundshydrering lyckades (variant=${metadata.variant ?? 'n/a'}, hash=${metadata.hash ?? 'n/a'}, version=${version})`
        );
      } catch (error) {
        logger.error(`Misslyckades vid bakgrundshydrering av reranker-prompt: ${(error as Error).message}`);
      }
    }, intervalMs);

    // Unref the timer so it doesn't block node process from exiting
    if (this.hydrationInterval && typeof this.hydrationInterval.unref === 'function') {
      this.hydrationInterval.unref();
    }
  }

  /**
   * Stops the background hydration daemon.
   */
  public static stopHydrationDaemon(): void {
    if (this.hydrationInterval) {
      clearInterval(this.hydrationInterval);
      this.hydrationInterval = null;
      logger.info('Stoppade bakgrundshydrering för reranker-prompter.');
    }
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
   * Clears ONLY the cached prompt and active fetch promise, preserving rate limit state.
   */
  public static clearPromptCacheOnly(): void {
    this.cache = null;
    this.activeFetchPromise = null;
  }

  /**
   * Clears the in-memory cache and state (primarily for unit tests).
   */
  public static clearCache(): void {
    this.cache = null;
    this.activeFetchPromise = null;
    this.tokens = 5;
    this.lastRefill = Date.now();
  }
}
