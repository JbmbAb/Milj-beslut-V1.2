export class CanonicalSerializer {
  serialize(value: unknown): Uint8Array {
    const canonicalString = this.canonicalStringify(value);
    return new TextEncoder().encode(canonicalString);
  }

  private canonicalStringify(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    
    if (Array.isArray(value)) {
      return `[${value.map(v => this.canonicalStringify(v)).join(",")}]`;
    }
    
    if (value instanceof Uint8Array) {
      return `[${Array.from(value).join(",")}]`;
    }
    
    if (typeof value === "object") {
      const keys = Object.keys(value).sort();
      const properties = keys.map(k => `${JSON.stringify(k)}:${this.canonicalStringify((value as any)[k])}`);
      return `{${properties.join(",")}}`;
    }
    
    return JSON.stringify(value);
  }
}
