/**
 * SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-V1.
 *
 * Provisions and activates ONE new Source Registry governor signing key
 * (ed25519:source-registry-governor-2026-08-25), as successor authority to the historical
 * ed25519:source-registry-governor-2026-08-14 -- made safe by SOURCE-REGISTRY-MULTI-KEY-
 * VERIFICATION-V1 (commit 434e4673), which resolves each registry entry's trusted key by its own
 * attestation.signer rather than one registry-wide key.
 *
 * HONEST BOUNDARY (reported, not papered over): the real historical public key for
 * ed25519:source-registry-governor-2026-08-14 has never been available in this local
 * environment -- confirmed absent from .env.local, .env, process env, ~/.mimers/secrets/, and
 * every tracked file in this repo (only the fixture/test keys under that literal string exist,
 * e.g. in P2SRVerifyOnly01.test.ts, all synthetic). This script therefore cannot add the REAL
 * historical key to the trusted-keys file -- there is nothing real to add. Proof #3 ("historical
 * MMOD entry still verifies under old key") is proven MECHANISTICALLY with a fixture old key
 * standing in for the real one (the exact same multi-key resolution code path the real key would
 * use), not against the real committed MMOD signature. Supplying the real historical public key
 * PEM (not secret -- public keys are never sensitive) so it can be added to the trusted-keys file
 * is a separate, owner-supplied action this script cannot perform.
 *
 * Does NOT approve Falkenbergs kommun, does NOT touch national-registry.json, does NOT quarantine
 * or CAS-admit anything.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-source-registry-governor-key-rotation-01.ts --execute
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { approveSourceRegistryEntry } from '../../packages/mps-data-governance/src/SourceApproval';
import { unsignedDraftFixture } from '../../packages/mps-data-governance/tests/fixtures/unsignedSourceRegistryDrafts';
import {
  loadVerifiedSourceRegistry,
  createSourceRegistryTrustedKeyring,
  type SourceRegistryArtifact,
} from '../../packages/mps-data-governance/src/SourceRegistry';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const NEW_GOVERNOR_KEY_NAME = 'source-registry-governor-signing-key-v1';
const NEW_GOVERNOR_KEY_ID = 'ed25519:source-registry-governor-2026-08-25';
const HISTORICAL_GOVERNOR_KEY_ID = 'ed25519:source-registry-governor-2026-08-14';
const OWNER_APPROVER = 'bjb@miljöbeslut.se';

// Scoped to distinguish this authority from every other real governance key minted this
// session -- listed explicitly so the "no reuse" invariant is checkable at a glance.
const OTHER_REAL_GOVERNANCE_KEY_IDS = [
  'ed25519:document-fact-extractor-v1',
  'ed25519:document-fact-reviewer-v1',
  'ed25519:governance-promotion-v1',
];

function loadOrGenerateKey(name: string, keyId: string) {
  const dir = `${SECRETS_DIR}/${name}`;
  const privatePath = `${dir}/private.pem`;
  const publicPath = `${dir}/public.pem`;
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return { keyId, privatePem: readFileSync(privatePath, 'utf8'), publicPem: readFileSync(publicPath, 'utf8'), freshlyGenerated: false };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate(keyId);
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  return { keyId, privatePem: privateKey, publicPem: publicKey, freshlyGenerated: true };
}

function fingerprint(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem, 'utf8').digest('hex').slice(0, 16);
}

async function main() {
  console.log('########## PROVE-SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-01 ##########\n');
  if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');

  console.log('=== STEP 1: provision the new governor key (outside repo, private material never printed) ===\n');
  const newGov = loadOrGenerateKey(NEW_GOVERNOR_KEY_NAME, NEW_GOVERNOR_KEY_ID);
  console.log(`  key_id: ${newGov.keyId}`);
  console.log(`  freshly generated this run: ${newGov.freshlyGenerated}`);
  console.log(`  public key fingerprint (sha256, first 16 hex chars): ${fingerprint(newGov.publicPem)}`);
  console.log(`  storage location category: ~/.mimers/secrets/${NEW_GOVERNOR_KEY_NAME}/ (private.pem mode 0600, outside repo)\n`);

  console.log('=== STEP 2: separation of duties -- distinct from every other real governance key this session ===\n');
  const distinctFromOthers = !OTHER_REAL_GOVERNANCE_KEY_IDS.includes(newGov.keyId);
  const distinctFromHistorical = newGov.keyId !== HISTORICAL_GOVERNOR_KEY_ID;
  console.log(`  distinct from other real governance keys (${OTHER_REAL_GOVERNANCE_KEY_IDS.join(', ')}): ${distinctFromOthers}`);
  console.log(`  distinct from historical governor key: ${distinctFromHistorical}\n`);

  console.log('=== STEP 3: fresh-process signing authority resolution (real env provisioning) ===\n');
  process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = newGov.keyId;
  process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM = newGov.privatePem;
  process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = newGov.publicPem;
  const { getSourceRegistrySigningKeyFromEnv } = await import('../../packages/mps-data-governance/src/SourceRegistry');
  const resolvedSigner = getSourceRegistrySigningKeyFromEnv();
  const signerResolvedCorrectly = resolvedSigner.keyId === newGov.keyId;
  console.log(`  getSourceRegistrySigningKeyFromEnv() resolves key_id: ${resolvedSigner.keyId}`);
  console.log(`  matches provisioned new governor: ${signerResolvedCorrectly}\n`);

  console.log('=== STEP 4: new governor signs a real synthetic Source Registry approval ===\n');
  const newSigningProvider = new LocalPemSigningKeyProvider(newGov.keyId, newGov.privatePem, newGov.publicPem);
  const newEntry = await approveSourceRegistryEntry({
    entry: unsignedDraftFixture('sfs'),
    approver_actor_id: OWNER_APPROVER,
    signing: newSigningProvider,
  });
  console.log(`  approved entry source_id: ${newEntry.source_id}`);
  console.log(`  attestation.signer: ${newEntry.approval_attestation.signer}\n`);

  console.log('=== STEP 5: synthetic historical entry, standing in for the real (locally unavailable) old key ===\n');
  const historicalFixtureKey = LocalPemSigningKeyProvider.generate(HISTORICAL_GOVERNOR_KEY_ID);
  const historicalEntry = await approveSourceRegistryEntry({
    entry: unsignedDraftFixture('puh'),
    approver_actor_id: 'governor:historical-fixture-standin',
    signing: historicalFixtureKey.provider,
  });

  console.log('=== STEP 6: build the trust keyring (new key REAL, historical key FIXTURE stand-in) and prove coexistence ===\n');
  const keyring = createSourceRegistryTrustedKeyring(
    new Map([
      [newGov.keyId, newGov.publicPem],
      [HISTORICAL_GOVERNOR_KEY_ID, historicalFixtureKey.publicKey], // stand-in, see file header
    ]),
  );
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'sr-rotation-'));
  const registryPath = path.join(tmpDir, 'registry.json');
  writeFileSync(registryPath, JSON.stringify([historicalEntry, newEntry], null, 2) + '\n', 'utf8');
  const loaded = await loadVerifiedSourceRegistry({ registryPath, trustedKeyring: keyring });
  const bothCoexist = loaded.sources.length === 2;
  console.log(`  both entries (historical-standin + new real key) verify together: ${bothCoexist}\n`);

  console.log('=== NEGATIVE PROOFS ===\n');
  let denyWrongPrivateKey = false;
  try {
    const impostor = LocalPemSigningKeyProvider.generate(newGov.keyId);
    const impostorEntry = await approveSourceRegistryEntry({
      entry: unsignedDraftFixture('sfs'),
      approver_actor_id: OWNER_APPROVER,
      signing: impostor.provider,
    });
    const badPath = path.join(tmpDir, 'bad-registry.json');
    writeFileSync(badPath, JSON.stringify([impostorEntry], null, 2) + '\n', 'utf8');
    await loadVerifiedSourceRegistry({ registryPath: badPath, trustedKeyring: keyring });
  } catch (err) {
    denyWrongPrivateKey = err instanceof Error && /signature_valid/.test(err.message);
    console.log(`  [wrong private key claiming new key id] denied: ${denyWrongPrivateKey}`);
  }

  let denyUnknownSigner = false;
  try {
    const unknown = LocalPemSigningKeyProvider.generate('ed25519:unregistered-governor');
    const unknownEntry = await approveSourceRegistryEntry({
      entry: unsignedDraftFixture('sfs'),
      approver_actor_id: OWNER_APPROVER,
      signing: unknown.provider,
    });
    const unknownPath = path.join(tmpDir, 'unknown-registry.json');
    writeFileSync(unknownPath, JSON.stringify([unknownEntry], null, 2) + '\n', 'utf8');
    await loadVerifiedSourceRegistry({ registryPath: unknownPath, trustedKeyring: keyring });
  } catch (err) {
    denyUnknownSigner = err instanceof Error && /untrusted key/i.test(err.message);
    console.log(`  [unknown signer] denied: ${denyUnknownSigner}`);
  }

  let denyTampered = false;
  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as SourceRegistryArtifact[];
    (raw[1] as unknown as { policy: { rate_limit_requests_per_second: number } }).policy.rate_limit_requests_per_second = 999;
    const tamperedPath = path.join(tmpDir, 'tampered-registry.json');
    writeFileSync(tamperedPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    await loadVerifiedSourceRegistry({ registryPath: tamperedPath, trustedKeyring: keyring });
  } catch (err) {
    denyTampered = err instanceof Error;
    console.log(`  [tampered payload] denied: ${denyTampered}`);
  }

  console.log('\n=== STEP 7: verify-only resolution (public keys only, no private material referenced) ===\n');
  const verifyOnlyKeyring = createSourceRegistryTrustedKeyring(
    new Map([
      [newGov.keyId, newGov.publicPem],
      [HISTORICAL_GOVERNOR_KEY_ID, historicalFixtureKey.publicKey],
    ]),
  );
  const verifyOnlyLoad = await loadVerifiedSourceRegistry({ registryPath, trustedKeyring: verifyOnlyKeyring });
  const verifyOnlyWorks = verifyOnlyLoad.sources.length === 2;
  console.log(`  verify-only host loads both historical-standin and new real entries: ${verifyOnlyWorks}\n`);

  const ok =
    signerResolvedCorrectly && distinctFromOthers && distinctFromHistorical && bothCoexist &&
    denyWrongPrivateKey && denyUnknownSigner && denyTampered && verifyOnlyWorks;

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' OWNER ACTIVATION RECORD');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(
    JSON.stringify(
      {
        decision: 'ACTIVATE NEW SOURCE REGISTRY GOVERNOR SIGNING AUTHORITY',
        note: 'NOT approval of Falkenbergs kommun or any source entry -- key/authority activation only',
        approver: OWNER_APPROVER,
        new_governor_key_id: newGov.keyId,
        new_governor_public_key_fingerprint: fingerprint(newGov.publicPem),
        historical_governor_key_id: HISTORICAL_GOVERNOR_KEY_ID,
        historical_key_status: 'HISTORICAL VERIFICATION AUTHORITY (not revoked; real public key not locally available -- see file header)',
        activated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
