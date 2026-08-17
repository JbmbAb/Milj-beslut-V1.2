import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 🔴 P3-LU-DOCUMENT-CLASSIFICATION-01 — DOCUMENT_EVIDENCE_CLASSIFICATION_SEPARATION_V1 (RED).
 *
 *   Frozen contract:
 *     DocumentEvidenceArtifact        MUST be creatable without a document classification
 *     DocumentClassificationArtifact  MUST reference the exact evidence it classifies
 *     RelevantDocument                MAY exist only from an admitted classification artifact
 *
 *   Direction — a DAG in the epistemic order, never the reverse:
 *
 *     RawSourceArtifact → DocumentEvidenceArtifact → DocumentClassificationArtifact
 *                       → RelevantDocument → classified-document rules
 *
 *   The defect: `DocumentEvidencePayload.relevant_document` is REQUIRED, so an evidence artifact
 *   cannot exist without already carrying the class it should be input to. Observation is
 *   structurally forced to know its own future interpretation. `documentType` is therefore
 *   demanded at materialization — an acquisition-time property for something Gate A proved the
 *   producer does not supply per publication.
 *
 *   `classification_ref` is deliberately NOT added to the evidence artifact: artifacts are
 *   immutable, and evidence is created before classification, so a forward reference would
 *   require rewriting the observation after the fact. The reference points backwards instead.
 *
 *   UNCLASSIFIED lives on the classification artifact, never in RelevantDocument.type — the
 *   closed domain vocabulary stays unchanged and an unclassified document simply yields no
 *   RelevantDocument at all.
 *
 *   ⚠️ THESE TESTS ARE EXPECTED TO FAIL until the contract lands. That failure IS the proof.
 *   Do not weaken them to make the suite green.
 */
describe("🔴 P3-LU-DOCUMENT-CLASSIFICATION-01 — evidence/classification separation", () => {
  const LU_SRC = resolve(__dirname, "..", "src");
  const EVIDENCE = join(LU_SRC, "artifacts", "DocumentEvidenceArtifact.ts");
  const RELEVANT = join(LU_SRC, "domain", "RelevantDocument.ts");
  const CLASSIFICATION = join(LU_SRC, "artifacts", "DocumentClassificationArtifact.ts");

  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  /** Comments describe the contract; only declarations may satisfy it. */
  const code = (p: string) =>
    read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // ------------------------------------------------------------------ RED-1

  it("RED-1: evidence can be created WITHOUT a classification", () => {
    const src = code(EVIDENCE);

    expect(
      /readonly\s+relevant_document\s*\?\s*:/.test(src),
      "DocumentEvidencePayload.relevant_document is REQUIRED, so no evidence artifact can exist " +
        "before its document has been classified. That forces the class to be supplied at " +
        "materialization — the coupling this unit removes. It becomes optional during migration " +
        "and is removed in the next canonical contract version.",
    ).toBe(true);
  });

  it("RED-1b: the legacy field is marked non-authoritative", () => {
    const doc = read(EVIDENCE);

    expect(
      /LEGACY/i.test(doc) && /relevant_document/.test(doc),
      "An optional field with no warning invites new producers to keep populating it. It must " +
        "say that it does not authorize classification or classified LU rules.",
    ).toBe(true);
  });

  // ------------------------------------------------------------------ RED-2

  it("RED-2: RelevantDocument cannot exist without a classification binding", () => {
    const src = code(RELEVANT);

    expect(
      /readonly\s+classification_ref\s*:/.test(src),
      "RelevantDocument carries a `type` with nothing recording where that type came from. " +
        "Downstream cannot distinguish an admitted classification from a value someone set.",
    ).toBe(true);
  });

  it("RED-2b: the classification artifact exists and binds its evidence", () => {
    expect(
      existsSync(CLASSIFICATION),
      `${CLASSIFICATION} does not exist. Classification has no artifact, so it cannot be ` +
        "persisted, referenced or replayed.",
    ).toBe(true);

    const src = code(CLASSIFICATION);
    expect(
      /readonly\s+source_document_evidence_ref\s*:/.test(src),
      "The reference points BACKWARDS — interpretation names the observation it interprets. " +
        "Evidence must never gain a forward reference to a later classification.",
    ).toBe(true);
  });

  it("RED-2c: evidence must NOT gain a forward reference", () => {
    const src = code(EVIDENCE);

    expect(
      /classification_ref/.test(src),
      "Artifacts are immutable and evidence is created first, so a forward reference could only " +
        "be satisfied by rewriting the observation after its interpretation exists.",
    ).toBe(false);
  });

  // ------------------------------------------------------------------ RED-3

  it("RED-3: UNCLASSIFIED is representable and yields no RelevantDocument", () => {
    const src = code(CLASSIFICATION);

    expect(
      /["']UNCLASSIFIED["']/.test(src),
      "Without an UNCLASSIFIED value there is no way to record that a document was examined and " +
        "could not be classified — absence of a classification artifact would be the only " +
        "signal, and that is indistinguishable from never having looked.",
    ).toBe(true);

    expect(
      /UNCLASSIFIED/.test(code(RELEVANT)),
      "UNCLASSIFIED must NOT enter RelevantDocument.type. The closed vocabulary stays " +
        "decision | injunction | notification | inspection; an unclassified document yields no " +
        "RelevantDocument at all.",
    ).toBe(false);
  });

  // ------------------------------------------------------------------ RED-4

  it("RED-4: no heuristic may authorize a class without a persisted artifact", () => {
    const src = code(CLASSIFICATION);

    for (const heuristic of ["file_name", "filename", "title.toLowerCase", "includes('Dom')"]) {
      expect(
        src.includes(heuristic),
        `Classification must derive from governed material, never from '${heuristic}'. The ` +
          "harvested judgments are named MMOD_..._Dom_....pdf; reading 'Dom' out of that is the " +
          "filename guess this unit exists to forbid.",
      ).toBe(false);
    }

    expect(
      /readonly\s+classifier_id\s*:/.test(src) && /readonly\s+classifier_version\s*:/.test(src),
      "A classification with no attributable classifier and version cannot be replayed or " +
        "compared across versions.",
    ).toBe(true);
  });

  // ------------------------------------------------------------------ RED-5

  it("RED-5: classification identity is canonical and replayable", () => {
    const src = code(CLASSIFICATION);

    expect(
      /content_hash|canonical/i.test(src),
      "Identical evidence and classifier version must reproduce an identical canonical result, " +
        "or replay cannot verify that a past classification was the one actually made.",
    ).toBe(true);
  });

  // -------------------------------------------------- the materializer seam

  it("materialize() no longer demands a class at evidence time", () => {
    const src = code(join(LU_SRC, "ingestion", "QuarantinePromoter.ts"));

    expect(
      /materialize\(\s*[\s\S]{0,200}?documentType\s*:/.test(src),
      "materialize(rawArtifactId, propertyRefId, documentRefId, documentType) requires the class " +
        "before the evidence exists. Gate A proved PUH does not supply a document class per " +
        "publication, so this parameter cannot be satisfied from governed material at all.",
    ).toBe(false);
  });
});
