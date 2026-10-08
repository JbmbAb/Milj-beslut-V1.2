import type {
  ConditionalExchangeRequest,
  ConditionalExchangeResponse,
  ConditionalValidatorExchange,
} from "./PrefetchValidator";

/**
 * One conditional HEAD for the prefetch port.
 *
 * This is not `DownloadTransport.get`. It never issues GET, never sends Range,
 * and never retries. 307 and 308 stay HEAD. 301, 302, and 303 are refused
 * without a second request. A non-null body is cancelled and not read.
 */

export interface HttpConditionalHeadExchangeOptions {
  readonly isUrlAllowed: (url: string) => boolean;
  readonly maxRedirects?: number;
  readonly userAgent?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_REDIRECTS = 3;

export class HttpConditionalHeadExchange implements ConditionalValidatorExchange {
  private readonly isUrlAllowed: (url: string) => boolean;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpConditionalHeadExchangeOptions) {
    this.isUrlAllowed = options.isUrlAllowed;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.userAgent = options.userAgent ?? "miljobeslut-governed-harvester/1.0";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async exchange(request: ConditionalExchangeRequest): Promise<ConditionalExchangeResponse> {
    let current = request.locatorIdentity;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (!this.isUrlAllowed(current)) {
        return { finalUrl: current, status: 0, etag: null, failure: "scope" };
      }

      const response = await this.fetchOnce(current, request.ifNoneMatch);
      const status = response.status;

      if (status === 301 || status === 302 || status === 303) {
        await cancelUnread(response);
        return { finalUrl: current, status, etag: null, failure: "unsupported" };
      }

      if (status === 307 || status === 308) {
        const location = response.headers.get("location");
        await cancelUnread(response);
        if (!location) {
          return { finalUrl: current, status, etag: null, failure: "unsupported" };
        }
        current = new URL(location, current).toString();
        continue;
      }

      if (response.body !== null) {
        await cancelUnread(response);
        return { finalUrl: current, status, etag: null, failure: "unsupported" };
      }

      return {
        finalUrl: current,
        status,
        etag: response.headers.get("etag"),
      };
    }

    return { finalUrl: current, status: 0, etag: null, failure: "unsupported" };
  }

  private async fetchOnce(url: string, ifNoneMatch: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": this.userAgent,
          accept: "*/*",
          "if-none-match": ifNoneMatch,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function cancelUnread(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is not evidence. A cancel failure still leaves the exchange unsupported.
  }
}
