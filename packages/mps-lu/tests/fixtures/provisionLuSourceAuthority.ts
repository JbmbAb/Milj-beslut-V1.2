import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../../mps-compliance/src/artifacts/ArtifactReference';
import type { ArtifactRepositoryPort } from '../../../mps-runtime/src/kernel/ExecutionKernel';
import type { ExecutionIdentitySubjectV3 } from '../../../mps-runtime/src/execution/ExecutionIdentityScopeV2';
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
} from '../../src/artifacts/LuExecutionAuthorityArtifact';
import {
  attestLuExecutionAuthorityIssuer,
  attestLuExecutionAuthorityRoot,
} from '../../src/execution/LuExecutionAuthorityChain';
import { issueExecutionIdentityV3 } from '../../src/execution/LuExecutionIdentityIssuer';
import { __resetLuExecutionAuthorityVerifierForTests } from '../../src/execution/LuExecutionAuthorityVerifier';
import { LU_EXECUTION_PRINCIPAL_ID } from '../../src/execution/LuExecutionPrincipal';
import {
  attestLuExecutionAuthorityLifecycle,
  createLuExecutionAuthorityLifecycleArtifact,
} from '../../src/governance/LuExecutionAuthorityLifecycle';
import {
  attestLuSourceAuthorityTemporalStatus,
  createLuSourceAuthorityTemporalStatusArtifact,
} from '../../src/governance/LuSourceAuthorityTemporalStatus';
import { deriveLuCanonicalAssessmentAttemptRef } from '../../src/governance/LuSourceAuthorityWiring';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../../../server/security/luExecutionAuthoritySigningKey';

const ENV_NAMES = [
  'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID',
  'LU_EXECUTION_AUTHORITY_ROOT_KEY_ID',
  'LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_LIFECYCLE_ID',
] as const;

function ref(artifact: { readonly artifact_id: string; readonly artifact_type: string }): ArtifactReference {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
}

export async function provisionLuSourceAuthorityFixture(input: {
  readonly repository: ArtifactRepositoryPort;
  readonly subject: ExecutionIdentitySubjectV3;
  readonly deterministic_seed: string;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly governed_references: readonly ArtifactReference[];
  readonly label: string;
}) {
  const previous = new Map<string, string | undefined>(ENV_NAMES.map((name) => [name, process.env[name]]));
  const rootKey = LocalPemSigningKeyProvider.generate(`ed25519:lu-root-${input.label}`);
  const issuerKey = LocalPemSigningKeyProvider.generate(`ed25519:lu-issuer-${input.label}`);

  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootKey.publicKey;
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = issuerKey.provider.keyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = issuerKey.publicKey;
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = issuerKey.privateKey;
  __resetLuExecutionAuthoritySigningProviderForTests(null);
  __resetLuExecutionAuthorityVerifierForTests(null);

  const bareRoot = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKey.provider.keyId,
    public_key_fingerprint: `fixture-root-${input.label}`,
  });
  const root = {
    ...bareRoot,
    attestation: await attestLuExecutionAuthorityRoot({
      root: bareRoot,
      signing: rootKey.provider,
    }),
  };
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKey.provider.keyId,
    public_key_fingerprint: `fixture-issuer-${input.label}`,
    root_ref: ref(root),
  });
  const issuer = {
    ...bareIssuer,
    attestation: await attestLuExecutionAuthorityIssuer({
      issuer: bareIssuer,
      root,
      signing: rootKey.provider,
    }),
  };
  const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({
    root,
    issuer,
    valid_from: '2020-01-01T00:00:00.000Z',
    valid_until: '2035-01-01T00:00:00.000Z',
  });
  const lifecycle = {
    ...bareLifecycle,
    attestation: await attestLuExecutionAuthorityLifecycle({
      lifecycle: bareLifecycle,
      root,
      signing: rootKey.provider,
    }),
  };

  for (const artifact of [root, issuer, lifecycle]) {
    await input.repository.put({
      artifact_id: artifact.artifact_id,
      content_hash: artifact.content_hash,
      body: artifact,
    });
  }
  process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID = lifecycle.artifact_id;

  const identity = await issueExecutionIdentityV3({
    subject: input.subject,
    deterministic_seed: input.deterministic_seed,
    actor_ref: {
      artifact_id: LU_EXECUTION_PRINCIPAL_ID,
      artifact_type: 'execution_identity',
    },
    capability_ref: input.capability_ref,
    release_snapshot_id: input.release_snapshot_id,
    issuer_ref: {
      artifact_id: issuer.artifact_id,
      artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
    },
    governed_references: input.governed_references,
    artifact_repository: input.repository,
  });

  const attemptRef = deriveLuCanonicalAssessmentAttemptRef(input.subject);
  const bareStatus = createLuSourceAuthorityTemporalStatusArtifact({
    issuer_ref: ref(issuer),
    subject: identity,
    attempt_ref: attemptRef,
    lifecycle,
    action: 'lu.localization_assessment.persist',
    decision_time: '2026-10-07T08:00:00.000Z',
  });
  const status = {
    ...bareStatus,
    attestation: await attestLuSourceAuthorityTemporalStatus({
      status: bareStatus,
      signing: issuerKey.provider,
    }),
  };
  await input.repository.put({
    artifact_id: status.artifact_id,
    content_hash: status.content_hash,
    body: status,
  });

  return {
    root,
    issuer,
    lifecycle,
    identity,
    status,
    restore() {
      for (const name of ENV_NAMES) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      __resetLuExecutionAuthoritySigningProviderForTests(null);
      __resetLuExecutionAuthorityVerifierForTests(null);
    },
  };
}
