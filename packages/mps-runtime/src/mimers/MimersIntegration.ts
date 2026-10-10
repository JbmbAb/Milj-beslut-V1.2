/**
 * Mimers Integration facade — Epoch II §2.4.
 *
 * Canonical product path:
 *   ArtifactRepository → ArtifactResolver → CAS → Mimers Brunn
 *
 * Kernel / replay / LU clients obtain storage only through this facade
 * (or createKernelArtifactRepository, which is a thin alias).
 */

import path from "node:path";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
  type ByteStorageBackend,
} from "../repository/CasBackedArtifactRepository.js";
import { MimersByteStorageBackend } from "../repository/MimersByteStorageBackend.js";
import {
  CasArtifactResolver,
  type ArtifactResolverPort,
} from "./ArtifactResolver.js";
import {
  CasRootRequiredError,
  resolveDurableCasRoot,
} from "./DurableCasRoot.js";
import {
  isMimersTestEnvironment,
} from "./DurableMimersRoot.js";

export const MIMERS_INTEGRATION_VERSION = "1.0.0" as const;

export const LU_MPS_CAS_MEMORY_OUTSIDE_TEST = "LU_MPS_CAS_MEMORY_OUTSIDE_TEST" as const;

export type MimersIntegrationOptions = {
  readonly env?: NodeJS.ProcessEnv;
  /** Injected backend for tests */
  readonly backend?: ByteStorageBackend;
  /**
   * When true, ignore NODE_ENV/VITEST memory shortcut (used by Mimers verification tests).
   */
  readonly forceMimers?: boolean;
};

let cachedMimersCas: FileCASRepository | null = null;
let cachedCasRoot: string | null = null;
let cachedMimersBackend: MimersByteStorageBackend | null = null;
let cachedMemoryMimers: MimersIntegration | null = null;

function isTruthyFlag(raw: string | undefined): boolean {
  return ["1", "true", "yes"].includes((raw ?? "").trim().toLowerCase());
}

export class MimersIntegration {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly resolver: ArtifactResolverPort;
  private readonly mimersBackend: MimersByteStorageBackend | null;

  private constructor(
    artifactRepository: CasBackedArtifactRepository,
    resolver: ArtifactResolverPort,
    mimersBackend: MimersByteStorageBackend | null,
  ) {
    this.artifactRepository = artifactRepository;
    this.resolver = resolver;
    this.mimersBackend = mimersBackend;
  }

  /**
   * Create the sole platform artifact stack.
   *
   * Fail-closed (no silent fallbacks):
   * - in-memory CAS ONLY in an explicit test environment (`NODE_ENV=test` / `VITEST`), and only
   *   when neither `MIMERS_REQUIRED` nor `forceMimers` asks for the durable store;
   * - `LU_MPS_CAS=memory` outside a test environment is a configuration error, never honoured;
   * - otherwise durable CAS from `CAS_ROOT` exactly (not `MIMERS_ROOT/cas`).
   *   `MIMERS_ROOT` remains runtime/config/secrets only and does not locate CAS.
   * `MIMERS_DURABILITY_MODE` handling is unchanged (owner decision DP-12 is open).
   */
  static async create(
    options: MimersIntegrationOptions = {},
  ): Promise<MimersIntegration> {
    if (options.backend) {
      const repo = new CasBackedArtifactRepository(options.backend);
      return new MimersIntegration(repo, repo.resolver, null);
    }

    const env = options.env ?? process.env;
    const required = isTruthyFlag(env.MIMERS_REQUIRED);
    const testEnvironment = isMimersTestEnvironment(env);

    if (env.LU_MPS_CAS === "memory" && !testEnvironment) {
      throw new Error(
        `${LU_MPS_CAS_MEMORY_OUTSIDE_TEST}: LU_MPS_CAS=memory is only honoured under NODE_ENV=test or VITEST; ` +
          "outside a test environment it would silently drop every persisted artifact (fail-closed)",
      );
    }

    if (!options.forceMimers && !required && testEnvironment) {
      if (!cachedMemoryMimers) {
        const repo = new CasBackedArtifactRepository(new MemoryByteStorageBackend());
        cachedMemoryMimers = new MimersIntegration(repo, repo.resolver, null);
      }
      return cachedMemoryMimers;
    }

    if (!env.CAS_ROOT?.trim()) {
      throw new CasRootRequiredError(
        "ExecutionKernel CAS",
        required
          ? "MIMERS_REQUIRED set but CAS_ROOT missing for ExecutionKernel CAS"
          : undefined,
      );
    }
    const casRoot = resolveDurableCasRoot(env, "ExecutionKernel CAS");

    return MimersIntegration.createMimersBacked(
      casRoot,
      env.MIMERS_DURABILITY_MODE,
      required,
    );
  }

  /**
   * Boot-time gate (web process, LU workers): refuse to continue unless the durable CAS
   * initializes. Unconditional outside an explicit test environment (U30-A); inside one it only
   * applies when `MIMERS_REQUIRED` is set.
   */
  static async assertReady(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!isTruthyFlag(env.MIMERS_REQUIRED) && isMimersTestEnvironment(env)) return;
    await MimersIntegration.create({ env, forceMimers: true });
  }

  /** Rebuild id→hash index from CAS envelopes (no-op for memory backend). */
  async rebuildIndex(): Promise<{ rebuilt: number; skipped: number }> {
    if (!this.mimersBackend) return { rebuilt: 0, skipped: 0 };
    return this.mimersBackend.rebuildIndexFromCas();
  }

  /** Content-address digest for artifact_id (null for memory / unknown). */
  async resolveContentAddress(artifactId: string): Promise<string | null> {
    if (!this.mimersBackend) return null;
    return this.mimersBackend.resolveContentAddress(artifactId);
  }

  get isMimersBacked(): boolean {
    return this.mimersBackend !== null;
  }

  private static async createMimersBacked(
    casRoot: string,
    durabilityRaw: string | undefined,
    required: boolean,
  ): Promise<MimersIntegration> {
    const durabilityMode =
      durabilityRaw === "strict" ||
      durabilityRaw === "none" ||
      durabilityRaw === "best-effort"
        ? durabilityRaw
        : "best-effort";

    try {
      if (!cachedMimersCas || cachedCasRoot !== casRoot) {
        const cas = new FileCASRepository(casRoot, {
          durabilityMode,
        });
        await cas.initialize();
        cachedMimersCas = cas;
        cachedCasRoot = casRoot;
        const indexDir = path.join(casRoot, "artifact-id-index");
        cachedMimersBackend = new MimersByteStorageBackend(cas, indexDir);
      }
    } catch (err) {
      cachedMimersCas = null;
      cachedCasRoot = null;
      cachedMimersBackend = null;
      const detail = err instanceof Error ? err.message : String(err);
      if (required) {
        throw new Error(
          `MIMERS_REQUIRED: Mimers CAS failed to initialize under CAS_ROOT '${casRoot}': ${detail}`,
        );
      }
      throw err;
    }

    const repo = new CasBackedArtifactRepository(cachedMimersBackend!);
    return new MimersIntegration(repo, repo.resolver, cachedMimersBackend);
  }

  /** Exact physical CAS root used by the cached durable integration (tests / composition proofs). */
  static getCachedCasRootForTests(): string | null {
    return cachedCasRoot;
  }
}

/** Expose backend for index-rebuild / content-address verification tests. */
export function getCachedMimersBackendForTests(): MimersByteStorageBackend | null {
  return cachedMimersBackend;
}

/** Test helper to clear Mimers CAS singleton between suites. */
export function resetMimersCasCacheForTests(): void {
  cachedMimersCas = null;
  cachedCasRoot = null;
  cachedMimersBackend = null;
}
