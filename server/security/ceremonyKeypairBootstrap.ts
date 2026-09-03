import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type CeremonyKeypairTarget = Readonly<{ family: string; keyId: string }>;
export type CeremonyKeypair = Readonly<{ keyId: string; privatePem: string; publicPem: string }>;

export function keypairPaths(root: string, family: string) {
  const directory = join(root, family);
  return { directory, privatePath: join(directory, 'private.pem'), publicPath: join(directory, 'public.pem') };
}

export function assertEmptyKeypairTarget(root: string, family: string): void {
  const { privatePath, publicPath } = keypairPaths(root, family);
  const privateExists = existsSync(privatePath);
  const publicExists = existsSync(publicPath);
  if (privateExists && publicExists) throw new Error(`REJECT_CEREMONY_ALREADY_PROVISIONED: ${family}`);
  if (privateExists || publicExists) throw new Error(`REJECT_CEREMONY_INCONSISTENT_KEY_STATE: ${family}`);
}

export function assertAllTargetsEmpty(root: string, targets: readonly CeremonyKeypairTarget[]): void {
  for (const target of targets) assertEmptyKeypairTarget(root, target.family);
}

export function createKeypair(root: string, target: CeremonyKeypairTarget): CeremonyKeypair {
  assertEmptyKeypairTarget(root, target.family);
  const { directory, privatePath, publicPath } = keypairPaths(root, target.family);
  mkdirSync(directory, { recursive: true });
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(privatePath, privatePem, { mode: 0o600, flag: 'wx' });
  writeFileSync(publicPath, publicPem, { flag: 'wx' });
  return { keyId: target.keyId, privatePem, publicPem };
}

export function readKeypair(root: string, target: CeremonyKeypairTarget): CeremonyKeypair {
  const { privatePath, publicPath } = keypairPaths(root, target.family);
  return { keyId: target.keyId, privatePem: readFileSync(privatePath, 'utf8'), publicPem: readFileSync(publicPath, 'utf8') };
}
