import type { ProductReleaseBuildIdentityV3 } from '../../../packages/mps-governance/src/release/ProductReleaseAuthority.js';

/**
 * W-U42 -- the release identity THIS process started under, as decided once by the start-up gate
 * (productReleaseStartup.ts) and read by GET /api/release. Nothing else writes it.
 *
 * `null` means the process runs without a release identity (allowed only for an explicit development/test process
 * without release-identity.json and without PRODUCT_RELEASE_ARTIFACT_ID): /api/release then answers
 * PRODUCT_RELEASE_IDENTITY_UNAVAILABLE instead of inventing one.
 */
export type RunningProductRelease = {
  readonly process_role: string;
  readonly release_artifact_id: string;
  readonly release_hash: string;
  readonly contract_version: 'product-release-v3';
  readonly product_name: string;
  readonly build_identity: ProductReleaseBuildIdentityV3;
  /** What this process measured itself at start (equal to the identity by construction, or it did not start). */
  readonly measured: { readonly source_digest_sha256: string; readonly file_count: number };
  readonly delivered_root: string;
  readonly cas_root: string | null;
};

let running: RunningProductRelease | null = null;
let decided = false;

export function setRunningProductRelease(value: RunningProductRelease | null): void {
  running = value;
  decided = true;
}

export function getRunningProductRelease(): RunningProductRelease | null {
  return running;
}

/** Whether the start-up gate has run in this process at all (false in tests and in processes that skip it). */
export function hasStartupDecidedProductRelease(): boolean {
  return decided;
}

export function resetRunningProductReleaseForTests(): void {
  running = null;
  decided = false;
}
