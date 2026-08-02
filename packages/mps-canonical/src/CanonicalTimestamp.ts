export interface CanonicalTimestamp {
  canonicalNow(): string; // RFC3339, UTC, no ms
  canonicalFrom(date: Date): string;
}

export class DefaultCanonicalTimestamp implements CanonicalTimestamp {
  canonicalNow(): string {
    return this.canonicalFrom(new Date());
  }

  canonicalFrom(date: Date): string {
    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid Date cannot be canonicalized.");
    }
    const yyyy = date.getUTCFullYear();
    const MM = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const HH = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    
    return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}Z`;
  }
}
