import { Router } from 'express';
import { PRODUCT_RELEASE_IDENTITY_UNAVAILABLE } from '../modules/release/productReleaseBuildIdentity';
import { getRunningProductRelease } from '../modules/release/runningProductRelease';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';

/**
 * W-U42 (owner decision 2026-10-02 row 7 / DP-23): the running release is visible ONLY here, authenticated.
 *
 * GET /api/release answers what the process start-up gate (server/modules/release/productReleaseStartup.ts) decided
 * for THIS process: the release manifest it runs under (id, hash, contract version, product name, the full
 * product-release-v3 build identity: commit, tree, measured source digest, composition hash, build-args hash and the
 * three file hashes) and what the process measured itself at start. Never a secret, never a filesystem path, and
 * never a statement about assessments: this is the deployment's identity, not a verification of anything stored.
 *
 * A process that started without a release identity (an explicit development/test process without
 * release-identity.json and PRODUCT_RELEASE_ARTIFACT_ID) answers 503 PRODUCT_RELEASE_IDENTITY_UNAVAILABLE instead of
 * inventing one. The liveness probe /health (createApp.ts) carries none of this.
 */
const router = Router();

router.get('/api/release', requireAuth, rateLimitByUser(60, 60_000), (_req, res) => {
  const running = getRunningProductRelease();
  if (!running) {
    res.status(503).json({
      ok: false,
      code: PRODUCT_RELEASE_IDENTITY_UNAVAILABLE,
      retryable: false,
      error:
        'Processen kör utan mätt releaseidentitet (en uttrycklig utvecklings- eller testprocess utan release-identity.json och ' +
        'PRODUCT_RELEASE_ARTIFACT_ID). Ingen releaseidentitet kan redovisas.',
    });
    return;
  }
  res.status(200).json({
    ok: true,
    release: {
      artifact_id: running.release_artifact_id,
      release_hash: running.release_hash,
      contract_version: running.contract_version,
      product_name: running.product_name,
      build_identity: running.build_identity,
    },
    measured: { source_digest_sha256: running.measured.source_digest_sha256, file_count: running.measured.file_count },
    process: { role: running.process_role },
  });
});

export default router;
