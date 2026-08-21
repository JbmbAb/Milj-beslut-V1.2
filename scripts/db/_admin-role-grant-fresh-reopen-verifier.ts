/**
 * PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01 -- fresh-reopen verification-only child process.
 *
 * Spawned as a genuinely separate `node`/`tsx` process by
 * product-admin-authority-bootstrap-01.ts with ONLY ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM (and the
 * key id) set in env -- ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM is deliberately absent. Reads the
 * persisted grant back from the CAS by hash (argv[2]) and verifies it. Never imports
 * server/security/adminRoleGrantSigningKey.ts.
 *
 * Prints a single JSON line to stdout: {ok, role, privateKeyEnvPresent, ...}
 */
import '../../server/loadEnvFirst';
import { readAdminRoleGrantFromCas, verifyAdminRoleGrant, AdminRoleGrantRejected } from '../../server/services/adminRoleGrantService';

async function main() {
  const hash = process.argv[2];
  if (!hash) throw new Error('usage: _admin-role-grant-fresh-reopen-verifier.ts <casHash>');

  const privateKeyEnvPresent = 'ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM' in process.env;
  const publicKeyEnvPresent = 'ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM' in process.env;

  const artifact = readAdminRoleGrantFromCas(hash);
  if (!artifact) {
    console.log(JSON.stringify({ ok: false, error: 'grant not found in CAS', privateKeyEnvPresent, publicKeyEnvPresent }));
    return;
  }

  try {
    await verifyAdminRoleGrant(artifact);
    console.log(JSON.stringify({
      ok: true,
      artifact_id: artifact.artifact_id,
      subject_user_id: artifact.payload.subject_user_id,
      privateKeyEnvPresent,
      publicKeyEnvPresent,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      error: error instanceof AdminRoleGrantRejected ? error.reason : String(error),
      privateKeyEnvPresent,
      publicKeyEnvPresent,
    }));
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: `FATAL: ${error instanceof Error ? error.message : String(error)}` }));
  process.exitCode = 1;
});
