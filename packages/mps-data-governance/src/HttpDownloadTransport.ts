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
        finalUrl: current,
      };
    }

    throw new GovernedDownloadError(
      `REJECT_REDIRECT_LIMIT: more than ${this.maxRedirects} redirects starting at '${url}'.`,
      "REJECT_REDIRECT_LIMIT",
    );
  }

  /**
   * Same redirect and scope rules as `get`, but the body stays a pull stream.
   * The caller hashes and stores each chunk. This method does not assemble one.
   */
  async open(url: string, options: StreamingDownloadOpenOptions): Promise<StreamingDownloadBody> {
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

      const opened = await this.fetchStreaming(current, options.timeout_ms);

      if (isRedirect(opened.response.status)) {
        const location = opened.response.headers.get("location");
        opened.abort();
        await opened.response.body?.cancel().catch(() => undefined);
        opened.finish();
        if (!location) {
          throw new GovernedDownloadError(
            `REJECT_REDIRECT: ${opened.response.status} without a Location header from '${current}'.`,
            "REJECT_REDIRECT",
          );
        }
        current = new URL(location, current).toString();
        continue;
      }

      try {
        const declaredByteLength = assertDeclaredContentLength(
          opened.response.headers,
          options.max_bytes,
          current,
        );
        return createStreamingDownloadBody({
          response: opened.response,
          finalUrl: current,
          maxBytes: options.max_bytes,
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

    throw new GovernedDownloadError(
      `REJECT_REDIRECT_LIMIT: more than ${this.maxRedirects} redirects starting at '${url}'.`,
      "REJECT_REDIRECT_LIMIT",
    );
  }

  private async fetchStreaming(
    url: string,
    timeoutMs: number,
  ): Promise<{
    readonly response: Response;
    readonly finish: () => void;
    readonly abort: () => void;
    readonly idleTimeoutMs: number;
  }> {
    const controller = new AbortController();
    // Header/connect deadline only. Cleared when headers arrive so a long body is not
    // capped by the same timer. Silence during the body is an idle timeout instead.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const clearConnect = () => clearTimeout(timer);
    const abort = () => controller.abort();
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": this.userAgent, accept: "*/*" },
      });
      clearConnect();
      return { response, finish: clearConnect, abort, idleTimeoutMs: timeoutMs };
    } catch (error) {
      clearConnect();
      throw new GovernedDownloadError(
        `REJECT_TRANSPORT: '${url}' failed: ${error instanceof Error ? error.message : String(error)}`,
        "REJECT_HTTP_STATUS",
      );
    }
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
