import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { resolve } from "node:path";

/**
 * Process-owned exclusive lease for one validator-binding store root.
 *
 * The named pipe is the ownership. A file in the store is not. Binding the
 * pipe succeeds only while no other process holds it, and the kernel drops
 * that ownership when this process exits. There is no PID, mtime, or timeout
 * recovery, and no fallback to a file heuristic.
 */

export class LeaseAlreadyHeldError extends Error {
  readonly reason_code = "LEASE_ALREADY_HELD" as const;

  constructor(message: string) {
    super(message);
    this.name = "LEASE_ALREADY_HELD";
  }
}

export class LeaseUnavailableError extends Error {
  readonly reason_code = "LEASE_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "LeaseUnavailableError";
  }
}

export interface ValidatorBindingLease {
  readonly pipeName: string;
  release(): Promise<void>;
}

const PIPE_PREFIX = "\\\\.\\pipe\\loke-v0-validator-binding-";

/** Same resolved root always maps to the same pipe. The digest is not truncated. */
export function validatorBindingPipeName(storeRoot: string): string {
  const normalized = resolve(storeRoot).replace(/[\\/]+$/, "");
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `${PIPE_PREFIX}${digest}`;
}

export function acquireValidatorBindingLease(storeRoot: string): Promise<ValidatorBindingLease> {
  return bindExclusivePipe(validatorBindingPipeName(storeRoot));
}

export function bindExclusivePipe(pipeName: string): Promise<ValidatorBindingLease> {
  return new Promise((resolveLease, reject) => {
    const server = createServer();
    const onError = (error: NodeJS.ErrnoException) => {
      server.close();
      if (error.code === "EADDRINUSE") {
        reject(new LeaseAlreadyHeldError(`LEASE_ALREADY_HELD: ${pipeName}`));
        return;
      }
      reject(
        new LeaseUnavailableError(
          `LEASE_UNAVAILABLE: named pipe could not be established (${error.code ?? "unknown"})`,
        ),
      );
    };
    server.once("error", onError);
    try {
      server.listen(pipeName, () => {
        server.removeListener("error", onError);
        resolveLease({
          pipeName,
          release: () => closeServer(server),
        });
      });
    } catch (error) {
      const coded = error as NodeJS.ErrnoException;
      onError(coded);
    }
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
