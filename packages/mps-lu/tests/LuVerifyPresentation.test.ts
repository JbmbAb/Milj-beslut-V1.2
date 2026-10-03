import { describe, it, expect } from "vitest";
import { classifyVerifyPresentation } from "../src/index";

/**
 * W-PLUMB-S (U30R6-VERIFICATION, U30R6b finding R6b-2; owner decision 2026-10-02: a PASS over a V1/legacy-unbound form
 * must never look like the same green verification as a fully bound V4) -- classifyVerifyPresentation is the ONE
 * fail-closed decision the server sends to the UI, so it must not be fooled by the input's shape:
 *  (a) it reads the input's OWN data properties only -- never an inherited one (Object.create, a polluted
 *      Object.prototype / Array.prototype) and never a getter;
 *  (b) a throwing getter, a throwing or revoked Proxy is NOT_VERIFIED, never an exception; every property is read at
 *      most once, so a stateful Proxy cannot show one thing to one check and another thing to the next;
 *  (c) a FULLY_BOUND PASS with an unknown or malformed notice is NOT_VERIFIED, never green -- and a LEGACY_UNBOUND_FORM
 *      PASS likewise: only the two known notice shapes, each at most once;
 *  (d) cyclic and enormous structures are safe (no recursion, no walk over an over-long array).
 * The oracle below is written out here independently of the code.
 */

const LEGACY_CODE = "LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY";
const NOT_CHECKED_CODE = "NOT_CHECKED_CAUSE_NOT_PINNED";
const OWNER_TEXT_SV =
  "Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.";

type Plain = Record<string, unknown>;

const legacy = (overrides: Plain = {}): Plain => ({
  code: LEGACY_CODE,
  basis: "V1_FORM",
  authenticity_verified: false,
  current_authority_verified: false,
  text_sv: OWNER_TEXT_SV,
  finding_ids: [],
  detail: "x",
  ...overrides,
});
const notChecked = (overrides: Plain = {}): Plain => ({
  code: NOT_CHECKED_CODE,
  finding_ids: ["finding-notchecked-ebh"],
  detail: "x",
  ...overrides,
});
const greenPass = (overrides: Plain = {}): Plain => ({ outcome: "PASS", mismatches: [], notices: [], verification_binding: "FULLY_BOUND", ...overrides });
const legacyPass = (overrides: Plain = {}): Plain => ({
  outcome: "PASS",
  mismatches: [],
  notices: [legacy()],
  verification_binding: "LEGACY_UNBOUND_FORM",
  ...overrides,
});

/** Runs `fn` with `key` defined on `proto` (a global prototype pollution), always removing it again. */
function withPollution<T>(proto: object, key: PropertyKey, value: unknown, fn: () => T): T {
  Object.defineProperty(proto, key, { value, configurable: true, writable: true, enumerable: false });
  try {
    return fn();
  } finally {
    delete (proto as Record<PropertyKey, unknown>)[key];
  }
}

describe("W-PLUMB-S (R6b-2): classifyVerifyPresentation reads own data only and never throws", () => {
  it("controls: the well-formed shapes keep their class", () => {
    expect(classifyVerifyPresentation(greenPass())).toBe("FULLY_BOUND_GREEN");
    expect(classifyVerifyPresentation(greenPass({ notices: [notChecked()] }))).toBe("FULLY_BOUND_GREEN");
    expect(classifyVerifyPresentation(legacyPass())).toBe("LEGACY_UNBOUND_NOTICE");
    expect(classifyVerifyPresentation(legacyPass({ notices: [legacy({ basis: "LEGACY_UNBOUND" }), notChecked()] }))).toBe("LEGACY_UNBOUND_NOTICE");
    expect(classifyVerifyPresentation(Object.freeze(greenPass({ notices: Object.freeze([Object.freeze(notChecked())]) })))).toBe("FULLY_BOUND_GREEN");
    // A null-prototype object with the same own fields is the same data.
    expect(classifyVerifyPresentation(Object.assign(Object.create(null), legacyPass()))).toBe("LEGACY_UNBOUND_NOTICE");
  });

  it("(a) an inherited field never counts: Object.create, a __proto__ literal, an inherited notice or notice field", () => {
    const cases: [string, unknown][] = [
      ["the whole green result inherited", Object.create(greenPass())],
      ["the strength inherited (__proto__ literal)", { outcome: "PASS", mismatches: [], notices: [], __proto__: { verification_binding: "FULLY_BOUND" } }],
      ["the outcome inherited", Object.assign(Object.create({ outcome: "PASS" }), { mismatches: [], notices: [], verification_binding: "FULLY_BOUND" })],
      ["the notices inherited", Object.assign(Object.create({ notices: [] }), { outcome: "PASS", mismatches: [], verification_binding: "FULLY_BOUND" })],
      ["the legacy notice's fields inherited", legacyPass({ notices: [Object.create(legacy())] })],
      ["the legacy notice's text inherited", legacyPass({ notices: [Object.assign(Object.create({ text_sv: OWNER_TEXT_SV }), { ...legacy(), text_sv: undefined })] })],
    ];
    // The last case must not be own-text by accident.
    delete ((cases[5]![1] as Plain).notices as Plain[])[0]!.text_sv;
    for (const [label, input] of cases) expect(classifyVerifyPresentation(input), label).toBe("NOT_VERIFIED");
  });

  it("(a) a GLOBAL prototype pollution never turns an answer green or into the notice presentation", () => {
    const withoutStrength = { ok: true, outcome: "PASS", assessmentArtifactId: "a", mismatches: [], notices: [], outcome_sv: "x" };
    expect(withPollution(Object.prototype, "verification_binding", "FULLY_BOUND", () => classifyVerifyPresentation(withoutStrength))).toBe("NOT_VERIFIED");
    expect(withPollution(Object.prototype, "outcome", "PASS", () => classifyVerifyPresentation({ mismatches: [], notices: [], verification_binding: "FULLY_BOUND" }))).toBe("NOT_VERIFIED");
    expect(withPollution(Object.prototype, "mismatches", [], () => classifyVerifyPresentation({ outcome: "PASS", notices: [], verification_binding: "FULLY_BOUND" }))).toBe("NOT_VERIFIED");
    // A hole in the notices array filled from Array.prototype: not an own element of the answer.
    const holey: unknown[] = [];
    holey.length = 1;
    expect(withPollution(Array.prototype, "0", legacy(), () => classifyVerifyPresentation(legacyPass({ notices: holey })))).toBe("NOT_VERIFIED");
    // A notice whose fields come from a polluted Object.prototype.
    const bare = { code: LEGACY_CODE, basis: "V1_FORM", finding_ids: [], detail: "x", text_sv: OWNER_TEXT_SV };
    expect(
      withPollution(Object.prototype, "authenticity_verified", false, () =>
        withPollution(Object.prototype, "current_authority_verified", false, () => classifyVerifyPresentation(legacyPass({ notices: [bare] })))),
    ).toBe("NOT_VERIFIED");
  });

  it("(a)(b) a getter is never read as data -- also one that returns a well-formed value", () => {
    const getter = (target: Plain, key: string, value: unknown) => {
      const copy: Plain = { ...target };
      delete copy[key];
      Object.defineProperty(copy, key, { get: () => value, enumerable: true, configurable: true });
      return copy;
    };
    for (const key of ["outcome", "mismatches", "notices", "verification_binding"]) {
      expect(classifyVerifyPresentation(getter(greenPass(), key, greenPass()[key])), key).toBe("NOT_VERIFIED");
    }
    for (const key of ["code", "basis", "authenticity_verified", "current_authority_verified", "text_sv", "finding_ids", "detail"]) {
      expect(classifyVerifyPresentation(legacyPass({ notices: [getter(legacy(), key, legacy()[key])] })), key).toBe("NOT_VERIFIED");
    }
    const elementGetter: unknown[] = [];
    Object.defineProperty(elementGetter, "0", { get: () => notChecked(), enumerable: true, configurable: true });
    expect(classifyVerifyPresentation(greenPass({ notices: elementGetter }))).toBe("NOT_VERIFIED");
  });

  it("(b) a throwing getter, a throwing Proxy trap or a revoked Proxy is NOT_VERIFIED -- never an exception", () => {
    const boom = () => {
      throw new Error("boom");
    };
    const throwingField = (target: Plain, key: string) => {
      const copy: Plain = { ...target };
      delete copy[key];
      Object.defineProperty(copy, key, { get: boom, enumerable: true, configurable: true });
      return copy;
    };
    const inputs: [string, () => unknown][] = [
      ["throwing outcome", () => throwingField(greenPass(), "outcome")],
      ["throwing notices", () => throwingField(greenPass(), "notices")],
      ["throwing notice field", () => legacyPass({ notices: [throwingField(legacy(), "text_sv")] })],
      ["Proxy throwing on every trap", () => new Proxy(greenPass(), { get: boom, getOwnPropertyDescriptor: boom, has: boom, ownKeys: boom, getPrototypeOf: boom })],
      ["Proxy over the notices throwing on every trap", () => greenPass({ notices: new Proxy([notChecked()], { get: boom, getOwnPropertyDescriptor: boom, has: boom, ownKeys: boom }) })],
      ["revoked Proxy", () => { const { proxy, revoke } = Proxy.revocable(greenPass(), {}); revoke(); return proxy; }],
      ["revoked Proxy as the notices", () => { const { proxy, revoke } = Proxy.revocable([] as unknown[], {}); revoke(); return greenPass({ notices: proxy }); }],
      ["revoked Proxy as a notice", () => { const { proxy, revoke } = Proxy.revocable(notChecked(), {}); revoke(); return greenPass({ notices: [proxy] }); }],
    ];
    for (const [label, make] of inputs) {
      let verdict: unknown;
      expect(() => { verdict = classifyVerifyPresentation(make()); }, label).not.toThrow();
      expect(verdict, label).toBe("NOT_VERIFIED");
    }
  });

  it("(b) every property of the input is read at most once -- a stateful Proxy cannot answer two checks differently", () => {
    const reads = new Map<string, number>();
    const counted = <T extends object>(name: string, target: T): T =>
      new Proxy(target, {
        get(t, key, receiver) {
          reads.set(`${name}.${String(key)}`, (reads.get(`${name}.${String(key)}`) ?? 0) + 1);
          return Reflect.get(t, key, receiver);
        },
        getOwnPropertyDescriptor(t, key) {
          reads.set(`${name}.${String(key)}`, (reads.get(`${name}.${String(key)}`) ?? 0) + 1);
          return Reflect.getOwnPropertyDescriptor(t, key);
        },
      });
    for (const [label, input, expected] of [
      ["green", () => counted("r", greenPass({ notices: counted("n", [counted("n0", notChecked())]) })), "FULLY_BOUND_GREEN"],
      ["legacy", () => counted("r", legacyPass({ notices: counted("n", [counted("n0", legacy()), counted("n1", notChecked())]) })), "LEGACY_UNBOUND_NOTICE"],
    ] as const) {
      reads.clear();
      expect(classifyVerifyPresentation(input()), label).toBe(expected);
      for (const [key, count] of reads) expect(count, `${label}: ${key} read ${count} times`).toBe(1);
    }
    // The stateful attack itself: the first read of notices[0] shows a NOT_CHECKED notice, every later read the legacy
    // notice. Whatever the class, it is the class of ONE consistent view -- here green over [notChecked] and never the
    // notice presentation over a notice list the classifier saw twice differently.
    let n = 0;
    const flipping = new Proxy([notChecked()], {
      getOwnPropertyDescriptor(t, key) {
        if (key === "0") return { value: n++ === 0 ? notChecked() : legacy(), writable: true, enumerable: true, configurable: true };
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
      get(t, key, receiver) {
        if (key === "0") return n++ === 0 ? notChecked() : legacy();
        return Reflect.get(t, key, receiver);
      },
    });
    expect(classifyVerifyPresentation(greenPass({ notices: flipping }))).toBe("FULLY_BOUND_GREEN");
    expect(n, "notices[0] was read exactly once").toBe(1);
  });

  it("(c) a FULLY_BOUND PASS with an unknown or malformed notice is NOT_VERIFIED, never green", () => {
    const malformed: [string, unknown][] = [
      ["an unknown code", { code: "SOMETHING_NEW", finding_ids: [], detail: "x" }],
      ["null", null],
      ["a number", 1],
      ["a string", NOT_CHECKED_CODE],
      ["an array", [NOT_CHECKED_CODE]],
      ["the binding's name as code", { code: "LEGACY_UNBOUND_FORM" }],
      ["NOT_CHECKED without finding_ids", { code: NOT_CHECKED_CODE, detail: "x" }],
      ["NOT_CHECKED with finding_ids not an array", notChecked({ finding_ids: "finding-notchecked-ebh" })],
      ["NOT_CHECKED with a non-string finding id", notChecked({ finding_ids: [7] })],
      ["NOT_CHECKED with an empty finding id", notChecked({ finding_ids: [""] })],
      ["NOT_CHECKED without detail", { code: NOT_CHECKED_CODE, finding_ids: ["finding-notchecked-ebh"] }],
      ["NOT_CHECKED with a detail that is not a string", notChecked({ detail: { text: "x" } })],
      ["NOT_CHECKED as a String object code", notChecked({ code: new String(NOT_CHECKED_CODE) })],
    ];
    for (const [label, notice] of malformed) {
      expect(classifyVerifyPresentation(greenPass({ notices: [notice] })), label).toBe("NOT_VERIFIED");
      expect(classifyVerifyPresentation(legacyPass({ notices: [legacy(), notice] })), `${label} (next to the legacy notice)`).toBe("NOT_VERIFIED");
    }
    expect(classifyVerifyPresentation(greenPass({ notices: [notChecked(), notChecked()] })), "NOT_CHECKED twice").toBe("NOT_VERIFIED");
    expect(classifyVerifyPresentation(legacyPass({ notices: [legacy(), notChecked(), notChecked()] })), "NOT_CHECKED twice beside the legacy notice").toBe("NOT_VERIFIED");
    // The legacy notice's own two remaining fields are part of its shape too.
    expect(classifyVerifyPresentation(legacyPass({ notices: [legacy({ finding_ids: ["finding-x"] })] })), "legacy notice with finding ids").toBe("NOT_VERIFIED");
    expect(classifyVerifyPresentation(legacyPass({ notices: [legacy({ finding_ids: undefined })] })), "legacy notice without finding_ids").toBe("NOT_VERIFIED");
    expect(classifyVerifyPresentation(legacyPass({ notices: [legacy({ detail: undefined })] })), "legacy notice without detail").toBe("NOT_VERIFIED");
    expect(classifyVerifyPresentation(legacyPass({ notices: [legacy({ text_sv: new String(OWNER_TEXT_SV) })] })), "the owner's text as a String object").toBe("NOT_VERIFIED");
    // The strength itself as a String object is not the strength.
    expect(classifyVerifyPresentation(greenPass({ verification_binding: new String("FULLY_BOUND") })), "a String object strength").toBe("NOT_VERIFIED");
  });

  it("(d) cyclic and enormous structures are safe: no exception, no walk over an over-long array", () => {
    const cyclic = greenPass({ notices: [notChecked()] });
    cyclic.self = cyclic;
    ((cyclic.notices as Plain[])[0] as Plain).self = (cyclic.notices as Plain[])[0];
    expect(classifyVerifyPresentation(cyclic)).toBe("FULLY_BOUND_GREEN");
    const cyclicNotices: unknown[] = [];
    cyclicNotices.push(cyclicNotices);
    expect(classifyVerifyPresentation(greenPass({ notices: cyclicNotices }))).toBe("NOT_VERIFIED");

    // An enormous notices array (or mismatches, or finding ids) is refused without being walked: count every access.
    let accesses = 0;
    const huge = (length: number, fill: unknown) =>
      new Proxy(new Array(length).fill(fill), {
        get(t, key, receiver) { accesses += 1; return Reflect.get(t, key, receiver); },
        getOwnPropertyDescriptor(t, key) { accesses += 1; return Reflect.getOwnPropertyDescriptor(t, key); },
        has(t, key) { accesses += 1; return Reflect.has(t, key); },
      });
    for (const [label, make] of [
      ["10^6 notices", () => greenPass({ notices: huge(1_000_000, notChecked()) })],
      ["10^6 legacy notices", () => legacyPass({ notices: huge(1_000_000, legacy()) })],
      ["10^6 mismatches", () => greenPass({ mismatches: huge(1_000_000, { code: "X", detail: "x" }) })],
      ["10^6 finding ids", () => greenPass({ notices: [notChecked({ finding_ids: huge(1_000_000, "finding-notchecked-ebh") })] })],
    ] as const) {
      accesses = 0;
      expect(classifyVerifyPresentation(make()), label).toBe("NOT_VERIFIED");
      expect(accesses, `${label}: accesses`).toBeLessThan(100);
    }
  });
});

describe("W-PLUMB-S (R6b-2): exhaustive matrix -- outcome x strength x notices x mismatches x the input's form", () => {
  /** The independent oracle over PLAIN data: what may be green, what may be the owner's notice presentation. */
  function oracle(input: Plain): string {
    const isStr = (v: unknown) => typeof v === "string";
    const wellFormedNotChecked = (n: unknown) => {
      const x = n as Plain | null;
      return typeof n === "object" && n !== null && !Array.isArray(n) && x!.code === NOT_CHECKED_CODE && Array.isArray(x!.finding_ids) &&
        (x!.finding_ids as unknown[]).every((id) => isStr(id) && (id as string).length > 0) && isStr(x!.detail);
    };
    const wellFormedLegacy = (n: unknown) => {
      const x = n as Plain | null;
      return typeof n === "object" && n !== null && !Array.isArray(n) && x!.code === LEGACY_CODE && x!.text_sv === OWNER_TEXT_SV &&
        x!.authenticity_verified === false && x!.current_authority_verified === false && (x!.basis === "V1_FORM" || x!.basis === "LEGACY_UNBOUND") &&
        Array.isArray(x!.finding_ids) && (x!.finding_ids as unknown[]).length === 0 && isStr(x!.detail);
    };
    if (input.outcome !== "PASS" || !Array.isArray(input.mismatches) || input.mismatches.length !== 0 || !Array.isArray(input.notices)) return "NOT_VERIFIED";
    const notices = input.notices as unknown[];
    if (input.verification_binding === "FULLY_BOUND") {
      return notices.length <= 1 && notices.every(wellFormedNotChecked) ? "FULLY_BOUND_GREEN" : "NOT_VERIFIED";
    }
    if (input.verification_binding === "LEGACY_UNBOUND_FORM") {
      return notices.length >= 1 && notices.length <= 2 && wellFormedLegacy(notices[0]) && notices.slice(1).every(wellFormedNotChecked)
        ? "LEGACY_UNBOUND_NOTICE"
        : "NOT_VERIFIED";
    }
    return "NOT_VERIFIED";
  }

  const OUTCOMES: unknown[] = ["PASS", "DENY", "pass", "", null, undefined];
  const BINDINGS: unknown[] = ["FULLY_BOUND", "LEGACY_UNBOUND_FORM", null, undefined, "", "fully_bound", "FULLY_BOUND ", "LEGACY_UNBOUND"];
  const MISMATCHES: unknown[] = [[], [{ code: "FINDINGS_MISMATCH", detail: "x" }], undefined, null];
  const POOL: Plain[] = [
    legacy(),
    legacy({ basis: "LEGACY_UNBOUND" }),
    legacy({ text_sv: "Reproducerbarhet verifierad – resultatet matchar de pinnade artefakterna." }),
    legacy({ authenticity_verified: true }),
    legacy({ finding_ids: ["finding-x"] }),
    notChecked(),
    notChecked({ finding_ids: [] }),
    notChecked({ finding_ids: [7] }),
    { code: "SOMETHING_NEW" },
  ];
  const NOTICE_SETS: unknown[] = [undefined, null, "[]", {}, []];
  for (const a of POOL) NOTICE_SETS.push([a]);
  for (const a of POOL) for (const b of POOL) NOTICE_SETS.push([a, b]);
  NOTICE_SETS.push([legacy(), notChecked(), notChecked()], [legacy(), legacy()], [null], [7]);

  /** The same data in other forms: plain and JSON-equal forms keep the oracle's class; every other form is NOT_VERIFIED. */
  const FORMS: [string, (input: Plain) => unknown, boolean][] = [
    ["plain", (input) => input, true],
    ["JSON round trip", (input) => JSON.parse(JSON.stringify(input)), true],
    ["frozen", (input) => Object.freeze({ ...input }), true],
    ["transparent Proxy", (input) => new Proxy({ ...input }, {}), true],
    ["inherited (Object.create)", (input) => Object.create(input), false],
    ["every field a getter", (input) => {
      const out: Plain = {};
      for (const key of Object.keys(input)) Object.defineProperty(out, key, { get: () => input[key], enumerable: true });
      return out;
    }, false],
    ["throwing Proxy", (input) => new Proxy(input, { get() { throw new Error("x"); }, getOwnPropertyDescriptor() { throw new Error("x"); } }), false],
  ];

  it("every combination: the class is the oracle's for the plain forms and NOT_VERIFIED for every other form; green and the notice presentation occur", () => {
    const seen: Record<string, number> = {};
    let total = 0;
    for (const outcome of OUTCOMES) {
      for (const verification_binding of BINDINGS) {
        for (const mismatches of MISMATCHES) {
          for (const notices of NOTICE_SETS) {
            const input: Plain = { outcome, verification_binding, mismatches, notices };
            for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
            // JSON drops undefined array entries' neighbours never; the plain oracle needs JSON-safe data.
            const expected = oracle(input);
            for (const [form, make, keeps] of FORMS) {
              const verdict = classifyVerifyPresentation(make(input));
              total += 1;
              seen[`${form}:${verdict}`] = (seen[`${form}:${verdict}`] ?? 0) + 1;
              if (verdict !== (keeps ? expected : "NOT_VERIFIED")) {
                expect(verdict, `${form}: ${JSON.stringify(input)}`).toBe(keeps ? expected : "NOT_VERIFIED");
              }
            }
          }
        }
      }
    }
    expect(total).toBeGreaterThan(20_000);
    // Non-vacuous: both positive classes occur in every form that keeps the data.
    for (const form of ["plain", "JSON round trip", "frozen", "transparent Proxy"]) {
      expect(seen[`${form}:FULLY_BOUND_GREEN`] ?? 0, form).toBeGreaterThan(0);
      expect(seen[`${form}:LEGACY_UNBOUND_NOTICE`] ?? 0, form).toBeGreaterThan(0);
    }
  });
});
