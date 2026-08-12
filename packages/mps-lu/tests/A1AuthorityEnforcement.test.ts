import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DiskQuarantineStorage,
  FileCASRepository,
  QuarantinePromoter,
  GovernanceAttestationError,
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
  PROMOTION_ACTION,
  PROMOTION_ATTESTATION_PREDICATE_TYPE,
  PROMOTION_ATTESTATION_SCHEMA_VERSION,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type PromotionAttestationPredicate,
} from "@miljobeslut/mimers-brunn-core";

import { MimersIntegration } from "../../mps-runtime/src/mimers";
import { LokeIngestor, InMemoryQuarantineStorage } from "../src/loke/LokeIngestor";
import {
  DocumentEvidenceMaterializer,
  QuarantinePromoter as LuQuarantinePromoter,
} from "../src/loke/QuarantinePromoter";

/**
 * ✅ A1 — REQUIRED GREEN PROOF. This is the criterion for moving P1 enforcement from
 * KNOWN_BROKEN to PROVEN.
 *
 *   Invariant under test (frozen):
 *     A1 — LU SHALL NOT persist/promote a canonical artifact to the production Mimers
 *          repository without passing the canonical governed promotion path and its
 *          required approval/attestation checks.
 *
 *   Relationship to the historical red proof — they are NOT the same test and neither
 *   replaces the other:
 *
 *     A1AuthorityBypass.red.test.ts   ESTABLISHED_RED_PROOF
 *       purpose: reproduce the PRE-FIX authority violation
 *       expected against pre-fix state: FAIL
 *
 *     A1AuthorityEnforcement.test.ts  REQUIRED_GREEN_PROOF   ← this file
 *       purpose: prove the REPAIRED authority boundary
 *
 *   `canonical_repository_resolution` is preserved as an evidence dimension in both. It
 *   only changes semantics:
 *
 *     RED PROOF:    unauthorized write → resolvable      = violation proven
 *     GREEN PROOF:  unauthorized write → NOT resolvable  = enforcement proven
 *                   authorized write   → resolvable      = governed persistence proven
 *
 *   @see docs/architecture/architecture-authority-map.jsonc  (lu-local-quarantine-promoter)
 *   @see docs/architecture/LU-MVP-IMPLEMENTATION-PLAN-2026-08-11.md  (§4.1 frozen decision)
 *   @see docs/architecture/ADR-27-LU-Architecture-Charter.md  ("Governance aldrig dupliceras")
 */
describe("A1 — repaired authority boundary (REQUIRED GREEN PROOF)", () => {
  // ---------------------------------------------------------------------------------
  // State 1 — LU cannot persist without canonical approval/attestation.
  // ---------------------------------------------------------------------------------
  describe("1. Without canonical approval/attestation", () => {
    it("LU materialization performs no canonical write and the artifact is NOT resolvable", async () => {
      const mimers = await MimersIntegration.create();
      const canonicalRepository = mimers.artifactRepository;

      const canonicalWrites: string[] = [];
      const realPut = canonicalRepository.put.bind(canonicalRepository);
      (canonicalRepository as { put: typeof realPut }).put = async (args) => {
        canonicalWrites.push(args.artifact_id);
        return realPut(args);
      };

      const dir = await mkdtemp(join(tmpdir(), "a1-green-"));
      const filePath = join(dir, "beslut.txt");
      await writeFile(filePath, "Avslag: risk för spridning till vattentäkt", "utf8");

      const quarantine = new InMemoryQuarantineStorage();
      const ingestor = new LokeIngestor(quarantine);

      // The materializer no longer accepts a repository at all — the write capability
      // is gone by construction, not merely unused.
      const materializer = new DocumentEvidenceMaterializer(quarantine);

      const raw = await ingestor.ingestFile(filePath, "Länsstyrelsen", "Policy-v1");
      const evidence = await materializer.materialize(
        raw.artifact_id,
        "prop-a1-green",
        "doc-a1-green",
        "BESLUT",
      );

      // The artifact is produced — materialization still works.
      expect(evidence.artifact_id).toBe("doc_ev_doc-a1-green");
      expect(evidence.artifact_type).toBe("DOCUMENT_EVIDENCE");

      // ENFORCEMENT PROOF (a): no canonical write occurred.
      expect(
        canonicalWrites,
        "A1 enforcement: LU must perform no write against the canonical Mimers repository.",
      ).toHaveLength(0);

      // ENFORCEMENT PROOF (b): canonical_repository_resolution — inverted semantics.
      // In the red proof this resolved and proved the violation. Here it must NOT resolve.
      let resolutionOutcome: "RESOLVED" | "NOT_RESOLVED";
      try {
        const found = await canonicalRepository.resolve({
          artifact_id: evidence.artifact_id,
          artifact_type: "DOCUMENT_EVIDENCE",
        });
        resolutionOutcome = found ? "RESOLVED" : "NOT_RESOLVED";
      } catch {
        resolutionOutcome = "NOT_RESOLVED";
      }

      expect(
        resolutionOutcome,
        "A1 enforcement: an artifact materialized by LU without canonical approval/attestation " +
          "MUST NOT be retrievable from the canonical Mimers repository. If this resolves, the " +
          "authority boundary is not enforced.",
      ).toBe("NOT_RESOLVED");
    });

    it("LU holds no repository write capability at all (constructor no longer accepts one)", () => {
      // Structural, not behavioural: the capability is absent by construction. A future
      // re-introduction of a repository parameter fails here immediately.
      expect(
        DocumentEvidenceMaterializer.length,
        "A1 enforcement: DocumentEvidenceMaterializer must take exactly one constructor " +
          "argument (quarantine). A second argument would mean a write capability was " +
          "re-introduced into the LU path.",
      ).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------
  // State 2 — the canonical governed promotion path persists, and only with a valid
  // attestation. Proven on the canonical path's OWN terms.
  //
  // HONEST SCOPE NOTE: this proves that the governed route exists and enforces
  // attestation before persistence. It does NOT claim that LU currently rides that route
  // for DocumentEvidenceArtifact — the canonical promoter is dataset-approval shaped
  // (promote(quarantineId, attestation, governanceRelease) → DatasetApprovalArtifact) and
  // an LU→governed bridge is a separate, not-yet-built work unit.
  // ---------------------------------------------------------------------------------
  describe("2. Through canonical governed promotion with valid attestation", () => {
    const testRoot = path.resolve(__dirname, ".a1-enforcement-root");
    const quarantineDir = path.join(testRoot, ".quarantine");
    const casDir = path.join(testRoot, "cas_store");

    let quarantine: DiskQuarantineStorage;
    let cas: FileCASRepository;
    let signing: SigningKeyProvider;
    let promoter: QuarantinePromoter;

    beforeAll(async () => {
      if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
      fs.mkdirSync(testRoot, { recursive: true });

      quarantine = new DiskQuarantineStorage(quarantineDir);
      cas = new FileCASRepository(casDir, {
        durabilityMode: process.platform === "win32" ? "best-effort" : "strict",
      });
      await cas.initialize();

      signing = LocalPemSigningKeyProvider.generate("ed25519:a1-enforcement-authority").provider;
      promoter = new QuarantinePromoter(quarantine, cas, signing);
    });

    afterAll(() => {
      if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
    });

    async function quarantineItem(label: string) {
      const bytes = new TextEncoder().encode(`content for ${label}`);
      return quarantine.put(`source_${label}`, `https://example.se/${label}`, `${label}.txt`, bytes);
    }

    async function validAttestation(args: {
      quarantineId: string;
      contentHash: string;
      governanceRelease: string;
    }): Promise<ArtifactAttestation> {
      const predicate: PromotionAttestationPredicate = {
        action: PROMOTION_ACTION,
        quarantine_artifact_id: args.quarantineId,
        quarantine_content_hash: args.contentHash,
        approver_actor_id: "a1-approver",
        approver_role: "ADMIN",
        governance_release: args.governanceRelease,
        attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
        signer_key_id: signing.keyId,
      };
      return createArtifactAttestation({
        subjectDigest: `sha256:${args.contentHash}`,
        predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
        predicate: predicate as unknown as Record<string, unknown>,
        signing,
      });
    }

    it("without a valid attestation the governed path rejects and persists nothing", async () => {
      const q = await quarantineItem("a1-unauthorized");

      const forged: ArtifactAttestation = {
        subjectDigest: `sha256:${q.hash}`,
        predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
        predicate: {
          action: PROMOTION_ACTION,
          quarantine_artifact_id: q.quarantine_id,
          quarantine_content_hash: q.hash,
          approver_actor_id: "attacker",
          approver_role: "ADMIN",
          governance_release: "v1",
          attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
          signer_key_id: signing.keyId,
        },
        hashAlgorithm: "sha256",
        signatureAlgorithm: "Ed25519",
        signer: signing.keyId,
        signature: "ed25519:not-a-real-signature==",
      };

      await expect(
        promoter.promote(q.quarantine_id, forged, "v1"),
        "A1 enforcement: the governed path must reject an unverifiable attestation.",
      ).rejects.toThrow(GovernanceAttestationError);

      const meta = await quarantine.getMetadata(q.quarantine_id);
      expect(
        meta!.status,
        "A1 enforcement: a rejected promotion must leave the item quarantined — no partial mutation.",
      ).toBe("quarantined");
    });

    it("with a valid attestation the governed path persists and the artifact IS resolvable", async () => {
      const q = await quarantineItem("a1-authorized");
      const attestation = await validAttestation({
        quarantineId: q.quarantine_id,
        contentHash: q.hash,
        governanceRelease: "v1",
      });

      const result = await promoter.promote(q.quarantine_id, attestation, "v1");

      expect(result, "A1 enforcement: governed promotion must produce a result.").toBeDefined();

      // canonical_repository_resolution — positive direction: authorized write IS retrievable.
      const bytes = await cas.getBytes(result.content_hash);
      expect(
        bytes,
        "A1 enforcement: after a governed promotion with a valid attestation, the content MUST " +
          "be retrievable from the canonical CAS. This is the 'authorized write → resolvable' " +
          "half of the proof.",
      ).toBeDefined();

      const meta = await quarantine.getMetadata(q.quarantine_id);
      expect(meta!.status).toBe("promoted");
    });
  });

  // ---------------------------------------------------------------------------------
  // State 3 — no alternative LU write path remains.
  // ---------------------------------------------------------------------------------
  describe("3. No alternative LU write path", () => {
    it("LU document-evidence materialization exposes no alternative repository write path", () => {
      const materializerSourcePath = path.resolve(
        __dirname,
        "..",
        "src",
        "loke",
        "QuarantinePromoter.ts",
      );
      const source = fs.readFileSync(materializerSourcePath, "utf8");
      const executableSource = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      const forbiddenCapabilities: string[] = [];
      const forbiddenPatterns: Array<[RegExp, string]> = [
        [/\bArtifactRepositoryPort\b/, "ArtifactRepositoryPort import/use"],
        [/\bIArtifactRepository\b/, "IArtifactRepository import/use"],
        [/\bCASRepository\b/, "CASRepository import/use"],
        [/\bMimersIntegration\b/, "MimersIntegration import/use"],
        [
          /\b(this\.)?(cas|casRepo|repo|repository|artifactRepository)\s*\.\s*put(?:Bytes|Canonical)?\s*\(/,
          "repository-shaped put()",
        ],
      ];

      for (const [pattern, label] of forbiddenPatterns) {
        if (pattern.test(executableSource)) forbiddenCapabilities.push(label);
      }

      expect(
        forbiddenCapabilities,
        "A1 enforcement: LU's document-evidence materializer must expose no alternate " +
          "canonical write capability. Execution/spatial CAS writes are separate authority " +
          "surfaces and are intentionally not classified by this A1 proof.",
      ).toEqual([]);

      expect(
        (DocumentEvidenceMaterializer.prototype as { promote?: unknown }).promote,
        "A1 enforcement: the materializer must not retain the old promote() bypass API.",
      ).toBeUndefined();
      expect(
        (LuQuarantinePromoter.prototype as { promote?: unknown }).promote,
        "A1 enforcement: the deprecated LU alias must not retain or reintroduce promote().",
      ).toBeUndefined();
    });
  });
});
