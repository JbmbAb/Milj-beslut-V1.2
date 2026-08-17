import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * 🔴 P3-LU-DOCUMENT-CLASSIFICATION-01C — POSTGIS DOCUMENT AUTHORITY BYPASS REMOVAL (RED).
 *
 *   01B built the governed classification runtime. It did not make it MANDATORY.
 *
 *     RUNTIME FOUNDATION            PROVEN
 *     RUNTIME AUTHORITY EXCLUSIVITY NOT_PROVEN
 *
 *   One production path still mints a typed RelevantDocument with no classification at all.
 *   `PostgisDocumentProvider.mapClassificationToType()` is the frozen classification model
 *   inverted, with two separate fail-opens:
 *
 *     free producer string -> substring match -> closed RelevantDocument.type
 *     missing decisionType -> "court_decision"  -> decision
 *     unknown decisionType -> (fallthrough)     -> notification
 *
 *   Nothing there can ever be UNCLASSIFIED. `toRelevantDocumentType()` would have rejected
 *   "court_decision" correctly — it was simply never called.
 *
 *   POSTGIS_DOCUMENT_PROVIDER_AUTHORITY_V1 (frozen):
 *     PostgisDocumentProvider MUST NOT produce RelevantDocument. It MAY produce observational
 *     descriptor material. A source-provided classification string MAY be preserved as untrusted
 *     source metadata, but MUST NOT authorize RelevantDocument.type.
 *
 *   The provider is deliberately NOT connected to the governed path in this unit. No
 *   DocumentClassificationArtifact exists for this material, so wiring it up could only produce
 *   a provider that classifies implicitly, or a fabricated classification_ref. Both are forbidden.
 *
 *   ⚠️ OUT OF SCOPE, filed separately — do not widen this unit to reach them:
 *     `res[0]?.kommunnamn || "Mora"`   DOCUMENT_PROVIDER_LOCATION_FAIL_CLOSED-01
 *     LokeIngestor RawSourcePayload    evidence/provenance defect, not classification
 *
 *   ⚠️ THESE TESTS ARE EXPECTED TO FAIL until the bypass is removed. That failure IS the proof.
 */
describe("🔴 P3-LU-DOCUMENT-CLASSIFICATION-01C — RelevantDocument authority exclusivity", () => {
  const LU_SRC = resolve(__dirname, "..", "src");
  const REPO_ROOT = resolve(__dirname, "..", "..", "..");

  const POSTGIS = join(LU_SRC, "providers", "PostgisDocumentProvider.ts");
  const CONTRACT = join(LU_SRC, "providers", "DocumentProviderContract.ts");
  const AUTHORITY = join(LU_SRC, "classification", "ClassificationAuthority.ts");

  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  /** Comments describe the contract; only declarations may violate it. */
  const code = (p: string) =>
    read(p)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  // ------------------------------------------------------------------ C1

  it("C1: PostgisDocumentProvider does not map a producer string onto a document class", () => {
    const src = code(POSTGIS);

    expect(
      /mapClassificationToType/.test(src),
      "A substring match over a free producer string is not a classification. It cannot be " +
        "replayed, carries no classifier identity or version, and has no artifact to verify.",
    ).toBe(false);

    expect(
      /court_decision/.test(src),
      "`doc.decisionType || \"court_decision\"` turns a MISSING value into an admitted class. " +
        "Absence must not be representable as a decision.",
    ).toBe(false);
  });

  it("C1b: PostgisDocumentProvider constructs no RelevantDocument", () => {
    const src = code(POSTGIS);

    expect(
      /RelevantDocument/.test(src),
      "POSTGIS_DOCUMENT_PROVIDER_AUTHORITY_V1: the provider observes documents. Deciding what " +
        "a document IS belongs to a governed classifier over governed material.",
    ).toBe(false);
  });

  it("C1c: an observed source label survives as untrusted metadata, not as a type", () => {
    const src = code(POSTGIS);

    expect(
      /source_classification_label/.test(src),
      "The database's own string is real observation and must not be discarded — discarding it " +
        "would lose material a future classifier needs. It is carried as an observed value, " +
        "never as authority.",
    ).toBe(true);

    expect(
      /\btype\s*:\s*(this\.|toRelevantDocumentType|["'](decision|injunction|notification|inspection)["'])/.test(
        src,
      ),
      "No path in the provider may assign a closed-vocabulary type.",
    ).toBe(false);
  });

  // ------------------------------------------------------------------ C2

  it("C2: DocumentProviderContract no longer requires providers to produce RelevantDocument", () => {
    const src = code(CONTRACT);

    expect(
      /Promise<\s*RelevantDocument\s*\[\s*\]\s*>/.test(src),
      "The contract itself encodes the wrong authority model: it obliges every provider to hand " +
        "back typed documents, so any conforming provider must classify. Breaking this contract " +
        "visibly is the point — a provider that secretly classifies legal documents is worse " +
        "than a compile error.",
    ).toBe(false);
  });

  // ------------------------------------------------------------------ C3 / C4

  /**
   * Every production source file in LU and the provider packages.
   *
   * Tests are excluded: a test may legitimately construct a RelevantDocument to assert on the
   * shape. What it must not do is construct one WITHOUT a classification_ref, which the type
   * already forbids — and C5 keeps that from being evaded.
   */
  function productionSources(): string[] {
    const roots = [LU_SRC, join(REPO_ROOT, "packages", "document-provider", "src")];
    const found: string[] = [];

    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "tests" || entry === "__tests__") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
        found.push(full);
      }
    };

    roots.forEach(walk);
    return found;
  }

  /**
   * The approved construction surface.
   *
   * Only the classification module may assemble a RelevantDocument, and only from a verified
   * persisted artifact. The domain module declares the type and maps labels; it constructs
   * nothing.
   */
  const APPROVED = [
    join("src", "classification", "ClassificationAuthority.ts"),
    join("src", "classification", "DocumentClassifier.ts"),
    join("src", "domain", "RelevantDocument.ts"),
    join("src", "domain", "lu-domain.ts"),
    join("src", "index.ts"),
    join("src", "artifacts", "DocumentClassificationArtifact.ts"),
    join("src", "artifacts", "DocumentEvidenceArtifact.ts"),
    join("src", "providers", "DocumentProviderContract.ts"),
    join("src", "providers", "NullDocumentProvider.ts"),
  ];

  const isApproved = (file: string) => APPROVED.some((suffix) => file.endsWith(suffix));

  it("C4: no production file outside the approved surface assigns a document type", () => {
    const offenders: string[] = [];

    for (const file of productionSources()) {
      if (isApproved(file)) continue;
      const src = code(file);
      // An object literal assigning a closed-vocabulary value to `type`.
      if (/\btype\s*:\s*["'](decision|injunction|notification|inspection)["']/.test(src)) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }

    expect(
      offenders,
      "Each of these mints a typed legal claim about a document with no classification artifact " +
        "behind it. Downstream cannot distinguish it from one a governed classifier decided.",
    ).toEqual([]);
  });

  it("C5: the approved surface derives the type, it does not hard-code one", () => {
    const src = code(AUTHORITY);

    expect(
      /\btype\s*:\s*["'](decision|injunction|notification|inspection)["']/.test(src),
      "The assembly module must read the class off a verified artifact. A literal here would be " +
        "the same bypass, merely relocated inside the allowlist.",
    ).toBe(false);
  });

  // ------------------------------------------------------------------ CONTROL

  it("CONTROL: the scan is not vacuous — it sees the approved path and would see a violation", () => {
    const files = productionSources();

    expect(
      files.length,
      "A scan over an empty file list passes trivially and proves nothing.",
    ).toBeGreaterThan(10);

    expect(
      files.some((f) => f.endsWith(join("providers", "PostgisDocumentProvider.ts"))),
      "The file this unit exists to fix must be inside the scanned set.",
    ).toBe(true);

    // The detector fires on the exact shape it claims to detect.
    const detector = /\btype\s*:\s*["'](decision|injunction|notification|inspection)["']/;
    expect(detector.test('{ title: "x", type: "decision" }')).toBe(true);
    expect(detector.test('{ classification: "decision" }')).toBe(false);

    // The governed assembly path exists and is what the allowlist is protecting.
    const authority = code(AUTHORITY);
    expect(
      /export\s+function\s+describeDocument/.test(authority) &&
        /export\s+async\s+function\s+projectRelevantDocument/.test(authority),
      "The allowlist is only meaningful if the approved construction path actually exists.",
    ).toBe(true);
  });
});
