import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GovernedDataRootError,
  requireGovernedMasterRootForDatasetApproval,
  resolveGovernedDataRoots,
} from "../src/GovernedDataRootResolver";
import { FileCheckpointStore } from "../src/FileCheckpointStore";
import { FileDatasetApprovalStore } from "../src/FileDatasetApprovalStore";

const scratch: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(d);
  return d;
}
afterEach(() => {
  while (scratch.length) {
    rmSync(scratch.pop()!, { recursive: true, force: true });
  }
});

function visibleTrio(root: string) {
  const master = join(root, "Master");
  const cas = join(root, "cas");
  const quarantine = join(root, "Quarantine");
  const mimers = join(root, "mimers");
  for (const d of [master, cas, quarantine, mimers]) mkdirSync(d, { recursive: true });
  return { master, cas, quarantine, mimers };
}

describe("Governed data root contract repair", () => {
  it("A: all three governed bindings visible → PASS", () => {
    const root = tempDir("gdr-pass-");
    const { master, cas, quarantine, mimers } = visibleTrio(root);
    const resolved = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(resolved.blocker).toBeNull();
    expect(resolved.governedMasterVisible).toBe(true);
    expect(resolved.casVisible).toBe(true);
    expect(resolved.rawQuarantineVisible).toBe(true);
    expect(resolved.quarantineModel).toBe("TWO_INTENTIONAL_LAYERS");
    expect(resolved.datasetApprovalStagingRoot).toBe(
      join(master, "National_Archive", "_quarantine"),
    );
    expect(requireGovernedMasterRootForDatasetApproval({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv)).toBe(master);
  });

  it("B/C/D: missing GOVERNED_MASTER_ROOT / CAS_ROOT / QUARANTINE_ROOT → FAIL CLOSED", () => {
    const root = tempDir("gdr-miss-");
    const { master, cas, quarantine, mimers } = visibleTrio(root);
    const base = {
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    };
    for (const drop of ["GOVERNED_MASTER_ROOT", "CAS_ROOT", "QUARANTINE_ROOT"] as const) {
      const env = { ...base } as NodeJS.ProcessEnv;
      delete env[drop];
      const resolved = resolveGovernedDataRoots(env);
      expect(resolved.blocker).toMatch(/BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION/);
      expect(() => requireGovernedMasterRootForDatasetApproval(env)).toThrow(GovernedDataRootError);
    }
  });

  it("E: only MASTER_ARCHIVE_ROOT=H:\\legacy → governed Master BLOCKED (does not resolve H:)", () => {
    const mimers = join(tempDir("gdr-legacy-"), "mimers");
    mkdirSync(mimers);
    const resolved = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      MASTER_ARCHIVE_ROOT: "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive",
    } as NodeJS.ProcessEnv);
    expect(resolved.governedMasterRoot).toBeNull();
    expect(resolved.blocker).toMatch(/BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION/);
    expect(resolved.blocker).toMatch(/GOVERNED_MASTER_ROOT/);
    expect(() =>
      requireGovernedMasterRootForDatasetApproval({
        MASTER_ARCHIVE_ROOT: "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive",
        MIMERS_ROOT: mimers,
      } as NodeJS.ProcessEnv),
    ).toThrow(/GOVERNED_MASTER_ROOT|BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION/);
  });

  it("F: GOVERNED_MASTER_ROOT == legacy MASTER_ARCHIVE_ROOT → REJECT", () => {
    const root = tempDir("gdr-collapse-legacy-");
    const { master, cas, quarantine, mimers } = visibleTrio(root);
    const resolved = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: master,
      MASTER_ARCHIVE_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(resolved.blocker).toMatch(/must not collapse onto.*MASTER_ARCHIVE_ROOT|legacy/);
    expect(() =>
      requireGovernedMasterRootForDatasetApproval({
        MIMERS_ROOT: mimers,
        GOVERNED_MASTER_ROOT: master,
        MASTER_ARCHIVE_ROOT: master,
        CAS_ROOT: cas,
        QUARANTINE_ROOT: quarantine,
      } as NodeJS.ProcessEnv),
    ).toThrow(GovernedDataRootError);
  });

  it("G: GOVERNED_MASTER_ROOT == runtime mirror / RUNTIME_MIRROR_NOTE → REJECT", () => {
    const root = tempDir("gdr-mirror-");
    const { cas, quarantine, mimers } = visibleTrio(root);
    const mirror = join(root, "mirror");
    mkdirSync(mirror);
    writeFileSync(
      join(mirror, "RUNTIME_MIRROR_NOTE.json"),
      JSON.stringify({
        canonical: "H:\\legacy\\GEO_Master_Archive",
        runtime: mirror,
        policy: "Mimers Brunn v2.0.1",
        note: "Docker bind-mount target. H: is canonical truth but not visible inside Docker Desktop.",
      }),
      "utf8",
    );
    const byNote = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: mirror,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(byNote.blocker).toMatch(/REJECT_GOVERNED_MASTER_RUNTIME_MIRROR/);

    const hostPath = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: mirror,
      MASTER_ARCHIVE_HOST_PATH: mirror,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(hostPath.blocker).toMatch(/MASTER_ARCHIVE_HOST_PATH|RUNTIME_MIRROR/);
  });

  it("H: MIMERS_ROOT alone → REJECT for governed data", () => {
    const mimers = join(tempDir("gdr-mimers-only-"), "mimers");
    mkdirSync(mimers);
    const resolved = resolveGovernedDataRoots({ MIMERS_ROOT: mimers } as NodeJS.ProcessEnv);
    expect(resolved.blocker).toMatch(/BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION/);
    expect(resolved.mimersRootPurpose).toBe("runtime_config_secrets");
  });

  it("I/J: distinct roots PASS; collapsed roots REJECT", () => {
    const root = tempDir("gdr-sep-");
    const { master, cas, quarantine, mimers } = visibleTrio(root);
    expect(
      resolveGovernedDataRoots({
        MIMERS_ROOT: mimers,
        GOVERNED_MASTER_ROOT: master,
        CAS_ROOT: cas,
        QUARANTINE_ROOT: quarantine,
      } as NodeJS.ProcessEnv).runtimeDataRootSeparation,
    ).toBe("PASS");

    const collapseMasterMimers = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: mimers,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(collapseMasterMimers.blocker).toMatch(/must not equal MIMERS_ROOT/);

    const collapseMasterCas = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: master,
      CAS_ROOT: master,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(collapseMasterCas.blocker).toMatch(/must not equal CAS_ROOT/);

    const secrets = join(mimers, "secrets");
    mkdirSync(secrets);
    const underSecrets = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: secrets,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(underSecrets.blocker).toMatch(/secrets/);
  });

  it("two intentional quarantine layers: raw QUARANTINE_ROOT ≠ DatasetApproval staging", () => {
    const root = tempDir("gdr-two-layer-");
    const { master, cas, quarantine, mimers } = visibleTrio(root);
    const resolved = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      GOVERNED_MASTER_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(resolved.rawQuarantineRoot).toBe(quarantine);
    expect(resolved.datasetApprovalStagingRoot).toBe(
      join(master, "National_Archive", "_quarantine"),
    );
    expect(resolved.rawQuarantineRoot).not.toBe(resolved.datasetApprovalStagingRoot);

    const store = new FileDatasetApprovalStore(master);
    expect((store as any).approvalsDir).toBe(
      join(master, "National_Archive", "_quarantine", "approvals"),
    );
    const serializer = { serialize: (v: unknown) => Buffer.from(JSON.stringify(v)) };
    const hashEngine = {
      hash: () => ({ algorithm: "sha256" as const, digest: "a".repeat(64) }),
    };
    const checkpoints = new FileCheckpointStore(
      master,
      serializer as any,
      hashEngine as any,
      { verify: async () => true },
    );
    expect((checkpoints as any).checkpointsDir).toBe(
      join(master, "National_Archive", "_quarantine", "checkpoints"),
    );
  });
});
