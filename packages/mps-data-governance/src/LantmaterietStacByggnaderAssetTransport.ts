import {
  GovernedDownloadError,
  type DownloadResponse,
  type DownloadTransport,
} from "./GovernedDownloadContracts";

/** Dedicated runtime-only credential port for Lantmäteriet's building ZIP assets. */
export interface LantmaterietStacByggnaderCredentialProvider {
  getBearerToken(): Promise<string>;
}

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
    };
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
 * Reads only a short-lived bearer value from runtime configuration. It never persists,
 * serializes, or logs the value. OAuth client-credential exchange is intentionally outside
 * this transport; production composition must inject a dedicated provider for that flow.
 */
export class EnvironmentLantmaterietStacByggnaderCredentialProvider
  implements LantmaterietStacByggnaderCredentialProvider {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async getBearerToken(): Promise<string> {
    const token = this.environment.LANTMATERIET_STAC_BYGGNADER_BEARER_TOKEN;
    if (!token?.trim()) {
      throw new Error("Lantmäteriet building asset bearer token is not configured");
    }
    return token;
  }
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
