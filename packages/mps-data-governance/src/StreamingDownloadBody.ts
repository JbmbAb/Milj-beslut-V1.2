import {
  GovernedDownloadError,
  type DownloadResponse,
} from "./GovernedDownloadContracts";

/**
 * Pull-based body for a governed acquisition.
 *
 * `read()` yields one socket chunk at a time. It never concatenates those chunks into an
 * object-sized buffer: the caller hashes and stores each chunk before asking for the next.
 */
export interface StreamingDownloadBody {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly finalUrl: string;
  /** Finite Content-Length, or null when the header is absent or not a number. */
  readonly declaredByteLength: number | null;
  /** Next chunk, or null when the body has ended. */
  read(): Promise<Uint8Array | null>;
  cancel(): Promise<void>;
}

export interface StreamingDownloadOpenOptions {
  readonly timeout_ms: number;
  readonly max_bytes?: number;
}

/**
 * Optional capability on a `DownloadTransport`.
 *
 * The frozen `get()` contract still returns a complete `Uint8Array` for small listing
 * responses. Object acquisition uses `open()` so the body is not assembled first.
 */
export interface StreamingDownloadTransport {
  open(url: string, options: StreamingDownloadOpenOptions): Promise<StreamingDownloadBody>;
}

export function isStreamingDownloadTransport(
  transport: unknown,
): transport is StreamingDownloadTransport {
  return typeof transport === "object" && transport !== null &&
    typeof (transport as { open?: unknown }).open === "function";
}

export function declaredContentLength(headers: Headers): number | null {
  const declared = Number(headers.get("content-length") ?? Number.NaN);
  return Number.isFinite(declared) ? declared : null;
}

/**
 * Content-Length is a pre-check only. A missing or understated length is still enforced
 * while chunks are pulled.
 */
export function assertDeclaredContentLength(
  headers: Headers,
  maxBytes: number | undefined,
  url: string,
): number | null {
  const declared = declaredContentLength(headers);
  if (maxBytes !== undefined && declared !== null && declared > maxBytes) {
    throw new GovernedDownloadError(
      `REJECT_OBJECT_SIZE: '${url}' declares ${declared} bytes, over the ${maxBytes} byte limit.`,
      "REJECT_OBJECT_SIZE",
    );
  }
  return declared;
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function createStreamingDownloadBody(input: {
  readonly response: Response;
  readonly finalUrl: string;
  readonly maxBytes: number | undefined;
  readonly declaredByteLength: number | null;
  /** Aborts the socket when a read stays idle longer than `idleTimeoutMs`. */
  readonly abort: () => void;
  /**
   * Maximum silence between body chunks. This is not a deadline for the whole transfer:
   * each completed read starts a new window.
   */
  readonly idleTimeoutMs: number;
  readonly onFinished: () => void;
}): StreamingDownloadBody {
  const body = input.response.body;
  let reader = body ? body.getReader() : null;
  let total = 0;
  let finished = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const clearIdle = () => {
    if (idleTimer === undefined) return;
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const finish = () => {
    clearIdle();
    if (finished) return;
    finished = true;
    input.onFinished();
  };

  const release = () => {
    reader?.releaseLock?.();
    reader = null;
    finish();
  };

  const dropReader = async () => {
    clearIdle();
    const current = reader;
    reader = null;
    if (!current) {
      finish();
      return;
    }
    try {
      await current.cancel();
    } catch {
      try {
        current.releaseLock();
      } catch {
        // The pending read or cancel already released the lock.
      }
    }
    finish();
  };

  return {
    status: input.response.status,
    headers: headersToRecord(input.response.headers),
    finalUrl: input.finalUrl,
    declaredByteLength: input.declaredByteLength,
    async read() {
      while (reader) {
        let pulled: ReadableStreamReadResult<Uint8Array>;
        try {
          pulled = await readWithIdleTimeout(reader, input.idleTimeoutMs, () => {
            idleTimer = undefined;
            input.abort();
          }, (timer) => {
            idleTimer = timer;
          });
        } catch (error) {
          await dropReader();
          if (error instanceof GovernedDownloadError) throw error;
          throw new GovernedDownloadError(
            `REJECT_TRANSPORT: '${input.finalUrl}' failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "REJECT_HTTP_STATUS",
          );
        }
        if (pulled.done) {
          release();
          return null;
        }
        const value = pulled.value;
        if (!value || value.byteLength === 0) continue;
        total += value.byteLength;
        if (input.maxBytes !== undefined && total > input.maxBytes) {
          await this.cancel();
          throw new GovernedDownloadError(
            `REJECT_OBJECT_SIZE: '${input.finalUrl}' exceeded the ${input.maxBytes} byte limit during transfer.`,
            "REJECT_OBJECT_SIZE",
          );
        }
        return value;
      }
      return null;
    },
    async cancel() {
      const current = reader;
      reader = null;
      try {
        await current?.cancel();
      } finally {
        current?.releaseLock?.();
        finish();
      }
    },
  };
}

function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  onIdle: () => void,
  rememberTimer: (timer: ReturnType<typeof setTimeout>) => void,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onIdle();
      reject(
        new GovernedDownloadError(
          `REJECT_TRANSPORT: body idle timeout after ${idleTimeoutMs}ms without a chunk.`,
          "REJECT_HTTP_STATUS",
        ),
      );
    }, idleTimeoutMs);
    rememberTimer(timer);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Header view used by validator binding. Byte identity is not taken from this object. */
export type StreamingHeaderResponse = Pick<DownloadResponse, "headers" | "finalUrl">;
