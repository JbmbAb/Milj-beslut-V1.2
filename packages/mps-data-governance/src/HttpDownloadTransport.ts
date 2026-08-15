import {
  GovernedDownloadError,
  type DownloadResponse,
  type DownloadTransport,
} from "./GovernedDownloadContracts";

/**
 * P2 — the only real network implementation of `DownloadTransport`.
 *
 * ⚠️ REDIRECTS ARE THE HOLE THE UP-FRONT URL CHECK CANNOT COVER.
 *
 * `GovernedDownloadExecutor` validates every target URL against the source's `allowed_domains`
 * before issuing any request. A redirect happens AFTER that check, so a `302` to another host
 * would leave the governed path entirely while still looking like an approved download. The
 * transport is therefore the only place that constraint can be enforced, and it re-validates
 * every hop through the caller-supplied predicate.
 *
 * The predicate is supplied, never computed here: the registry decides what is in scope, the
 * transport merely refuses to leave it. Deciding scope here would be the second source-authority
 * model the programme forbids.
 *
 * @see ./GovernedDownloadExecutor.ts
 * @see ./SourceRegistry.ts (isUrlAllowedForVerifiedSource)
 */
export interface HttpDownloadTransportOptions {
  /**
   * Returns true if the URL is within the approved scope. Called for the initial URL and for
   * EVERY redirect target.
   */
  readonly isUrlAllowed: (url: string) => boolean;
  /** Bounded so a redirect loop fails fast rather than hanging under a generous timeout. */
  readonly maxRedirects?: number;
  readonly userAgent?: string;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_REDIRECTS = 3;

export class HttpDownloadTransport implements DownloadTransport {
  private readonly isUrlAllowed: (url: string) => boolean;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpDownloadTransportOptions) {
    this.isUrlAllowed = options.isUrlAllowed;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.userAgent = options.userAgent ?? "miljobeslut-governed-harvester/1.0";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async get(
    url: string,
    options: { readonly timeout_ms: number; readonly max_bytes?: number },
  ): Promise<DownloadResponse> {
    let current = url;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (!this.isUrlAllowed(current)) {
        throw new GovernedDownloadError(
          hop === 0
            ? `REJECT_URL_SCOPE: '${current}' is outside the approved scope.`
            : `REJECT_REDIRECT_SCOPE: redirect ${hop} led to '${current}', outside the approved ` +
              "scope. A redirect off an approved domain leaves the governed path while still " +
              "appearing to be an approved download.",
          hop === 0 ? "REJECT_URL_SCOPE" : "REJECT_REDIRECT_SCOPE",
        );
      }

      const response = await this.fetchOnce(current, options.timeout_ms);

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new GovernedDownloadError(
            `REJECT_REDIRECT: ${response.status} without a Location header from '${current}'.`,
            "REJECT_REDIRECT",
          );
        }
        current = new URL(location, current).toString();
        continue;
      }

      const bytes = await readBounded(response, options.max_bytes, current);
      return {
        status: response.status,
        bytes,
        headers: headersToRecord(response.headers),
      };
    }

    throw new GovernedDownloadError(
      `REJECT_REDIRECT_LIMIT: more than ${this.maxRedirects} redirects starting at '${url}'.`,
      "REJECT_REDIRECT_LIMIT",
    );
  }

  private async fetchOnce(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        // Handled explicitly above — `redirect: "follow"` would hide the hops from the scope
        // check, which is the entire reason this class exists.
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": this.userAgent, accept: "*/*" },
      });
    } catch (error) {
      throw new GovernedDownloadError(
        `REJECT_TRANSPORT: '${url}' failed: ${error instanceof Error ? error.message : String(error)}`,
        // Classified as an HTTP-status-shaped fault so the executor's retry policy applies:
        // a timeout or reset is transient, unlike a governance refusal.
        "REJECT_HTTP_STATUS",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `Headers.entries()` is not in every lib target; `forEach` is the portable form. */
function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Reads the body while enforcing the size limit DURING transfer.
 *
 * Checking `content-length` alone would trust the server, and buffering the whole body before
 * measuring would mean the limit is enforced only after the bytes are already in memory —
 * which is not a limit.
 */
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
