import type { ArtifactRepositoryPort } from "../kernel/ExecutionKernel.js";
import type { ByteStorageBackend } from "./CasBackedArtifactRepository.js";
import {
  MimersIntegration,
  getCachedMimersBackendForTests,
  resetMimersCasCacheForTests,
} from "../mimers/MimersIntegration.js";

export type ArtifactRepositoryFactoryOptions = {
  readonly env?: NodeJS.ProcessEnv;
  /** Injected backend for tests */
  readonly backend?: ByteStorageBackend;
  /**
   * When true, ignore NODE_ENV/VITEST memory shortcut (used by Mimers verification tests).
   */
  readonly forceMimers?: boolean;
};

/**
 * Thin alias for MimersIntegration.create().artifactRepository.
 * Prefer MimersIntegration for platform composition roots.
 */
export async function createKernelArtifactRepository(
  options: ArtifactRepositoryFactoryOptions = {},
): Promise<ArtifactRepositoryPort> {
  const integration = await MimersIntegration.create(options);
  return integration.artifactRepository;
}

/**
 * Boot-time gate: when MIMERS_REQUIRED, refuse to continue unless CAS initializes.
 */
export async function assertMimersCasReady(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await MimersIntegration.assertReady(env);
}

export { getCachedMimersBackendForTests, resetMimersCasCacheForTests };
