import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

/**
 * 🔴 P3-LU-DOCUMENT-CLASSIFICATION-01D — CLASSIFIER_POLICY_V1 (RED).
 *
 *   01B built the governed runtime, 01C made it the only path, 32c0e9d made the document
 *   selection fail closed. This unit answers the one remaining question:
 *
 *     Which observations may deterministically and governedly produce
 *     decision / injunction / notification / inspection?
 *
 *   CLASSIFIER_POLICY_V1 (frozen):
 *     A classification MAY be admitted only when the governing input contract contains an
 *     explicit, source-bound signal SUFFICIENT FOR THAT EXACT CLASS. Free text, titles,
 *     filenames, publication-form umbrella values, substring matching, defaults and fallback
 *     classes MUST NOT authorize a class.
 *
 *   The signal-authority recon found no such signal in any current source:
 *
 *     puh_typ                EJ_VAGLEDANDE etc — precedential weight, not document class
 *     puh_publiceringsform   DOM_ELLER_BESLUT  — disjunctive: names two classes at once
 *     puh_domstolskod        MMOD              — sender identity
 *     puh_avgorandedatum     a date
 *     puh_filnamn            ..._Dom_....pdf   — filename inference, forbidden outright
 *     DocumentRecord.decisionType              — LLM extraction WITH a confidence score
 *
 *   So the expected production result is: 0 admitted classes, everything UNCLASSIFIED. That is
 *   not a failure of this unit. It proves the architecture can say "don't know" instead of
 *   fabricating a legal type.
 *
 *   ⚠️ CONTROL PROVES CAPABILITY, NEVER COVERAGE. Its fixture is synthetic and marked TEST-ONLY.
 *   It must never be read as evidence that the current corpus has admitted coverage.
 */
describe("🔴 P3-LU-DOCUMENT-CLASSIFICATION-01D — CLASSIFIER_POLICY_V1", () => {
  const POLICY = "../src/classification/ClassifierPolicyV1";
  const AUTHORITY = "../src/classification/ClassificationAuthority";

  async function load(mod: string): Promise<Record<string, unknown>> {
    try {
      return (await import(mod)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`MISSING POLICY SURFACE: ${mod} — ${(error as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ fixtures

  /** Evidence carrying exactly the observed source metadata under test. */
  function evidence(sourceMetadata: Record<string, string>, id = "ev-policy") {
    return {
      artifact_id: id,
      artifact_type: "DOCUMENT_EVIDENCE" as const,
      content_hash: {
        algorithm: "sha256" as const,
        value: createHash("sha256").update(id + JSON.stringify(sourceMetadata)).digest("hex"),
      },
      payload: {
        raw_source_ref: { artifact_id: `raw-${id}`, artifact_type: "RAW_SOURCE_ARTIFACT" },
        source_metadata: sourceMetadata,
      },
    };
  }

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

  /** Issues under the real policy classifier and returns the recorded classification. */
  async function classifyUnderPolicy(sourceMetadata: Record<string, string>): Promise<string> {
    const { policySignalClassifier } = await load(POLICY);
    const { issueClassification } = await load(AUTHORITY);

    const artifact = (await (issueClassification as Function)({
      evidence: evidence(sourceMetadata),
      classifier: (policySignalClassifier as Function)(),
      store: memoryStore(),
    })) as { payload: { classification: string } };

    return artifact.payload.classification;
  }

  // ------------------------------------------------------------------ P1

  it("P1: a disjunctive publication form cannot authorize a class", async () => {
    expect(
      await classifyUnderPolicy({ puh_publiceringsform: "DOM_ELLER_BESLUT" }),
      "This is the closest thing to a real signal in the corpus: source-bound, explicit, and " +
        "cryptographically verified. It still fails, because it names TWO classes at once. " +
        "Picking one half of a disjunction is a guess, not a resolution — insufficient " +
        "RESOLUTION, which no implementation can repair.",
    ).toBe("UNCLASSIFIED");
  });

  // ------------------------------------------------------------------ P2

  it("P2: precedential weight is not a document class", async () => {
    for (const typ of ["EJ_VAGLEDANDE", "VAGLEDANDE_MEN_EJ_PREJUDICERANDE", "FORHANDSAVGORANDE"]) {
      expect(
        await classifyUnderPolicy({ puh_typ: typ }),
        `'${typ}' states how much authority a ruling carries, not what kind of document it is. ` +
          "The two axes were conflated once already, in Gate A.",
      ).toBe("UNCLASSIFIED");
    }
  });

  // ------------------------------------------------------------------ P3

  it("P3: sender identity and dates cannot authorize a class", async () => {
    expect(
      await classifyUnderPolicy({
        puh_domstolskod: "MMOD",
        puh_avgorandedatum: "2024-03-14",
        puh_publication_id: "12345",
      }),
      "Who issued a document and when are provenance. Inferring the class from the issuer would " +
        "make every publication of one court the same kind of document by construction.",
    ).toBe("UNCLASSIFIED");
  });

  // ------------------------------------------------------------------ P4

  it("P4: a filename or title is forbidden as authority, not merely insufficient", async () => {
    expect(
      await classifyUnderPolicy({
        puh_filnamn: "MMOD_2024-03-14_Dom_M-1234-23.pdf",
        document_title: "Dom i mål om tillstånd till grundvattenuttag",
      }),
      "The harvested judgments are named ..._Dom_....pdf. Reading 'Dom' out of that is the " +
        "single inference this whole chain exists to forbid — it is not a weak signal, it is a " +
        "non-signal that happens to correlate.",
    ).toBe("UNCLASSIFIED");

    // The policy must not even consult these fields, so a match cannot arise by accident.
    const { FORBIDDEN_SIGNAL_FIELDS } = await load(POLICY);
    expect(FORBIDDEN_SIGNAL_FIELDS as readonly string[]).toContain("puh_filnamn");
  });

  // ------------------------------------------------------------------ P5

  it("P5: an LLM-derived field cannot authorize a class, whatever its confidence", async () => {
    expect(
      await classifyUnderPolicy({
        decisionType: "court_decision",
        decisionTypeConfidence: "0.97",
        decisionTypeSource: "llm-pass3",
      }),
      "A field that ships WITH a confidence score is an inference, not an observation. High " +
        "confidence makes it a better guess, never a source-bound signal. `court_decision` is " +
        "outside the closed vocabulary regardless.",
    ).toBe("UNCLASSIFIED");
  });

  // ------------------------------------------------------------------ P6

  it("P6: a missing or unknown signal is UNCLASSIFIED, not an error and not a class", async () => {
    expect(await classifyUnderPolicy({}), "Absent signal.").toBe("UNCLASSIFIED");
    expect(
      await classifyUnderPolicy({ some_future_field: "NAGOT_HELT_OKANT" }),
      "An unrecognised signal must not be treated as permission to guess, and must not throw " +
        "either: 'examined, could not be classified' is a finding worth recording.",
    ).toBe("UNCLASSIFIED");
  });

  // ------------------------------------------------------------------ P7a

  it("P7a: a different policy_version yields a different canonical identity", async () => {
    const { policySignalClassifier } = await load(POLICY);
    const { issueClassification } = await load(AUTHORITY);

    const issue = (policy_version?: string) =>
      (issueClassification as Function)({
        evidence: evidence({ puh_publiceringsform: "DOM_ELLER_BESLUT" }),
        classifier: (policySignalClassifier as Function)(),
        store: memoryStore(),
        policy_version,
      }) as Promise<{ content_hash: { value: string }; payload: { policy_version: string } }>;

    const v1 = await issue("CLASSIFIER_POLICY_V1");
    const v2 = await issue("CLASSIFIER_POLICY_V2");

    expect(
      v1.content_hash.value,
      "Identical evidence and identical classifier implementation, different governing rule. If " +
        "the identity did not change, one identity space would hold two different authority " +
        "decisions and replay could not tell which rule applied.",
    ).not.toBe(v2.content_hash.value);

    const again = await issue("CLASSIFIER_POLICY_V1");
    expect(again.content_hash.value, "Same policy must still be reproducible.").toBe(
      v1.content_hash.value,
    );
  });

  // ------------------------------------------------------------------ P7b

  it("P7b: an issuance with no explicit policy records the exact named default", async () => {
    const { policySignalClassifier } = await load(POLICY);
    const { issueClassification, DEFAULT_CLASSIFICATION_POLICY_VERSION } = await load(AUTHORITY);

    const artifact = (await (issueClassification as Function)({
      evidence: evidence({}),
      classifier: (policySignalClassifier as Function)(),
      store: memoryStore(),
    })) as { payload: { policy_version: string } };

    expect(
      artifact.payload.policy_version,
      "An artifact must never say 'some policy'. The default is materialised by name, so replay " +
        "identity stays true even though the caller stated nothing.",
    ).toBe(DEFAULT_CLASSIFICATION_POLICY_VERSION);
    expect(artifact.payload.policy_version).toBe("CLASSIFIER_POLICY_V1");
  });

  // ------------------------------------------------------------------ P7c

  it("P7c: a tampered or removed policy_version fails verification", async () => {
    const { policySignalClassifier } = await load(POLICY);
    const { issueClassification, loadClassification } = await load(AUTHORITY);
    const store = memoryStore();
    const ev = evidence({});

    const artifact = (await (issueClassification as Function)({
      evidence: ev,
      classifier: (policySignalClassifier as Function)(),
      store,
    })) as { artifact_id: string };

    const stored = store.written.get(artifact.artifact_id) as {
      payload: { policy_version?: string };
    };
    stored.payload.policy_version = "CLASSIFIER_POLICY_V2";

    await expect(
      (loadClassification as Function)({
        classificationId: artifact.artifact_id,
        store,
        expectedEvidence: ev,
      }),
      "Retroactively restating which rule authorised a past classification is exactly the " +
        "escalation the canonical hash exists to detect.",
    ).rejects.toThrow(/REJECT_CONTENT_HASH/);

    delete stored.payload.policy_version;
    await expect(
      (loadClassification as Function)({
        classificationId: artifact.artifact_id,
        store,
        expectedEvidence: ev,
      }),
    ).rejects.toThrow(/REJECT_CONTENT_HASH/);
  });

  // ------------------------------------------------------------------ P8

  it("P8: the policy declares no default or fallback admitted class", async () => {
    const policy = await load(POLICY);

    // Every real signal form above resolved to UNCLASSIFIED. This asserts the stronger claim:
    // the policy's admitted mapping is EMPTY for real sources, so no code path can fall back
    // into a class when a match is not found.
    expect(
      policy.ADMITTED_SOURCE_SIGNALS as Readonly<Record<string, unknown>>,
      "A fallback class is how 'we could not tell' silently becomes 'it is a decision'. The " +
        "recon found no current source signal precise enough to be listed here, so the correct " +
        "content of this table today is nothing at all.",
    ).toEqual({});
  });

  // ------------------------------------------------------------------ CONTROL

  it("CONTROL: the positive path is reachable — capability, NOT coverage", async () => {
    const { policySignalClassifier, TEST_ONLY_SYNTHETIC_ADMITTED_SIGNALS } = await load(POLICY);
    const { issueClassification, projectRelevantDocument } = await load(AUTHORITY);
    const store = memoryStore();

    // ⚠️ SYNTHETIC. This signal exists in no source. It does not represent the harvested court
    // material or any other real corpus, and this test is not evidence of admitted coverage.
    const signals = TEST_ONLY_SYNTHETIC_ADMITTED_SIGNALS as Readonly<Record<string, string>>;
    expect(
      Object.keys(signals).length,
      "Without a synthetic admitted signal, every proof above would be satisfied by a policy " +
        "that simply returns UNCLASSIFIED unconditionally — including one with the positive " +
        "branch missing entirely.",
    ).toBeGreaterThan(0);

    const ev = evidence(signals);
    const artifact = (await (issueClassification as Function)({
      evidence: ev,
      classifier: (policySignalClassifier as Function)({ admittedSignals: signals }),
      store,
    })) as { artifact_id: string; payload: { classification: string; policy_version: string } };

    expect(artifact.payload.classification).not.toBe("UNCLASSIFIED");

    const document = (await (projectRelevantDocument as Function)({
      classificationId: artifact.artifact_id,
      store,
    })) as { type: string; classification_ref: { artifact_id: string } };

    expect(document.classification_ref.artifact_id).toBe(artifact.artifact_id);
    expect(document.type).toBe(artifact.payload.classification);
  });
});
