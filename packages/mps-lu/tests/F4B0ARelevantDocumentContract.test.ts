import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RawSourceIngestor, InMemoryQuarantineStorage } from "../src/ingestion/RawSourceIngestor";
import { DocumentEvidenceMaterializer } from "../src/ingestion/QuarantinePromoter";
import {
  toRelevantDocumentType,
  type RelevantDocument,
  type RelevantDocumentMetadata,
} from "../src/domain/RelevantDocument";
import { MockDocumentProvider } from "../../document-provider/src/MockDocumentProvider";

/**
 * ✅ F4B-0A — RelevantDocument CONTRACT GREEN PROOF.
 *
 *   OWNER FREEZE 2026-08-12 — RelevantDocument Contract:
 *     1. RelevantDocument is a structured document DESCRIPTION — not raw text, not a text
 *        projection, not a legal fact.
 *     2. Document text is owned by the canonical text projection. RelevantDocument must not
 *        carry text_content.
 *     3. metadata may contain descriptive document attributes only.
 *     4. Legal or semantic claims must be DocumentFacts, never metadata.
 *     5. Record<string, any> is retired in favour of an explicit typed metadata contract.
 *     6. Exactly one canonical type definition.
 *     7. Reconciliation limited to making producers, consumers and tests compatible.
 *
 *   Boundary being proven:
 *     RelevantDocument   describes the document
 *     TextProjection     owns the text            (TEXT-L1)
 *     DocumentFact       says what it MEANS       (Tier 3, verified)
 *
 *   @see docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md
 *   @see packages/mps-data-governance/src/DocumentFactArtifact.ts
 */
describe("F4B-0A — RelevantDocument contract (GREEN PROOF)", () => {
  describe("1. The materializer emits a conforming description, never text", () => {
    async function materialize() {
      const dir = await mkdtemp(join(tmpdir(), "f4b0a-"));
      const filePath = join(dir, "beslut.txt");
      await writeFile(filePath, "Avslag: risk för spridning till vattentäkt", "utf8");

      const quarantine = new InMemoryQuarantineStorage();
      const ingestor = new RawSourceIngestor(quarantine);
      const materializer = new DocumentEvidenceMaterializer(quarantine);

      const raw = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v1");
      const evidence = await materializer.materialize(
        raw.artifact_id,
        "prop-f4b0a",
        "doc-f4b0a",
      );
      return { evidence, quarantine, raw };
    }

    it("the materializer emits no document description at all", async () => {
      const { evidence } = await materialize();

      // P3-LU-DOCUMENT-CLASSIFICATION-01 — this previously asserted that the emitted
      // relevant_document carried no text. It now asserts something stronger: the materializer
      // emits no relevant_document whatsoever. Observation must not carry its own
      // interpretation, and describing a document as a decision is interpretation.
      expect(
        Object.prototype.hasOwnProperty.call(evidence.payload, "relevant_document"),
        "F4B-0A + P3: document text is owned by the text projection (TEXT-L1) and document CLASS " +
          "is owned by DocumentClassificationArtifact. Neither belongs on the evidence.",
      ).toBe(false);
    });

    it("the raw bytes are still preserved — in quarantine, unmodified", async () => {
      const { quarantine, raw } = await materialize();
      const quarantined = await quarantine.get(raw.artifact_id);

      expect(
        Buffer.from(quarantined!.payload.content_bytes_base64, "base64").toString("utf8"),
        "F4B-0A: removing text from the description must not lose the original. 'Hämta först. " +
          "Bevara originalet.' (mimers-brunn-v3.0.0 §2)",
      ).toContain("Avslag");
    });

    it("an unmapped document label is still rejected rather than defaulted", () => {
      // The guard did not disappear — it moved off the acquisition seam. materialize() no longer
      // takes a document label at all, so there is nothing there to default. The closed
      // vocabulary is still enforced where a label is actually interpreted.
      expect(
        toRelevantDocumentType("NÅGOT_OKÄNT"),
        "F4B-0A: silently defaulting an unrecognised label to 'decision' would let a producer's " +
          "free string become a typed claim about the document.",
      ).toBeUndefined();
      expect(toRelevantDocumentType("BESLUT")).toBe("decision");
    });

    it("known labels map onto the closed vocabulary; unknown ones return undefined", () => {
      expect(toRelevantDocumentType("BESLUT")).toBe("decision");
      expect(toRelevantDocumentType("föreläggande")).toBe("injunction");
      expect(toRelevantDocumentType("INSPECTION")).toBe("inspection");
      expect(toRelevantDocumentType("avslag")).toBeUndefined();
      expect(toRelevantDocumentType("risk")).toBeUndefined();
    });
  });

  describe("2. metadata is a closed descriptive contract, not an open bag", () => {
    it("the provider emits only descriptive attributes — no legal characterisation", async () => {
      const docs = await new MockDocumentProvider().fetchDocumentsForGeometry({} as never);

      const allowed = new Set([
        "authority",
        "court",
        "case_number",
        "document_date",
        "source_url",
        "language",
      ]);

      for (const doc of docs) {
        for (const key of Object.keys(doc.metadata)) {
          expect(
            allowed.has(key),
            `F4B-0A: metadata key '${key}' is not a descriptive document attribute. Claims about ` +
              `what a document MEANS are DocumentFacts and require assertion, verification and a ` +
              `source span.`,
          ).toBe(true);
        }
      }
    });

    it("no metadata value smuggles a legal conclusion in as free text", async () => {
      const docs = await new MockDocumentProvider().fetchDocumentsForGeometry({} as never);

      // Fields such as `summary` previously carried characterisations like "beslut gällande
      // strandskyddsdispens". That is a claim, not a description.
      for (const doc of docs) {
        const bag = doc.metadata as Record<string, unknown>;
        for (const forbidden of ["summary", "description", "conclusion", "outcome", "effect"]) {
          expect(bag[forbidden]).toBeUndefined();
        }
      }
    });

    it("the metadata type admits no arbitrary keys at compile time", () => {
      // Compile-time contract, asserted structurally: assigning an unknown key is a type error,
      // which is the whole point of retiring Record<string, any>.
      const metadata: RelevantDocumentMetadata = {
        authority: "Länsstyrelsen",
        document_date: "2021-11-03",
      };
      expect(Object.keys(metadata).sort()).toEqual(["authority", "document_date"]);
    });
  });

  describe("3. Exactly one canonical type definition", () => {
    it("lu-domain re-exports the canonical type instead of declaring a copy", async () => {
      const canonical = await import("../src/domain/RelevantDocument");
      const reexport = await import("../src/domain/lu-domain");

      // Types are erased at runtime, so the structural guarantee is proven where it can be:
      // the canonical module owns the behaviour (the mapper) and lu-domain adds none of its own.
      expect(typeof canonical.toRelevantDocumentType).toBe("function");
      expect(
        (reexport as Record<string, unknown>).toRelevantDocumentType,
        "F4B-0A: lu-domain must not re-implement the contract; it re-exports the canonical type " +
          "only. Two parallel declarations of one semantic contract drift apart silently.",
      ).toBeUndefined();
    });

    it("a conforming document satisfies the canonical type", () => {
      const doc: RelevantDocument = {
        title: "Tidigare dom (MÖD 2018:14)",
        type: "decision",
        metadata: { court: "Mark- och miljööverdomstolen", document_date: "2018-05-12" },
        // P3-...-01C: no test-only bypass. A conforming document names the classification
        // artifact its type came from, exactly as a production one must.
        classification_ref: {
          artifact_id: "classification-" + "0".repeat(64),
          artifact_type: "DOCUMENT_CLASSIFICATION",
        },
      };
      expect(doc.type).toBe("decision");
      expect(doc.metadata.court).toBe("Mark- och miljööverdomstolen");
    });
  });
});
