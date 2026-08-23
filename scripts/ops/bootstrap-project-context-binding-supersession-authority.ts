/**
 * PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 -- one-time owner-provisioning step.
 *
 * Generates a real, persisted Ed25519 keypair for the dedicated ProjectContextBindingSupersession
 * issuing authority -- deliberately separate from the ordinary ProjectContextBinding issuer (see
 * server/security/projectContextBindingSupersessionSigningKey.ts's header comment for why: that
 * issuer's `allowed_artifact_types` already grants project_property_binding +
 * project_context_binding authority, and widening it to also cover supersession would hand it
 * authority it does not need). Mirrors
 * scripts/ops/bootstrap-localization-geometry-supersession-authority.ts exactly.
 *
 * Never re-run with --execute once real supersessions depend on the resulting key_id -- this is an
 * owner-provisioning step, not a repeatable one. Prints the env vars the owner-side/worker-side
 * minting path needs; the private key must only ever be exported as an ephemeral shell env var
 * when launching that one process, never written to .env/.env.local.
 *
 * Usage: npx tsx scripts/ops/bootstrap-project-context-binding-supersession-authority.ts --execute
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const KEY_NAME = 'project-context-binding-supersession-issuer-v1';
const KEY_ID = `ed25519:${KEY_NAME}`;

function main(): void {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');

  const dir = `${SECRETS_DIR}/${KEY_NAME}`;
  if (existsSync(`${dir}/private.pem`)) {
    throw new Error(`REJECT: ${dir}/private.pem already exists -- this is a one-time owner-provisioning step, never re-run once real supersessions depend on this key.`);
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(`${dir}/private.pem`, privatePem, { mode: 0o600 });
  writeFileSync(`${dir}/public.pem`, publicPem);

  console.log(JSON.stringify({
    key_id: KEY_ID,
    private_key_path: `${dir}/private.pem`,
    public_key_path: `${dir}/public.pem`,
    worker_env: {
      PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID: KEY_ID,
      PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM: '<contents of private.pem -- pass as an ephemeral shell env var, never write to a file the web process reads>',
      PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM: '<contents of public.pem>',
    },
    web_env: {
      PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID: KEY_ID,
      PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM: '<contents of public.pem -- public key only, safe for the web process, used for read-path re-verification>',
    },
  }, null, 2));
}

main();
