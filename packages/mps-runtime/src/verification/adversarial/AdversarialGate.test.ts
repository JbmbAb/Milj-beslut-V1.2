/**
 * Epoch II Verification Fas 7 — Unified Adversarial Gate (blocking for release)
 *
 * Tampered Artifact · Wrong Release · Fake Capability ·
 * Duplicate Ticket Flood · Replay Attack
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../../kernel/ExecutionKernel.js";
import { createRegistryRuntime } from "../../registry/RegistryRuntime.js";
import { DefaultReplayEngine } from "../../replay/DefaultReplayEngine.js";
import {
  MimersIntegration,
  resetMimersCasCacheForTests,
  getCachedMimersBackendForTests,
} from "../../mimers/MimersIntegration.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";
import { createExecutionInfrastructure } from "../../../../mps-control-plane/src/execution-infrastructure/ExecutionInfrastructure.js";
import { InMemoryExecutionTicketQueue } from "../../../../mps-control-plane/src/ExecutionTicketQueue.js";

describe("Adversarial Gate (blocking Fas 7)", () => {
  describe("Tampered Artifact", () => {
    let root: string;

    beforeEach(() => {
      resetMimersCasCacheForTests();
      root = mkdtempSync(path.join(tmpdir(), "adv-tamper-"));
    });

    afterEach(() => {
      resetMimersCasCacheForTests();
      rmSync(root, { recursive: true, force: true });
    });

    it("WORM rejects put of same artifact_id with different bytes", async () => {
      const backend = new MemoryByteStorageBackend();
      const repo = new CasBackedArtifactRepository(backend);
      const body1 = { v: 1 };
      const h1 = sha256ContentHash(body1);
      await repo.put({ artifact_id: "art-1", content_hash: h1, body: body1 });

      await expect(
        repo.put({
          artifact_id: "art-1",
          content_hash: sha256ContentHash({ v: 2 }),
          body: { v: 2 },
        }),
      ).rejects.toThrow(/WORM/);
    });

    it("on-disk byte flip → CAS hash verification fails", async () => {
      const env = {
        MIMERS_ROOT: root,
        MIMERS_DURABILITY_MODE: "none",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv;
      const mimers = await MimersIntegration.create({ env, forceMimers: true });
      const repo = mimers.artifactRepository as CasBackedArtifactRepository;
      const body = { safe: true };
      const content_hash = sha256ContentHash(body);
      await repo.put({ artifact_id: "tamper-me", content_hash, body });

      const digest = await getCachedMimersBackendForTests()!.resolveContentAddress(
        "tamper-me",
      );
      const cas = new FileCASRepository(path.join(root, "cas"), {
        durabilityMode: "none",
      });
      await cas.initialize();
      const filePath = cas.getFilePath(digest!);
      const bytes = await fs.readFile(filePath);
      bytes[0] = bytes[0]! ^ 0xff;
      await fs.writeFile(filePath, bytes);

      const verified = await cas.verifyStoredObject(digest!);
      expect(verified.ok).toBe(false);
    });
  });

  describe("Tampered Registry", () => {
    it("frozen registry rejects mutation; evil capability never resolves", () => {
      const runtime = createRegistryRuntime({
        snapshot_id: "snap-adv",
        release_id: "rel-adv",
        capabilities: [
          {
            artifact_id: "cap-legit",
            artifact_type: "CAPABILITY_DEFINITION",
            capability_key: "adv.legit",
            capability_version: "1.0.0",
            implementation_ref: { artifact_id: "impl-legit" },
            input_types: ["IN"],
            output_types: ["OUT"],
          },
        ],
        workflows: [],
      });

      const snap = runtime.getReleaseSnapshot();
      expect(() => {
        (snap.capabilities as unknown as unknown[]).push({
          artifact_id: "cap-evil",
          capability_key: "adv.evil",
        });
      }).toThrow();

      expect(runtime.resolveCapabilityByKey("adv.evil")).toBeNull();
      expect(runtime.resolveCapabilityByRef("cap-evil")).toBeNull();
    });
  });

  describe("Wrong Release", () => {
    it("Release A execution cannot admit Capability from Release B", async () => {
      const seed = "seed:wrong-rel";
      const releaseA = createPlatformHarness({
        snapshot_id: "snap-A",
        release_id: "release-A",
        seed,
        capabilities: [
          {
            artifact_id: "cap-a",
            capability_key: "rel.a",
            implementation_id: "impl-a",
            handler: async () => [{ artifact_id: "oa" }],
          },
        ],
      });
      createPlatformHarness({
        snapshot_id: "snap-B",
        release_id: "release-B",
        seed,
        capabilities: [
          {
            artifact_id: "cap-b",
            capability_key: "rel.b",
            implementation_id: "impl-b",
            handler: async () => [{ artifact_id: "ob" }],
          },
        ],
      });

      expect(releaseA.registry.resolveCapabilityByRef("cap-b")).toBeNull();

      const denied = await runCapabilityOnce(
        releaseA,
        buildManifest({
          manifest_id: "m-wrong",
          capability_id: "cap-b",
          seed,
        }),
      );
      expect(denied.result.admission.decision).toBe("denied");
      expect(denied.result.admission.reason_codes).toContain(
        "CAPABILITY_NOT_GRANTED",
      );
      expect(denied.result.attempt).toBeNull();
      expect(denied.result.capability_executions).toHaveLength(0);
    });
  });

  describe("Fake Capability", () => {
    it("unknown / forged capability is rejected by registry and admission", async () => {
      const seed = "seed:fake-cap";
      const harness = createPlatformHarness({
        snapshot_id: "snap-fake",
        release_id: "rel-fake",
        seed,
        capabilities: [
          {
            artifact_id: "cap-real",
            capability_key: "fake.real",
            implementation_id: "impl-real",
            handler: async () => [{ artifact_id: "ok" }],
          },
        ],
      });

      expect(harness.registry.resolveCapabilityByRef("cap-forged")).toBeNull();

      const forged = await runCapabilityOnce(
        harness,
        buildManifest({
          manifest_id: "m-forged",
          capability_id: "cap-forged",
          seed,
        }),
      );
      expect(forged.result.admission.decision).toBe("denied");
      expect(forged.result.capability_executions).toHaveLength(0);

      await expect(
        harness.capabilityRuntime.execute({
          capability_ref: {
            artifact_id: "cap-forged",
            artifact_type: "CAPABILITY_DEFINITION",
          },
          input_refs: [],
          state: forged.result.state,
        }),
      ).rejects.toThrow(/Capability not in registry/);
    });
  });

  describe("Duplicate Ticket Flood", () => {
    it("100 identical enqueue keys → one ticket / one execution identity", async () => {
      const queue = new InMemoryExecutionTicketQueue();
      const ei = createExecutionInfrastructure(queue, {
        now: () => new Date("2026-08-06T00:00:00.000Z"),
      });

      const key = "flood-idempotency-key";
      const manifest_ref = {
        artifact_id: "m-flood",
        artifact_type: "execution_manifest",
      };

      const tickets = [];
      for (let i = 0; i < 100; i++) {
        tickets.push(
          await ei.enqueueIdempotent(key, `ticket-flood-${i}`, manifest_ref),
        );
      }

      const ids = new Set(tickets.map((t) => t.ticket_id));
      expect(ids.size).toBe(1);
      expect(tickets[0]!.manifest_ref.artifact_id).toBe("m-flood");

      const reserved = await ei.reserve("worker-1");
      expect(reserved?.ticket_id).toBe(tickets[0]!.ticket_id);
      expect(await ei.reserve("worker-2")).toBeNull();
    });
  });

  describe("Replay Attack", () => {
    it("replay does not mint new attempt/outcome identities for the original run", async () => {
      const seed = "seed:replay-attack";
      const harness = createPlatformHarness({
        snapshot_id: "snap-ra",
        release_id: "rel-ra",
        seed,
        capabilities: [
          {
            artifact_id: "cap-ra",
            capability_key: "ra.cap",
            implementation_id: "impl-ra",
            handler: async () => [{ artifact_id: "ra-out" }],
          },
        ],
      });

      const { result } = await runCapabilityOnce(
        harness,
        buildManifest({
          manifest_id: "m-ra",
          capability_id: "cap-ra",
          seed,
        }),
      );
      expect(result.admission.decision).toBe("admitted");

      const attemptId = result.attempt!.attempt_id;
      const outcomeId = result.outcome!.outcome_id;
      const attemptHash = result.attempt!.content_hash.value;
      const outcomeHash = result.outcome!.content_hash.value;

      const engine = new DefaultReplayEngine(harness.repo);
      const r1 = await engine.replay(
        { artifact_id: "m-ra", artifact_type: "execution_manifest" },
        result.state,
      );
      const r2 = await engine.replay(
        { artifact_id: "m-ra", artifact_type: "execution_manifest" },
        result.state,
      );

      // Replay spine points at original identities
      expect(r1.replayed_outcome_ref.artifact_id).toBe(outcomeId);
      expect(r2.replayed_outcome_ref.artifact_id).toBe(outcomeId);
      expect(r1.equivalence_proof.value).toBe(r2.equivalence_proof.value);

      // Original attempt/outcome identities unchanged in CAS
      const attempt = await harness.repo.resolveEnvelope({
        artifact_id: attemptId,
        artifact_type: "execution_attempt",
      });
      const outcome = await harness.repo.resolveEnvelope({
        artifact_id: outcomeId,
        artifact_type: "execution_outcome",
      });
      expect(attempt.content_hash.value).toBe(attemptHash);
      expect(outcome.content_hash.value).toBe(outcomeHash);

      // Re-executing the same manifest yields the same attempt/outcome ids (determinism)
      const again = await runCapabilityOnce(
        createPlatformHarness({
          snapshot_id: "snap-ra",
          release_id: "rel-ra",
          seed,
          capabilities: [
            {
              artifact_id: "cap-ra",
              capability_key: "ra.cap",
              implementation_id: "impl-ra",
              handler: async () => [{ artifact_id: "ra-out" }],
            },
          ],
        }),
        buildManifest({
          manifest_id: "m-ra",
          capability_id: "cap-ra",
          seed,
        }),
      );
      expect(again.result.attempt?.attempt_id).toBe(attemptId);
      expect(again.result.outcome?.outcome_id).toBe(outcomeId);
    });
  });
});
