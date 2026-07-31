export class JsonCanonicalizer {
  serialize(payload: unknown): Uint8Array {
    // Simple canonical JSON (sorted keys)
    const canonicalize = (obj: any): any => {
      if (typeof obj !== "object" || obj === null) return obj;
      if (Array.isArray(obj)) return obj.map(canonicalize);
      return Object.keys(obj)
        .sort()
        .reduce((acc: any, key) => {
          acc[key] = canonicalize(obj[key]);
          return acc;
        }, {});
    };
    return new Uint8Array(Buffer.from(JSON.stringify(canonicalize(payload))));
  }
}
