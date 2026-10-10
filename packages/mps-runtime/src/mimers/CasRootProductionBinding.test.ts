import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import {
  MimersIntegration,
  resetMimersCasCacheForTests,
} from "./MimersIntegration.js";
import { CasRootRequiredError, resolveDurableCasRoot } from "./DurableCasRoot.js";
import { resolveMimersBackendRootFromCasRoot } from "./DurableCasRoot.js";

describe("CAS_ROOT production binding", () => {
  let parent: string;
  let casRoot: string;
  let mimersConfig: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    parent = mkdtempSync(path.join(tmpdir(), "cas-bind-"));
    casRoot = path.join(parent, "cas");
    mimersConfig = path.join(parent, "mimers-config");
    mkdirSync(casRoot);
    mkdirSync(mimersConfig);
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(parent, { recursive: true, force: true });
  });

  it("A: CAS_ROOT configured → MimersIntegration initializes exactly that CAS root", async () => {
    const integration = await MimersIntegration.create({
      env: {
        NODE_ENV: "development",
        CAS_ROOT: casRoot,
        MIMERS_ROOT: mimersConfig,
        MIMERS_DURABILITY_MODE: "none",
      } as NodeJS.ProcessEnv,
      forceMimers: true,
    });
    expect(integration.isMimersBacked).toBe(true);
    expect(MimersIntegration.getCachedCasRootForTests()).toBe(path.resolve(casRoot));
    expect(existsSync(path.join(casRoot, "objects"))).toBe(true);
    expect(existsSync(path.join(mimersConfig, "cas"))).toBe(false);
  });

  it("B/D: MIMERS_ROOT elsewhere / changing MIMERS_ROOT only does not move CAS", async () => {
    const env = {
      NODE_ENV: "development",
      CAS_ROOT: casRoot,
      MIMERS_ROOT: mimersConfig,
      MIMERS_DURABILITY_MODE: "none",
    } as NodeJS.ProcessEnv;
    await MimersIntegration.create({ env, forceMimers: true });
    const first = MimersIntegration.getCachedCasRootForTests();

    resetMimersCasCacheForTests();
    const otherMimers = path.join(parent, "other-mimers");
    mkdirSync(otherMimers);
    await MimersIntegration.create({
      env: { ...env, MIMERS_ROOT: otherMimers },
      forceMimers: true,
    });
    expect(MimersIntegration.getCachedCasRootForTests()).toBe(first);
    expect(existsSync(path.join(otherMimers, "cas"))).toBe(false);
  });

  it("C: missing CAS_ROOT → production durable CAS FAILS CLOSED", async () => {
    await expect(
      MimersIntegration.create({
        env: {
          NODE_ENV: "development",
          MIMERS_ROOT: mimersConfig,
          MIMERS_REQUIRED: "1",
        } as NodeJS.ProcessEnv,
        forceMimers: true,
      }),
    ).rejects.toThrow(/CAS_ROOT_REQUIRED|CAS_ROOT missing/);
  });

  it("F: CAS identity/hash unchanged by physical-root relocation", async () => {
    const body = { relocate: true };
    const content_hash = sha256ContentHash(body);

    const first = await MimersIntegration.create({
      env: {
        NODE_ENV: "development",
        CAS_ROOT: casRoot,
        MIMERS_DURABILITY_MODE: "none",
      } as NodeJS.ProcessEnv,
      forceMimers: true,
    });
    await first.artifactRepository.put({
      artifact_id: "reloc-1",
      content_hash,
      body,
    });
    const digest1 = await first.resolveContentAddress("reloc-1");

    resetMimersCasCacheForTests();
    const casRoot2 = path.join(parent, "cas-b");
    mkdirSync(casRoot2);
    const second = await MimersIntegration.create({
      env: {
        NODE_ENV: "development",
        CAS_ROOT: casRoot2,
        MIMERS_DURABILITY_MODE: "none",
      } as NodeJS.ProcessEnv,
      forceMimers: true,
    });
    await second.artifactRepository.put({
      artifact_id: "reloc-1",
      content_hash,
      body,
    });
    const digest2 = await second.resolveContentAddress("reloc-1");
    expect(digest1).toBe(digest2);
  });

  it("ledger contract: basename(CAS_ROOT) must be cas for backend parent derivation", () => {
    expect(resolveMimersBackendRootFromCasRoot(casRoot)).toBe(path.resolve(parent));
    expect(() => resolveMimersBackendRootFromCasRoot(path.join(parent, "not-cas"))).toThrow(
      /BLOCKED_BY_LEDGER_ROOT_CONTRACT_DECISION/,
    );
    expect(resolveDurableCasRoot({ CAS_ROOT: casRoot } as NodeJS.ProcessEnv)).toBe(
      path.resolve(casRoot),
    );
    expect(() => resolveDurableCasRoot({} as NodeJS.ProcessEnv)).toThrow(CasRootRequiredError);
  });
});
