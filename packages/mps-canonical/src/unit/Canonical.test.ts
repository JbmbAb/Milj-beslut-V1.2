import { describe, expect, it } from "vitest";
import { CanonicalSerializer } from "../index";

describe("CanonicalSerializer Suite (RFC8785)", () => {
  const serializer = new CanonicalSerializer();

  it("should sort object keys deterministically", () => {
    const obj1 = { b: 2, a: 1, c: { e: 5, d: 4 } };
    const obj2 = { c: { d: 4, e: 5 }, b: 2, a: 1 };

    const bytes1 = serializer.serialize(obj1);
    const bytes2 = serializer.serialize(obj2);

    expect(bytes1).toEqual(bytes2);
    expect(new TextDecoder().decode(bytes1)).toBe('{"a":1,"b":2,"c":{"d":4,"e":5}}');
  });

  it("should handle nested arrays and Uint8Arrays correctly", () => {
    const obj = { arr: [1, 2, new Uint8Array([3, 4])] };
    const bytes = serializer.serialize(obj);

    expect(new TextDecoder().decode(bytes)).toBe('{"arr":[1,2,[3,4]]}');
  });
});
