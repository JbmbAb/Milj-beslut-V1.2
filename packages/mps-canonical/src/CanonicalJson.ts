import { DefaultCanonicalString } from "./CanonicalString.js";
import { DefaultCanonicalNumber } from "./CanonicalNumber.js";
import { DefaultCanonicalTimestamp } from "./CanonicalTimestamp.js";
import { DefaultCanonicalBinary } from "./CanonicalBinary.js";

export interface CanonicalJson {
  canonicalize(value: unknown): unknown; // applies all rules
  toBytes(value: unknown): Uint8Array;   // UTF-8, no whitespace
}

export class DefaultCanonicalJson implements CanonicalJson {
  private strObj = new DefaultCanonicalString();
  private numObj = new DefaultCanonicalNumber();
  private timeObj = new DefaultCanonicalTimestamp();
  private binObj = new DefaultCanonicalBinary();

  canonicalize(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null; // JSON_NULL policy
    }
    if (typeof value === "number") {
      return this.numObj.canonicalize(value);
    }
    if (typeof value === "string") {
      return this.strObj.canonicalize(value);
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (value instanceof Date) {
      return this.timeObj.canonicalFrom(value);
    }
    if (value instanceof Uint8Array) {
      return Array.from(this.binObj.canonicalize(value));
    }
    if (Array.isArray(value)) {
      return value.map(v => this.canonicalize(v));
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).sort(); // LEXICOGRAPHIC_UTF8
      const canonicalObject: Record<string, unknown> = {};
      for (const k of keys) {
        const v = (value as Record<string, unknown>)[k];
        if (v !== undefined) {
            const canonicalKey = this.strObj.canonicalize(k);
            canonicalObject[canonicalKey] = this.canonicalize(v);
        }
      }
      return canonicalObject;
    }
    
    return value;
  }

  toBytes(value: unknown): Uint8Array {
    const canonicalized = this.canonicalize(value);
    const jsonStr = JSON.stringify(canonicalized);
    return new TextEncoder().encode(jsonStr || "null");
  }
}
