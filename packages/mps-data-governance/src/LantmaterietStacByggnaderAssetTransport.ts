import {
  GovernedDownloadError,
  type DownloadResponse,
  type DownloadTransport,
} from "./GovernedDownloadContracts";
import {
  assertDeclaredContentLength,
  createStreamingDownloadBody,
  type StreamingDownloadBody,
  type StreamingDownloadOpenOptions,
} from "./StreamingDownloadBody";

/** Runtime-only credential port for a source-scoped Lantmäteriet STAC asset transport. */
export interface LantmaterietStacByggnaderCredentialProvider {
  getBearerToken(): Promise<string>;
}

export type LantmaterietStacAuthenticationMethod =
  | "PREISSUED_BEARER"
  | "OAUTH2_CLIENT_CREDENTIALS";

export const LANTMATERIET_STAC_TOKEN_URL = "https://api.lantmateriet.se/token";
export const LANTMATERIET_API_MANAGER_TOKEN_URL = "https://apimanager.lantmateriet.se/oauth2/token";

const LANTMATERIET_TOKEN_ENDPOINTS = new Set([
  LANTMATERIET_STAC_TOKEN_URL,
  LANTMATERIET_API_MANAGER_TOKEN_URL,
]);

export interface LantmaterietStacByggnaderAssetTransportOptions {
  readonly credentialProvider: LantmaterietStacByggnaderCredentialProvider;
  readonly fetchImpl?: typeof fetch;
  readonly userAgent?: string;
}

export const LANTMATERIET_STAC_BYGGNADER_ASSET_HOST = "dl1.lantmateriet.se";

const BYGGNADER_ASSET_PATH = /^\/byggnadsverk\/byggnad_kn\d{4}\.zip$/;

/**
 * Narrow authenticated transport for the ZIP assets enumerated by Lantmäteriet's
 * `byggnader` STAC collection. It deliberately has no caller-controlled headers,
 * configurable host, or redirect following capability.
 */
export class LantmaterietStacByggnaderAssetTransport implements DownloadTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(private readonly options: LantmaterietStacByggnaderAssetTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "miljobeslut-governed-harvester/1.0";
  }

  async get(
    url: string,
    request: { readonly timeout_ms: number; readonly max_bytes?: number },
  ): Promise<DownloadResponse> {
    assertByggnaderAssetUrl(url);

    const bearerToken = await this.getBearerToken();
    const response = await this.fetchOnce(url, request.timeout_ms, bearerToken);

    // Redirects are deliberately rejected rather than followed. Reusing an authenticated
    // request at a new destination could forward a credential beyond this capability's scope.
    if (isRedirect(response.status)) {
      throw new GovernedDownloadError(
        "REJECT_AUTHENTICATED_REDIRECT: authenticated building asset requests must not follow redirects.",
        "REJECT_AUTHENTICATED_REDIRECT",
      );
    }

    return {
      status: response.status,
      bytes: await readBounded(response, request.max_bytes, url),
      headers: headersToRecord(response.headers),
      finalUrl: url,
    };
  }

  /**
   * Authenticated asset body as a pull stream. Redirects stay rejected, and the bearer token
   * is still attached only to the exact building-asset URL.
   */
  async open(url: string, request: StreamingDownloadOpenOptions): Promise<StreamingDownloadBody> {
    assertByggnaderAssetUrl(url);
    const bearerToken = await this.getBearerToken();
    const opened = await this.fetchStreaming(url, request.timeout_ms, bearerToken);

    if (isRedirect(opened.response.status)) {
      opened.abort();
      await opened.response.body?.cancel().catch(() => undefined);
      opened.finish();
      throw new GovernedDownloadError(
        "REJECT_AUTHENTICATED_REDIRECT: authenticated building asset requests must not follow redirects.",
        "REJECT_AUTHENTICATED_REDIRECT",
      );
    }

    try {
      const declaredByteLength = assertDeclaredContentLength(
        opened.response.headers,
        request.max_bytes,
        url,
      );
      return createStreamingDownloadBody({
        response: opened.response,
        finalUrl: url,
        maxBytes: request.max_bytes,
        declaredByteLength,
        abort: opened.abort,
        idleTimeoutMs: opened.idleTimeoutMs,
        onFinished: opened.finish,
      });
    } catch (error) {
      opened.abort();
      await opened.response.body?.cancel().catch(() => undefined);
      opened.finish();
      throw error;
    }
  }

  private async getBearerToken(): Promise<string> {
    try {
      const token = await this.options.credentialProvider.getBearerToken();
      if (typeof token !== "string" || token.trim().length === 0) {
        throw new Error("missing bearer token");
      }
      return token;
    } catch {
      // Never propagate provider messages: they can accidentally contain secret material.
      throw new GovernedDownloadError(
        "REJECT_CREDENTIAL_UNAVAILABLE: Lantmäteriet building-asset credential is unavailable.",
        "REJECT_CREDENTIAL_UNAVAILABLE",
      );
    }
  }

  private async fetchStreaming(
    url: string,
    timeoutMs: number,
    bearerToken: string,
  ): Promise<{
    readonly response: Response;
    readonly finish: () => void;
    readonly abort: () => void;
    readonly idleTimeoutMs: number;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const clearConnect = () => clearTimeout(timer);
    const abort = () => controller.abort();
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": this.userAgent,
          accept: "application/zip",
          authorization: `Bearer ${bearerToken}`,
        },
      });
      clearConnect();
      return { response, finish: clearConnect, abort, idleTimeoutMs: timeoutMs };
    } catch {
      clearConnect();
      throw new GovernedDownloadError(
        "REJECT_AUTH_TRANSPORT: authenticated building asset request failed.",
        "REJECT_HTTP_STATUS",
      );
    }
  }

  private async fetchOnce(url: string, timeoutMs: number, bearerToken: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": this.userAgent,
          accept: "application/zip",
          authorization: `Bearer ${bearerToken}`,
        },
      });
    } catch {
      throw new GovernedDownloadError(
        "REJECT_AUTH_TRANSPORT: authenticated building asset request failed.",
        "REJECT_HTTP_STATUS",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Resolves the existing, documented Lantmäteriet runtime contracts without moving a secret
 * between environment variables. It accepts an explicitly pre-issued bearer or obtains a
 * short-lived bearer through the official OAuth2 client-credentials endpoint. The caller still
 * decides the source and host to which the returned bearer can be sent.
 */
export class EnvironmentLantmaterietStacCredentialProvider
  implements LantmaterietStacByggnaderCredentialProvider {
  private cachedToken: { readonly value: string; readonly expiresAt: number } | null = null;

  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getBearerToken(): Promise<string> {
    const directToken = firstNonEmpty(
      this.environment.LANTMATERIET_STAC_BYGGNADER_BEARER_TOKEN,
      this.environment.LANTMATERIET_ACCESS_TOKEN,
    );
    if (directToken) {
      return directToken;
    }

    const consumerKey = this.environment.LANTMATERIET_CONSUMER_KEY?.trim();
    const consumerSecret = this.environment.LANTMATERIET_CONSUMER_SECRET?.trim();
    if (!consumerKey || !consumerSecret) {
      throw new Error("Lantmateriet STAC credential is not configured");
    }

    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }

    const response = await this.fetchImpl(resolveLantmaterietTokenUrl(this.environment), {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      // Deliberately omit upstream body: it can contain credential or account details.
      throw new Error(`Lantmateriet OAuth token request failed with HTTP ${response.status}`);
    }

    const body = await response.json() as { readonly access_token?: unknown; readonly expires_in?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token.trim()) {
      throw new Error("Lantmateriet OAuth response did not contain an access token");
    }
    const expiresInSeconds = typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(0, body.expires_in - 60)
      : 0;
    const token = body.access_token.trim();
    this.cachedToken = { value: token, expiresAt: this.now() + expiresInSeconds * 1_000 };
    return token;
  }

  authenticationMethod(): LantmaterietStacAuthenticationMethod {
    if (firstNonEmpty(
      this.environment.LANTMATERIET_STAC_BYGGNADER_BEARER_TOKEN,
      this.environment.LANTMATERIET_ACCESS_TOKEN,
    )) {
      return "PREISSUED_BEARER";
    }
    if (
      this.environment.LANTMATERIET_CONSUMER_KEY?.trim() &&
      this.environment.LANTMATERIET_CONSUMER_SECRET?.trim()
    ) {
      return "OAUTH2_CLIENT_CREDENTIALS";
    }
    throw new Error("Lantmateriet STAC authentication method is not configured");
  }
}

/** Backwards-compatible name for callers that explicitly request the building provider. */
export class EnvironmentLantmaterietStacByggnaderCredentialProvider
  extends EnvironmentLantmaterietStacCredentialProvider {}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return null;
}

function resolveLantmaterietTokenUrl(environment: Readonly<Record<string, string | undefined>>): string {
  const configured = environment.LANTMATERIET_TOKEN_URL?.trim();
  const tokenUrl = configured || LANTMATERIET_STAC_TOKEN_URL;
  if (!LANTMATERIET_TOKEN_ENDPOINTS.has(tokenUrl)) {
    throw new Error("Lantmateriet OAuth token endpoint is outside the approved scope");
  }
  return tokenUrl;
}

export function assertByggnaderAssetUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GovernedDownloadError(
      "REJECT_AUTH_ASSET_SCOPE: building asset URL is invalid.",
      "REJECT_AUTH_ASSET_SCOPE",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== LANTMATERIET_STAC_BYGGNADER_ASSET_HOST ||
    !BYGGNADER_ASSET_PATH.test(parsed.pathname) ||
    parsed.username ||
    parsed.password
  ) {
    throw new GovernedDownloadError(
      "REJECT_AUTH_ASSET_SCOPE: URL is outside the Lantmäteriet building-asset credential scope.",
      "REJECT_AUTH_ASSET_SCOPE",
    );
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function readBounded(
  response: Response,
  maxBytes: number | undefined,
  url: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (maxBytes !== undefined && Number.isFinite(declared) && declared > maxBytes) {
    throw new GovernedDownloadError(
      `REJECT_OBJECT_SIZE: '${url}' declares ${declared} bytes, over the ${maxBytes} byte limit.`,
      "REJECT_OBJECT_SIZE",
    );
  }

  const body = response.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (maxBytes !== undefined && total > maxBytes) {
        await reader.cancel();
        throw new GovernedDownloadError(
          `REJECT_OBJECT_SIZE: '${url}' exceeded the ${maxBytes} byte limit during transfer.`,
          "REJECT_OBJECT_SIZE",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
