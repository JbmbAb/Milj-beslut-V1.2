import { MimersIntegration, type ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { PRODUCT_RELEASE_CONTRACT_VERSION_V3, type ProductReleaseManifestArtifact } from '../../../packages/mps-governance/src/release/ProductReleaseAuthority.js';
import { logger } from '../../logger';
import { EXPLICIT_PROCESS_RULE_TEXT, isExplicitDevelopmentOrTestProcess } from './processClassification';
import {
  ProductReleaseIdentityUnavailableError,
  RELEASE_IDENTITY_FILE_NAME,
  assertProductReleaseBuildIdentity,
  deliveredRootFromModule,
  readReleaseIdentityFile,
} from './productReleaseBuildIdentity';
import { PRODUCT_RELEASE_ARTIFACT_ID_ENV, resolveCanonicalProductRelease } from './productReleaseRuntime';
import { setRunningProductRelease, type RunningProductRelease } from './runningProductRelease';

/**
 * W-U42 -- the process start-up gate for the release identity (web and the four LU workers call it before they
 * serve or poll anything):
 *
 *  1. release-identity.json is read from the process's OWN delivered root (never cwd);
 *  2. with neither the file nor PRODUCT_RELEASE_ARTIFACT_ID, only an EXPLICIT development/test process may start --
 *     without a release identity, stated in its start-up line (GET /api/release then answers
 *     PRODUCT_RELEASE_IDENTITY_UNAVAILABLE); every other process refuses: a product process starts only under a
 *     measured release identity;
 *  3. the file without the configured release, or the release without the file, refuses in every process;
 *  4. otherwise the configured release manifest is resolved and verified from the durable CAS
 *     (resolveCanonicalProductRelease), must be product-release-v3, and the delivered files are re-measured and
 *     compared with the file and the manifest (assertProductReleaseBuildIdentity): any deviation is
 *     REJECT_PRODUCT_RELEASE_BUILD_MISMATCH and the process does not start;
 *  5. the running identity is recorded for /api/release and logged: release id, hash, commit, digest and CAS root.
 *     Never a secret: the log carries identifiers and hashes only.
 *
 * Nothing here says anything about authenticity or verification of assessments: the gate binds the running code
 * to a release manifest; it is a reproducibility/identity check of the deployment.
 */

export type StartupLog = (message: string, context: Record<string, unknown>) => void;

async function defaultArtifactRepository(env: NodeJS.ProcessEnv): Promise<ArtifactRepositoryPort> {
  const mimers = await MimersIntegration.create({ env: { ...env, MIMERS_REQUIRED: '1' }, forceMimers: true });
  return mimers.artifactRepository;
}

export async function assertProductReleaseIdentityAtStartup(args: {
  readonly role: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly root?: string;
  readonly createArtifactRepository?: (env: NodeJS.ProcessEnv) => Promise<ArtifactRepositoryPort>;
  readonly resolveRelease?: (repository: ArtifactRepositoryPort, env: NodeJS.ProcessEnv) => Promise<ProductReleaseManifestArtifact>;
  readonly log?: StartupLog;
}): Promise<RunningProductRelease | null> {
  const env = args.env ?? process.env;
  const root = args.root ?? deliveredRootFromModule();
  const log: StartupLog = args.log ?? ((message, context) => logger.info(message, context));

  const identity = readReleaseIdentityFile(root);
  const releaseId = env[PRODUCT_RELEASE_ARTIFACT_ID_ENV]?.trim();

  if (!identity && !releaseId) {
    if (isExplicitDevelopmentOrTestProcess(env)) {
      setRunningProductRelease(null);
      log('product release identity', {
        process_role: args.role,
        release_identity: 'none',
        reason:
          `no ${RELEASE_IDENTITY_FILE_NAME} under the delivered root and no ${PRODUCT_RELEASE_ARTIFACT_ID_ENV}: an explicit development/test ` +
          `process may run without a release identity; GET /api/release answers PRODUCT_RELEASE_IDENTITY_UNAVAILABLE`,
        delivered_root: root,
      });
      return null;
    }
    throw new ProductReleaseIdentityUnavailableError(
      `no ${RELEASE_IDENTITY_FILE_NAME} under ${root} and no ${PRODUCT_RELEASE_ARTIFACT_ID_ENV}; a product process starts only under a measured ` +
        `release identity (${EXPLICIT_PROCESS_RULE_TEXT})`,
    );
  }
  if (!identity) {
    throw new ProductReleaseIdentityUnavailableError(
      `${PRODUCT_RELEASE_ARTIFACT_ID_ENV} is set but ${RELEASE_IDENTITY_FILE_NAME} is missing under ${root}: the delivered files cannot be bound to the configured release`,
    );
  }
  if (!releaseId) {
    throw new ProductReleaseIdentityUnavailableError(
      `${RELEASE_IDENTITY_FILE_NAME} is present under ${root} but ${PRODUCT_RELEASE_ARTIFACT_ID_ENV} is not set: a delivered build runs only under its issued release`,
    );
  }

  const repository = await (args.createArtifactRepository ?? defaultArtifactRepository)(env);
  const release = await (args.resolveRelease ?? ((repo, e) => resolveCanonicalProductRelease({ artifactRepository: repo, env: e })))(repository, env);
  const { measured } = assertProductReleaseBuildIdentity({ root, release, identity });

  const running: RunningProductRelease = {
    process_role: args.role,
    release_artifact_id: release.artifact_id,
    release_hash: release.release_hash.value,
    contract_version: PRODUCT_RELEASE_CONTRACT_VERSION_V3,
    product_name: release.payload.product_name,
    build_identity: identity.build_identity,
    measured: { source_digest_sha256: measured.source_digest_sha256, file_count: measured.file_count },
    delivered_root: root,
    cas_root: env.MIMERS_ROOT?.trim() || null,
  };
  setRunningProductRelease(running);
  log('product release identity', {
    process_role: running.process_role,
    release_artifact_id: running.release_artifact_id,
    release_hash: running.release_hash,
    contract_version: running.contract_version,
    source_commit_sha: identity.build_identity.source_commit_sha,
    source_digest_sha256: running.measured.source_digest_sha256,
    measured_file_count: running.measured.file_count,
    cas_root: running.cas_root,
    delivered_root: root,
  });
  return running;
}
