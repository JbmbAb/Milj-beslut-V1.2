import path from "node:path";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
  type ByteStorageBackend,
} from "./CasBackedArtifactRepository.js";
import { MimersByteStorageBackend } from "./MimersByteStorageBackend.js";
import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";

export type ArtifactRepositoryFactoryOptions = {
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

/**
 * Single artifact repository factory for ExecutionKernel.
 * Prefer Mimers CAS when MIMERS_ROOT is set; memory under test unless forceMimers.
 * MIMERS_REQUIRED → fail-closed (no silent fallback; init errors throw).
 */
export async function createKernelArtifactRepository(
  options: ArtifactRepositoryFactoryOptions = {},
): Promise<ArtifactRepositoryPort> {
  if (options.backend) {
    return new CasBackedArtifactRepository(options.backend);
  }

  const env = options.env ?? process.env;
  const required = isTruthyFlag(env.MIMERS_REQUIRED);

  if (
    !options.forceMimers &&
    !required &&
    (env.NODE_ENV === "test" || env.VITEST || env.LU_MPS_CAS === "memory")
  ) {
    return new CasBackedArtifactRepository(new MemoryByteStorageBackend());
  }

  const root = env.MIMERS_ROOT?.trim();
  if (!root) {
    if (required) {
      throw new Error(
        "MIMERS_REQUIRED set but MIMERS_ROOT missing for ExecutionKernel CAS (fail-closed)",
      );
    }
    // Dev fallback: still Mimers layout under .data/mimers so one store shape
    const fallback = path.resolve(".data/mimers");
    return createMimersBackedRepository(fallback, env.MIMERS_DURABILITY_MODE, required);
  }

  return createMimersBackedRepository(root, env.MIMERS_DURABILITY_MODE, required);
}

/**
 * Boot-time gate: when MIMERS_REQUIRED, refuse to continue unless CAS initializes.
 */
export async function assertMimersCasReady(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isTruthyFlag(env.MIMERS_REQUIRED)) return;
  await createKernelArtifactRepository({ env, forceMimers: true });
}

async function createMimersBackedRepository(
  rootDir: string,
  durabilityRaw: string | undefined,
  required: boolean,
): Promise<ArtifactRepositoryPort> {
  const durabilityMode =
    durabilityRaw === "strict" || durabilityRaw === "none" || durabilityRaw === "best-effort"
      ? durabilityRaw
      : "best-effort";

  try {
    if (!cachedMimersCas || cachedMimersRoot !== rootDir) {
      const cas = new FileCASRepository(path.join(rootDir, "cas"), { durabilityMode });
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

  return new CasBackedArtifactRepository(cachedMimersBackend!);
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
