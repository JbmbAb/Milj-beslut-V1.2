import { generateUUIDv7 } from './UUIDv7';

/**
 * Pluggable UUID source (Fas 4 M7).
 * Default implementation is process-local RFC 9562 UUIDv7; swap for
 * crypto.randomUUID / external KMS / test fakes without touching ledger callers.
 */
export interface UUIDProvider {
  generate(): string;
}

/** Default Mimers UUIDv7 provider (monotonic within the process). */
export class UUIDv7Provider implements UUIDProvider {
  generate(): string {
    return generateUUIDv7();
  }
}

const defaultProvider: UUIDProvider = new UUIDv7Provider();
let activeProvider: UUIDProvider = defaultProvider;

/** Resolve the process-wide UUID provider (defaults to {@link UUIDv7Provider}). */
export function getUUIDProvider(): UUIDProvider {
  return activeProvider;
}

/**
 * Replace the process-wide UUID provider (tests / alternate RFC implementations).
 * Pass `undefined` to restore the default UUIDv7 provider.
 */
export function setUUIDProvider(provider: UUIDProvider | undefined): void {
  activeProvider = provider ?? defaultProvider;
}

/** Generate a ledger event id via the active {@link UUIDProvider}. */
export function newLedgerEventId(): string {
  return activeProvider.generate();
}
