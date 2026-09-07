import { createHash } from 'node:crypto';
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import type { ArtifactRepositoryPort } from '../../packages/mps-runtime/src/kernel/ExecutionKernel';
import {
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
  type LuExecutionAuthorityIssuerArtifact,
  type LuExecutionAuthorityRootArtifact,
} from '../../packages/mps-lu/src/artifacts/LuExecutionAuthorityArtifact';
import {
  attestLuExecutionAuthorityIssuer,
  attestLuExecutionAuthorityRoot,
  verifyLuExecutionAuthorityChain,
} from '../../packages/mps-lu/src/execution/LuExecutionAuthorityChain';
import {
  assertAllTargetsEmpty,
  createKeypair,
  type CeremonyKeypair,
  type CeremonyKeypairTarget,
} from './ceremonyKeypairBootstrap';

export const LU_EXECUTION_AUTHORITY_ROOT_FAMILY = 'lu-execution-authority-root';
export const LU_EXECUTION_AUTHORITY_ISSUER_FAMILY = 'lu-execution-authority-issuer';

export type LuExecutionAuthorityCeremonyKeyIds = Readonly<{
  rootKeyId: string;
  issuerKeyId: string;
}>;

export type LuExecutionAuthorityCeremony = Readonly<{
  root: LuExecutionAuthorityRootArtifact;
  issuer: LuExecutionAuthorityIssuerArtifact;
  rootKeypair: CeremonyKeypair;
  issuerKeypair: CeremonyKeypair;
}>;

function fingerprint(publicPem: string): string {
  return createHash('sha256').update(publicPem).digest('hex');
}

function targets(keyIds: LuExecutionAuthorityCeremonyKeyIds): readonly CeremonyKeypairTarget[] {
  return [
    { family: LU_EXECUTION_AUTHORITY_ROOT_FAMILY, keyId: keyIds.rootKeyId },
    { family: LU_EXECUTION_AUTHORITY_ISSUER_FAMILY, keyId: keyIds.issuerKeyId },
  ];
}

export async function bootstrapLuExecutionAuthorityCeremony(args: {
  readonly secretsRoot: string;
  readonly keyIds: LuExecutionAuthorityCeremonyKeyIds;
  readonly repository: ArtifactRepositoryPort;
}): Promise<LuExecutionAuthorityCeremony> {
  const ceremonyTargets = targets(args.keyIds);
  // Preflight both files before generating either half of the authority chain.
  assertAllTargetsEmpty(args.secretsRoot, ceremonyTargets);

  const rootKeypair = createKeypair(args.secretsRoot, ceremonyTargets[0]);
  const issuerKeypair = createKeypair(args.secretsRoot, ceremonyTargets[1]);
  const rootSigning = new LocalPemSigningKeyProvider(rootKeypair.keyId, rootKeypair.privatePem, rootKeypair.publicPem);

  const bareRoot = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKeypair.keyId,
    public_key_fingerprint: fingerprint(rootKeypair.publicPem),
  });
  const root: LuExecutionAuthorityRootArtifact = {
    ...bareRoot,
    attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootSigning }),
  };
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKeypair.keyId,
    public_key_fingerprint: fingerprint(issuerKeypair.publicPem),
    root_ref: { artifact_id: root.artifact_id, artifact_type: root.artifact_type },
  });
  const issuer: LuExecutionAuthorityIssuerArtifact = {
    ...bareIssuer,
    attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareIssuer, root, signing: rootSigning }),
  };

  await args.repository.put({ artifact_id: root.artifact_id, content_hash: root.content_hash, body: root });
  await args.repository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });

  await verifyLuExecutionAuthorityCeremony({
    issuerRef: { artifact_id: issuer.artifact_id, artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE },
    repository: args.repository,
    rootPublicPem: rootKeypair.publicPem,
    issuerPublicPem: issuerKeypair.publicPem,
    keyIds: args.keyIds,
  });

  return { root, issuer, rootKeypair, issuerKeypair };
}

export async function verifyLuExecutionAuthorityCeremony(args: {
  readonly issuerRef: { readonly artifact_id: string; readonly artifact_type: string };
  readonly repository: ArtifactRepositoryPort;
  readonly rootPublicPem: string;
  readonly issuerPublicPem: string;
  readonly keyIds: LuExecutionAuthorityCeremonyKeyIds;
}): Promise<LuExecutionAuthorityIssuerArtifact> {
  const rootVerification: VerificationKeyProvider = new LocalPemVerificationKeyProvider(
    args.keyIds.rootKeyId,
    args.rootPublicPem,
  );
  const issuerVerification: VerificationKeyProvider = new LocalPemVerificationKeyProvider(
    args.keyIds.issuerKeyId,
    args.issuerPublicPem,
  );
  return verifyLuExecutionAuthorityChain({
    issuerRef: args.issuerRef,
    repository: args.repository,
    rootVerification,
    issuerVerification,
  });
}
