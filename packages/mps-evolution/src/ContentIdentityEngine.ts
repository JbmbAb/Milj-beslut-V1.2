import * as crypto from "node:crypto";

export interface CanonicalSerializer {
  serialize(input: unknown): Uint8Array;
}

export interface ContentIdentityEngine {
  hashCanonical(input: unknown): string;
}

export class DefaultContentIdentityEngine implements ContentIdentityEngine {
  constructor(private readonly serializer: CanonicalSerializer) {}

  hashCanonical(input: unknown): string {
    const bytes = this.serializer.serialize(input);
    const json = JSON.stringify(Array.from(bytes));
    return `sha256-${crypto.createHash("sha256").update(json).digest("hex")}`;
  }
}
