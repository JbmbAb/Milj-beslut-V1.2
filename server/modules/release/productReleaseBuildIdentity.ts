import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS,
  PRODUCT_RELEASE_CONTRACT_VERSION_V3,
  canonicalProductReleaseBuildIdentityV3,
  isProductReleaseManifestArtifactV3,
  type ProductReleaseBuildIdentityV3,
  type ProductReleaseManifestArtifact,
} from '../../../packages/mps-governance/src/release/ProductReleaseAuthority.js';
import {
  RELEASE_IDENTITY_CONTRACT_VERSION,
  RELEASE_IDENTITY_FILE_NAME,
  measureLegacyIdentityHashes,
  measureSourceDigest,
} from '../../../scripts/release/buildIdentityDigest.mjs';

/**
 * W-U42 (U42a, point 2) -- a process binds the files it actually runs to the release it is configured with.
 *
 * At start, every product process (web and the four LU workers) re-measures its delivered files with the ONE
 * algorithm the build used (scripts/release/buildIdentityDigest.mjs) and compares three things that must describe one
 * build: the measurement, release-identity.json (written by the build) and the signed release manifest named by
 * PRODUCT_RELEASE_ARTIFACT_ID. Any deviation is REJECT_PRODUCT_RELEASE_BUILD_MISMATCH and the process refuses to
 * start (U40-U50B-SPEC §1.6). The identity is read from the process's own delivered root -- derived from this
 * module's location -- never from the current working directory (U40-A2 finding R8).
 *
 * Only `product-release-v3` carries a measurable identity; a v1/v2 manifest can never be the running release
 * (forward-only: those stay historical and verifiable for stored assessments and capabilities).
 */

export { RELEASE_IDENTITY_FILE_NAME };
export const REJECT_PRODUCT_RELEASE_BUILD_MISMATCH = 'REJECT_PRODUCT_RELEASE_BUILD_MISMATCH' as const;
export const PRODUCT_RELEASE_IDENTITY_UNAVAILABLE = 'PRODUCT_RELEASE_IDENTITY_UNAVAILABLE' as const;

/** The process has no (usable) release identity: no file, an unreadable or malformed file, or an incomplete configuration. */
export class ProductReleaseIdentityUnavailableError extends Error {
  readonly code = PRODUCT_RELEASE_IDENTITY_UNAVAILABLE;

  constructor(readonly reason: string) {
    super(`${PRODUCT_RELEASE_IDENTITY_UNAVAILABLE}: ${reason}`);
    this.name = 'ProductReleaseIdentityUnavailableError';
  }
}

/** The delivered files, release-identity.json and the configured release manifest do not describe one build. */
export class ProductReleaseBuildMismatchError extends Error {
  readonly code = REJECT_PRODUCT_RELEASE_BUILD_MISMATCH;

  constructor(readonly mismatches: readonly string[]) {
    super(
      `${REJECT_PRODUCT_RELEASE_BUILD_MISMATCH}: the delivered files, ${RELEASE_IDENTITY_FILE_NAME} and the configured release manifest ` +
        `do not describe one build (${mismatches.join('; ')}); the process refuses to start`,
    );
    this.name = 'ProductReleaseBuildMismatchError';
  }
}

export type ReleaseIdentityFile = {
  readonly contract_version: typeof PRODUCT_RELEASE_CONTRACT_VERSION_V3;
  readonly build_identity: ProductReleaseBuildIdentityV3;
  /** How the build measured (roots present, file counts, declared vs measured composition); informational. */
  readonly measurement: Readonly<Record<string, unknown>>;
};

export type MeasuredBuildIdentity = {
  readonly source_digest_sha256: string;
  readonly file_count: number;
  readonly package_lock_sha256: string;
  readonly package_manifest_sha256: string;
  readonly runtime_entrypoint_sha256: string;
};

const LEGACY_FIELDS = ['package_lock_sha256', 'package_manifest_sha256', 'runtime_entrypoint_sha256'] as const;

/** The repository/delivered root this module runs from: `<root>/server/modules/release/` -> `<root>`. */
export function deliveredRootFromModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * Reads `<root>/release-identity.json`. Absent -> null (the caller decides whether that is allowed). Present but
 * unreadable, not JSON, not v3 or with an incomplete/malformed build identity -> ProductReleaseIdentityUnavailableError.
 */
export function readReleaseIdentityFile(root: string): ReleaseIdentityFile | null {
  const file = path.join(root, RELEASE_IDENTITY_FILE_NAME);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return null;
    throw new ProductReleaseIdentityUnavailableError(`${file} cannot be read (${code ?? 'unknown error'})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProductReleaseIdentityUnavailableError(`${file} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProductReleaseIdentityUnavailableError(`${file} is not a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.contract_version !== PRODUCT_RELEASE_CONTRACT_VERSION_V3 || RELEASE_IDENTITY_CONTRACT_VERSION !== PRODUCT_RELEASE_CONTRACT_VERSION_V3) {
    throw new ProductReleaseIdentityUnavailableError(
      `${file} declares contract_version ${JSON.stringify(record.contract_version)}; a running release identity must be ${PRODUCT_RELEASE_CONTRACT_VERSION_V3}`,
    );
  }
  let buildIdentity: ProductReleaseBuildIdentityV3;
  try {
    buildIdentity = canonicalProductReleaseBuildIdentityV3(record.build_identity);
  } catch (error) {
    throw new ProductReleaseIdentityUnavailableError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const measurement = record.measurement && typeof record.measurement === 'object' ? (record.measurement as Record<string, unknown>) : {};
  return { contract_version: PRODUCT_RELEASE_CONTRACT_VERSION_V3, build_identity: buildIdentity, measurement };
}

/** What a process can measure at start: the source digest and the three legacy hashes over its delivered root. */
export function measureDeliveredBuildIdentity(root: string): MeasuredBuildIdentity {
  let source: ReturnType<typeof measureSourceDigest>;
  let legacy: ReturnType<typeof measureLegacyIdentityHashes>;
  try {
    // W-U42C: an entry the measurement refuses (a link out of the root, a FIFO/socket/device) is a deviation of the
    // delivered files like a missing V1/V2 file -- the same refusal, never a measurement around it
    source = measureSourceDigest(root);
    legacy = measureLegacyIdentityHashes(root);
  } catch (error) {
    throw new ProductReleaseBuildMismatchError([error instanceof Error ? error.message : String(error)]);
  }
  return { source_digest_sha256: source.source_digest_sha256, file_count: source.file_count, ...legacy };
}

/** Every reason the three descriptions are not one build; empty when they agree. */
export function compareDeliveredBuildIdentity(args: {
  readonly identity: ReleaseIdentityFile;
  readonly measured: MeasuredBuildIdentity;
  readonly release: ProductReleaseManifestArtifact;
}): string[] {
  const mismatches: string[] = [];
  const file = args.identity.build_identity;
  if (args.measured.source_digest_sha256 !== file.source_digest_sha256) {
    mismatches.push(`source_digest_sha256 (measured over the delivered files vs ${RELEASE_IDENTITY_FILE_NAME})`);
  }
  for (const field of LEGACY_FIELDS) {
    if (args.measured[field] !== file[field]) mismatches.push(`${field} (measured over the delivered files vs ${RELEASE_IDENTITY_FILE_NAME})`);
  }
  if (!isProductReleaseManifestArtifactV3(args.release)) {
    mismatches.push(
      `contract_version (the configured release manifest is ${args.release.payload.contract_version}; a running release must be ${PRODUCT_RELEASE_CONTRACT_VERSION_V3})`,
    );
  } else {
    for (const field of PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS) {
      if (args.release.payload.build_identity[field] !== file[field]) mismatches.push(`${field} (${RELEASE_IDENTITY_FILE_NAME} vs release manifest)`);
    }
  }
  return mismatches;
}

/**
 * The check every process runs at start: re-measure the delivered root, compare with release-identity.json and with
 * the configured release manifest; refuse on any deviation.
 */
export function assertProductReleaseBuildIdentity(args: {
  readonly root: string;
  readonly release: ProductReleaseManifestArtifact;
  readonly identity?: ReleaseIdentityFile | null;
}): { identity: ReleaseIdentityFile; measured: MeasuredBuildIdentity } {
  const identity = args.identity ?? readReleaseIdentityFile(args.root);
  if (!identity) {
    throw new ProductReleaseIdentityUnavailableError(
      `${RELEASE_IDENTITY_FILE_NAME} is missing under ${args.root}: the build did not write a release identity, so the process cannot bind its files to a release`,
    );
  }
  const measured = measureDeliveredBuildIdentity(args.root);
  const mismatches = compareDeliveredBuildIdentity({ identity, measured, release: args.release });
  if (mismatches.length > 0) throw new ProductReleaseBuildMismatchError(mismatches);
  return { identity, measured };
}
