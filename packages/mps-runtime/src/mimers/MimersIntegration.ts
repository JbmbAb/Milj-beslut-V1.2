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

export const MIMERS_INTEGRATION_VERSION = "1.0.0" as const;

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
let cachedMimersRoot: string | null = null;
let cachedMimersBackend: MimersByteStorageBackend | null = null;

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
   * Create the sole platform artifact stack (memory under test, Mimers otherwise).
   * MIMERS_REQUIRED → fail-closed (no silent fallback).
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

    if (
      !options.forceMimers &&
      !required &&
      (env.NODE_ENV === "test" || env.VITEST || env.LU_MPS_CAS === "memory")
    ) {
      const repo = new CasBackedArtifactRepository(new MemoryByteStorageBackend());
      return new MimersIntegration(repo, repo.resolver, null);
    }

    const root = env.MIMERS_ROOT?.trim();
    if (!root) {
      if (required) {
        throw new Error(
          "MIMERS_REQUIRED set but MIMERS_ROOT missing for ExecutionKernel CAS (fail-closed)",
        );
      }
      const fallback = path.resolve(".data/mimers");
      return MimersIntegration.createMimersBacked(
        fallback,
        env.MIMERS_DURABILITY_MODE,
        required,
      );
    }

    return MimersIntegration.createMimersBacked(
      root,
      env.MIMERS_DURABILITY_MODE,
      required,
    );
  }

  /** Boot-time gate: when MIMERS_REQUIRED, refuse to continue unless CAS initializes. */
  static async assertReady(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!isTruthyFlag(env.MIMERS_REQUIRED)) return;
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
    rootDir: string,
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
      if (!cachedMimersCas || cachedMimersRoot !== rootDir) {
        const cas = new FileCASRepository(path.join(rootDir, "cas"), {
          durabilityMode,
        });
        await cas.initialize();
        cachedMimersCas = cas;
        cachedMimersRoot = rootDir;
        const indexDir = path.join(rootDir, "cas", "artifact-id-index");
        cachedMimersBackend = new MimersByteStorageBackend(cas, indexDir);
      }
    } catch (err) {
      cachedMimersCas = null;
      cachedMimersRoot = null;
      cachedMimersBackend = null;
      const detail = err instanceof Error ? err.message : String(err);
      if (required) {
        throw new Error(
          `MIMERS_REQUIRED: Mimers CAS failed to initialize under '${rootDir}': ${detail}`,
        );
      }
      throw err;
    }

    const repo = new CasBackedArtifactRepository(cachedMimersBackend!);
    return new MimersIntegration(repo, repo.resolver, cachedMimersBackend);
  }
}

/** Expose backend for index-rebuild / content-address verification tests. */
export function getCachedMimersBackendForTests(): MimersByteStorageBackend | null {
  return cachedMimersBackend;
}

/** Test helper to clear Mimers CAS singleton between suites. */
export function resetMimersCasCacheForTests(): void {
  cachedMimersCas = null;
  cachedMimersRoot = null;
  cachedMimersBackend = null;
}
