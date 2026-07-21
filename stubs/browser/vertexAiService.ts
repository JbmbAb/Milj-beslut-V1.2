/**
 * Browser-build stub: ersätter `server/services/vertexAiService` i Vite så att
 * `@google-cloud/vertexai` (och node-fetch) aldrig bundlas till klienten.
 * Verkliga Vertex-anrop kör enbart under Node/Express.
 *
 * Typer speglar `server/services/vertexAiService` men dupliceras här så Vite
 * inte följer in i Node-SDK:en.
 */

export type VertexProfile = 'text' | 'fast' | 'json';

export interface VertexGenerateOptions {
  profile?: VertexProfile;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

export interface VertexJsonOptions<T> extends VertexGenerateOptions {
  schemaHint?: Record<string, unknown>;
  parse?: (payload: unknown) => T | null;
}

export type InlineDataPart = { mimeType: string; dataBase64: string };

function clientBundleError(): never {
  throw new Error(
    'Vertex AI får endast anropas från serverprocessen, inte från Vite-klientbundlen.',
  );
}

export async function generateTextWithVertex(
  _prompt: string,
  _options: VertexGenerateOptions = {},
): Promise<string> {
  return clientBundleError();
}

export async function generateJsonWithVertex<T = unknown>(
  _prompt: string,
  _options: VertexJsonOptions<T> = {},
): Promise<T | null> {
  return clientBundleError();
}

export async function generateTextWithVertexAndInlineData(
  _prompt: string,
  _inline: InlineDataPart,
  _options: VertexGenerateOptions = {},
): Promise<string> {
  return clientBundleError();
}

export function ensureVertexCredentialsFromJsonEnv(): void {}

export function __resetVertexClientForTest(): void {}

export function vertexConfigStatus(): {
  configured: boolean;
  missing: string[];
  projectId: string | null;
  location: string;
  hasExplicitServiceAccountFile: boolean;
} {
  return {
    configured: false,
    missing: ['vertexAiService stub (Vite-klient)'],
    projectId: null,
    location: 'europe-west1',
    hasExplicitServiceAccountFile: false,
  };
}
