import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

/**
 * 🔴 P3-LU-DOCUMENT-CLASSIFICATION-01B — CLASSIFICATION RUNTIME AUTHORITY (RED).
 *
 *   The contract foundation (740817b) made a correct runtime *buildable*. It did not make one
 *   exist. `toRelevantDocumentType()` still fails closed, but nothing in production calls it, so
 *   DOCUMENT_CLASSIFICATION_RUNTIME_GUARD-01 — "a free producer string MUST NOT become
 *   RelevantDocument.type without a governed classification" — is ESTABLISHED, NOT_PROVEN.
 *
 *   The chain this file proves:
 *
 *     DocumentEvidenceArtifact → classify() → DocumentClassificationArtifact → persist
 *       → load/verify → project RelevantDocument → classified-document rules
 *
 *   THE SEPARATION UNDER TEST is as important as the chain itself. `classify()` is a PURE
 *   function: evidence + classifier contract → result. It does not persist, does not verify, and
 *   cannot admit its own output. A separate authority boundary issues the artifact. A component
 *   that interprets AND persists AND verifies AND approves its own output has no authority
 *   boundary at all — it only has a call stack.
 *
 *   ⚠️ NO CLASSIFICATION HEURISTIC IS UNDER TEST HERE. The producer does not expose a per-
 *   publication document class (Gate A), so the runtime must NOT be made green by reintroducing
 *   a publication-form value as a document class, or by reading a class out of a file name. That
 *   would be the correct authority architecture filled with the same epistemic error. The
 *   classifier used below is an injected stub precisely so that no heuristic can hide in this
 *   proof.
 *
 *   ⚠️ THESE TESTS ARE EXPECTED TO FAIL until the runtime lands. That failure IS the proof.
 *
 *   @see ../src/artifacts/DocumentClassificationArtifact.ts
 *   @see ./P3LuDocumentClassification.red.test.ts (the contract this builds on)
 */
describe("🔴 P3-LU-DOCUMENT-CLASSIFICATION-01B — classification runtime authority", () => {
  // ------------------------------------------------------------------ intended surface

  const CLASSIFIER = "../src/classification/DocumentClassifier";
  const AUTHORITY = "../src/classification/ClassificationAuthority";

  /** Fails with the missing surface named, rather than an opaque resolver error. */
  async function load(mod: string): Promise<Record<string, unknown>> {
    try {
      return (await import(mod)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `MISSING RUNTIME SURFACE: ${mod} — ${(error as Error).message}\n` +
          "The contract exists; the runtime that enforces it does not.",
      );
    }
  }

  // ------------------------------------------------------------------ fixtures

  const EVIDENCE_ID = "ev-0001";
  const OTHER_EVIDENCE_ID = "ev-0002";

  function evidence(id: string = EVIDENCE_ID) {
    const payload = {
      raw_source_ref: { artifact_id: `raw-${id}`, artifact_type: "RAW_SOURCE_ARTIFACT" },
      source_metadata: { provider: "TEST", observed_at: "2026-08-17T00:00:00.000Z" },
    };
    return {
      artifact_id: id,
      artifact_type: "DOCUMENT_EVIDENCE" as const,
      content_hash: {
        algorithm: "sha256" as const,
        value: createHash("sha256").update(id).digest("hex"),
      },
      payload,
    };
  }

  function evidenceRef(id: string = EVIDENCE_ID) {
    return { artifact_id: id, artifact_type: "DOCUMENT_EVIDENCE" as const };
  }

  /**
   * A classifier stub. Deterministic, injected, and deliberately not derived from anything in
   * the evidence — a real classifier is a later unit, and baking one in here would let this
   * proof pass for reasons other than the authority boundary.
   */
  function classifierStub(result: string, version = "1.0.0") {
    return {
      classifier_id: "test-classifier",
      classifier_version: version,
      classify: () => ({ classification: result, classification_basis: [] as unknown[] }),
    };
  }

  /** In-memory store, so no test writes into the repo's artifact storage. */
  function memoryStore() {
    const written = new Map<string, unknown>();
    return {
      written,
      async put(artifact: { artifact_id: string }) {
        written.set(artifact.artifact_id, structuredClone(artifact));
      },
      async get(artifactId: string) {
        return written.has(artifactId) ? structuredClone(written.get(artifactId)) : null;
      },
    };
  }

  // ------------------------------------------------------------------ R1

  it("R1: an unpersisted classifier result MUST NOT produce a RelevantDocument", async () => {
    const { classifyDocument } = await load(CLASSIFIER);
    const { projectRelevantDocument } = await load(AUTHORITY);

    const result = (classifyDocument as Function)({
      evidence: evidence(),
      classifier: classifierStub("decision"),
    });

    await expect(
      (projectRelevantDocument as Function)({ result, store: memoryStore() }),
      "A classifier result is an opinion. Projecting a RelevantDocument straight from it would " +
        "make the classifier its own authority, and classification_ref would name something " +
        "that was never recorded and can never be replayed.",
    ).rejects.toThrow(/REJECT_UNPERSISTED_CLASSIFICATION/);
  });

  // ------------------------------------------------------------------ R2

  it("R2: an arbitrary producer string MUST NOT become an admitted classification", async () => {
    const { issueClassification } = await load(AUTHORITY);

    await expect(
      (issueClassification as Function)({
        evidence: evidence(),
        classifier: classifierStub("DOM_ELLER_BESLUT"),
        store: memoryStore(),
      }),
      "This is DOCUMENT_CLASSIFICATION_RUNTIME_GUARD-01 at runtime. A value outside the closed " +
        "vocabulary must fail closed here — not be coerced, and not be quietly defaulted to " +
        "'decision', which is how a producer's free string becomes a typed legal claim.",
    ).rejects.toThrow(/REJECT_UNADMITTED_CLASSIFICATION/);
  });

  // ------------------------------------------------------------------ R3

  it("R3: UNCLASSIFIED persists a valid artifact and yields NO RelevantDocument", async () => {
    const { issueClassification, projectRelevantDocument } = await load(AUTHORITY);
    const store = memoryStore();

    const artifact = (await (issueClassification as Function)({
      evidence: evidence(),
      classifier: classifierStub("UNCLASSIFIED"),
      store,
    })) as { artifact_id: string; payload: { classification: string } };

    expect(
      artifact.payload.classification,
      "'Examined and could not be classified' must be recorded. If UNCLASSIFIED were rejected " +
        "instead, the only trace would be an absent artifact — indistinguishable from never " +
        "having looked, the same defect as an empty harvest with no no-change evidence.",
    ).toBe("UNCLASSIFIED");
    expect(store.written.has(artifact.artifact_id)).toBe(true);

    await expect(
      (projectRelevantDocument as Function)({ classificationId: artifact.artifact_id, store }),
      "The domain vocabulary stays closed. An unclassified document yields no RelevantDocument " +
        "at all, rather than a RelevantDocument carrying an UNCLASSIFIED type.",
    ).rejects.toThrow(/REJECT_UNADMITTED_CLASSIFICATION/);
  });

  // ------------------------------------------------------------------ R4

  it("R4: an admitted classification produces a RelevantDocument bound to that exact artifact", async () => {
    const { issueClassification, projectRelevantDocument } = await load(AUTHORITY);
    const store = memoryStore();

    const artifact = (await (issueClassification as Function)({
      evidence: evidence(),
      classifier: classifierStub("decision"),
      store,
    })) as { artifact_id: string };

    const document = (await (projectRelevantDocument as Function)({
      classificationId: artifact.artifact_id,
      store,
    })) as { type: string; classification_ref: { artifact_id: string; artifact_type: string } };

    expect(document.type).toBe("decision");
    expect(
      document.classification_ref.artifact_id,
      "classification_ref must name the persisted artifact itself, not a logical id and not a " +
        "copy. Anything else and the binding cannot be resolved back to verifiable material.",
    ).toBe(artifact.artifact_id);
    expect(document.classification_ref.artifact_type).toBe("DOCUMENT_CLASSIFICATION");
  });

  // ------------------------------------------------------------------ R5

  it("R5: a classification whose evidence ref does not resolve is REJECTED", async () => {
    const { loadClassification } = await load(AUTHORITY);
    const store = memoryStore();

    const { issueClassification } = await load(AUTHORITY);
    const artifact = (await (issueClassification as Function)({
      evidence: evidence(),
      classifier: classifierStub("decision"),
      store,
    })) as { artifact_id: string; payload: { source_document_evidence_ref: unknown } };

    await expect(
      (loadClassification as Function)({
        classificationId: artifact.artifact_id,
        store,
        // The same classification, offered against a DIFFERENT observation.
        expectedEvidence: evidence(OTHER_EVIDENCE_ID),
      }),
      "Classification binds to one specific observation with its own content hash. Accepting it " +
        "against another artifact would let a class decided over one document authorise a claim " +
        "about a different one.",
    ).rejects.toThrow(/REJECT_EVIDENCE_BINDING/);

    await expect(
      (loadClassification as Function)({
        classificationId: artifact.artifact_id,
        store,
        expectedEvidence: evidence(),
      }),
    ).resolves.toBeTruthy();
  });

  // ------------------------------------------------------------------ R6

  it("R6: identical evidence + classifier + inputs reproduce identical canonical identity", async () => {
    const { issueClassification } = await load(AUTHORITY);

    const issue = (version: string, evidenceId: string) =>
      (issueClassification as Function)({
        evidence: evidence(evidenceId),
        classifier: classifierStub("decision", version),
        store: memoryStore(),
      }) as Promise<{ content_hash: { value: string } }>;

    const a = await issue("1.0.0", EVIDENCE_ID);
    const b = await issue("1.0.0", EVIDENCE_ID);
    expect(
      a.content_hash.value,
      "Without reproducible identity, replay cannot verify that a past classification was the " +
        "one actually made — only that some classification exists.",
    ).toBe(b.content_hash.value);

    const newerVersion = await issue("2.0.0", EVIDENCE_ID);
    expect(
      newerVersion.content_hash.value,
      "Two classifier versions agreeing about the same evidence is a finding, not an identity. " +
        "The version must participate in the hash or the disagreement becomes invisible.",
    ).not.toBe(a.content_hash.value);

    const otherEvidence = await issue("1.0.0", OTHER_EVIDENCE_ID);
    expect(otherEvidence.content_hash.value).not.toBe(a.content_hash.value);
  });

  // ------------------------------------------------------------------ R7

  it("R7: a tampered persisted classification FAILS verification", async () => {
    const { issueClassification, loadClassification } = await load(AUTHORITY);
    const store = memoryStore();

    const artifact = (await (issueClassification as Function)({
      evidence: evidence(),
      classifier: classifierStub("UNCLASSIFIED"),
      store,
    })) as { artifact_id: string };

    // Promote UNCLASSIFIED to an admitted class by editing the record — exactly the escalation
    // the canonical hash exists to make detectable.
    const stored = store.written.get(artifact.artifact_id) as {
      payload: { classification: string };
    };
    stored.payload.classification = "decision";

    await expect(
      (loadClassification as Function)({
        classificationId: artifact.artifact_id,
        store,
        expectedEvidence: evidence(),
      }),
    ).rejects.toThrow(/REJECT_CONTENT_HASH/);
  });

  // ------------------------------------------------------------------ R8

  it("R8: replay reproduces the result from captured material without re-acquiring", async () => {
    const { replayClassification } = await load(AUTHORITY);
    const { issueClassification } = await load(AUTHORITY);
    const store = memoryStore();

    const artifact = (await (issueClassification as Function)({
      evidence: evidence(),
      classifier: classifierStub("decision"),
      store,
    })) as { artifact_id: string };

    let acquisitions = 0;
    const replayed = (await (replayClassification as Function)({
      classificationId: artifact.artifact_id,
      store,
      capturedEvidence: evidence(),
      acquire: () => {
        acquisitions += 1;
        throw new Error("live acquisition attempted during replay");
      },
    })) as { classification: string; relevant_document: { type: string } | null };

    expect(
      acquisitions,
      "Replay that re-acquires proves the source is still reachable, not that the past " +
        "classification was correct. The captured evidence is the subject of replay.",
    ).toBe(0);
    expect(replayed.classification).toBe("decision");
    expect(replayed.relevant_document?.type).toBe("decision");
  });

  it("R8b: replay of an UNCLASSIFIED artifact reproduces UNCLASSIFIED, not an absence", async () => {
    const { issueClassification, replayClassification } = await load(AUTHORITY);
    const store = memoryStore();

    const artifact = (await (issueClassification as Function)({
      evidence: evidence(),
      classifier: classifierStub("UNCLASSIFIED"),
      store,
    })) as { artifact_id: string };

    const replayed = (await (replayClassification as Function)({
      classificationId: artifact.artifact_id,
      store,
      capturedEvidence: evidence(),
      acquire: () => {
        throw new Error("live acquisition attempted during replay");
      },
    })) as { classification: string; relevant_document: unknown };

    expect(replayed.classification).toBe("UNCLASSIFIED");
    expect(replayed.relevant_document).toBeNull();
  });

  // ------------------------------------------------------------------ separation of powers

  it("the classifier is PURE: it cannot persist, verify or admit its own output", async () => {
    const classifier = await load(CLASSIFIER);

    for (const forbidden of ["issueClassification", "loadClassification", "projectRelevantDocument"]) {
      expect(
        Object.keys(classifier).includes(forbidden),
        `${CLASSIFIER} exports '${forbidden}'. A component that interprets AND persists AND ` +
          "verifies AND approves its own output has no authority boundary — only a call stack.",
      ).toBe(false);
    }

    const store = memoryStore();
    (classifier.classifyDocument as Function)({
      evidence: evidence(),
      classifier: classifierStub("decision"),
    });
    expect(store.written.size, "classifyDocument() must have no side effects.").toBe(0);
  });

  // ------------------------------------------------------------------ CONTROL

  it("CONTROL: these proofs fail because the runtime is absent, not because the test is broken", async () => {
    // Anti-vacuity. If the surfaces above were silently importable as empty modules, every test
    // would fail on `is not a function` and the suite would look identical to a genuine RED.
    // This test states which of the two is actually true, so the RED cannot be misread.
    let reason = "UNKNOWN";
    try {
      const mod = (await import(AUTHORITY)) as Record<string, unknown>;
      const missing = [
        "issueClassification",
        "loadClassification",
        "projectRelevantDocument",
        "replayClassification",
      ].filter((name) => typeof mod[name] !== "function");
      reason = missing.length ? `MODULE_PRESENT_MISSING_EXPORTS: ${missing.join(", ")}` : "GREEN";
    } catch {
      reason = "MODULE_ABSENT";
    }

    expect(
      reason,
      "Expected the authority module to be fully present. While it is not, every proof above is " +
        "RED for this reason and for no other.",
    ).toBe("GREEN");
  });
});
