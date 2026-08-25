import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MimersIntegration,
  resetMimersCasCacheForTests,
} from "../../mimers/MimersIntegration.js";
import { DefaultReplayEngine } from "../../replay/DefaultReplayEngine.js";
import { CasBackedArtifactRepository } from "../../repository/CasBackedArtifactRepository.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_REPLAY_MODULE_PATTERNS = [
  /postgis/i,
  /spatial-provider/i,
  /^(pg|prisma|axios|https?|node:https|node:http)$/i,
  /current.*(release|binding|geometry).*resolver/i,
];

function importedModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]!);
  return specifiers;
}

function assertReplayImportsAreIsolated(source: string): void {
  for (const specifier of importedModuleSpecifiers(source)) {
    expect(FORBIDDEN_REPLAY_MODULE_PATTERNS.some((pattern) => pattern.test(specifier))).toBe(false);
  }
}

describe("Integrity — CasReplay", () => {
  let root: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    root = mkdtempSync(path.join(tmpdir(), "cas-replay-"));
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("replay reads artifacts only via Mimers CAS repository (no PostGIS)", async () => {
    const env = {
      MIMERS_ROOT: root,
      MIMERS_DURABILITY_MODE: "none",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv;

    const mimers = await MimersIntegration.create({ env, forceMimers: true });
    expect(mimers.isMimersBacked).toBe(true);

    const seed = "seed:cas-replay";
    // Compose harness kernel against Mimers-backed repo
    const harness = createPlatformHarness({
      snapshot_id: "snap-cas-r",
      release_id: "rel-cas-r",
      seed,
      capabilities: [
        {
          artifact_id: "cap-cas",
          capability_key: "cas.replay",
          implementation_id: "impl-cas",
          handler: async () => [{ artifact_id: "cas-out-1" }],
        },
      ],
    });

    // Replace memory repo with Mimers path by re-running puts on Mimers repo
    const mimersRepo = mimers.artifactRepository as CasBackedArtifactRepository;
    const manifest = buildManifest({
      manifest_id: "m-cas-replay",
      capability_id: "cap-cas",
      seed,
    });

    // Execute on memory harness then persist spine to Mimers for CAS-only replay proof
    const { result } = await runCapabilityOnce(harness, manifest);
    expect(result.admission.decision).toBe("admitted");

    for (const id of [
      manifest.manifest_id,
      result.attempt!.attempt_id,
      result.outcome!.outcome_id,
      result.capability_executions[0]!.artifact_id,
    ]) {
      const envelope = await harness.repo.resolveEnvelope({
        artifact_id: id,
        artifact_type: "any",
      });
      await mimersRepo.put({
        artifact_id: envelope.artifact_id,
        content_hash: envelope.content_hash,
        body: envelope.body,
      });
    }

    const replayEngine = new DefaultReplayEngine(mimersRepo);
    const replay = await replayEngine.replay(
      {
        artifact_id: manifest.manifest_id,
        artifact_type: "execution_manifest",
      },
      result.state,
    );

    expect(replay.artifact_type).toBe("REPLAY");
    expect(replay.equivalence_proof.value).toMatch(/^[a-f0-9]{64}$/);

    const fromCas = await mimers.resolver.resolveEnvelope({
      artifact_id: replay.artifact_id,
      artifact_type: "REPLAY",
    });
    expect(fromCas.content_hash.value).toBe(replay.content_hash.value);

    // Dependency guard: prose is irrelevant; executable imports must not reach live sources.
    const replaySrc = readFileSync(
      path.join(__dirname, "../../replay/DefaultReplayEngine.ts"),
      "utf8",
    );
    const mimersSrc = readFileSync(
      path.join(__dirname, "../../mimers/MimersIntegration.ts"),
      "utf8",
    );
    assertReplayImportsAreIsolated(replaySrc);
    assertReplayImportsAreIsolated(mimersSrc);
    expect(replaySrc).toContain("repository.resolve");
  });

  it("rejects a forbidden live-source import while allowing harmless prose", () => {
    expect(() => assertReplayImportsAreIsolated('// PostGIS is forbidden\nexport const x = 1;')).not.toThrow();
    expect(() => assertReplayImportsAreIsolated("import { Client } from 'pg';")).toThrow();
  });
});
