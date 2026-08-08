export class CASConcurrencyGuard {
  private inFlight = new Map<string, Promise<any>>();

  /**
   * Guarantees that concurrent requests for the same physical identity (hash)
   * only execute the ingestion logic once. All requests will await the same
   * underlying Promise and resolve with the same artifact identity.
   */
  async ingest<T>(identityHash: string, ingestFn: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(identityHash)) {
      return this.inFlight.get(identityHash) as Promise<T>;
    }

    const ingestionPromise = ingestFn().finally(() => {
      // Clean up after the promise resolves or rejects
      this.inFlight.delete(identityHash);
    });

    this.inFlight.set(identityHash, ingestionPromise);
    return ingestionPromise;
  }
}
