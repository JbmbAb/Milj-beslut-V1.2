import { createHash } from "node:crypto";
import { MimersIntegration } from "@miljobeslut/mps-runtime";
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import {
  LU_EXECUTION_AUTHORITY_LIFECYCLE_ID_ENV,
  LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
  attestLuExecutionAuthorityLifecycle,
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityLifecycleArtifact,
  createLuExecutionAuthorityRootArtifact,
  verifyLuExecutionAuthorityChain,
  verifyLuExecutionAuthorityLifecycle,
  type LuExecutionAuthorityLifecycleArtifact,
  type LuExecutionAuthorityRootArtifact,
} from "@miljobeslut/mps-lu";

const ROOT_PRIVATE_ENV = "LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM";
const VALID_FROM_ENV = "LU_EXECUTION_AUTHORITY_LIFECYCLE_VALID_FROM";
const VALID_UNTIL_ENV = "LU_EXECUTION_AUTHORITY_LIFECYCLE_VALID_UNTIL";
const REVOKED_AT_ENV = "LU_EXECUTION_AUTHORITY_LIFECYCLE_REVOKED_AT";
const PREVIOUS_ID_ENV = "LU_EXECUTION_AUTHORITY_PREVIOUS_LIFECYCLE_ID";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`LU_AUTHORITY_LIFECYCLE_REJECTED: ${name} is required`);
  return value;
}

function optionalIso(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`LU_AUTHORITY_LIFECYCLE_REJECTED: ${name} must be ISO-8601`);
  }
  return new Date(parsed).toISOString();
}

function requiredIso(name: string): string {
  const value = required(name);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`LU_AUTHORITY_LIFECYCLE_REJECTED: ${name} must be ISO-8601`);
  }
  return new Date(parsed).toISOString();
}

function fingerprint(pem: string): string {
  return createHash("sha256").update(pem).digest("hex");
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const verify = process.argv.includes("--verify");
  if (execute === verify) {
    throw new Error("LU_AUTHORITY_LIFECYCLE_REJECTED: choose exactly one of --execute or --verify");
  }

  const mimersRoot = required("MIMERS_ROOT");
  const rootKeyId = required("LU_EXECUTION_AUTHORITY_ROOT_KEY_ID");
  const rootPublic = required("LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM");
  const issuerKeyId = required("LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID");
  const issuerPublic = required("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM");
  const rootVerification = new LocalPemVerificationKeyProvider(rootKeyId, rootPublic);
  const issuerVerification = new LocalPemVerificationKeyProvider(issuerKeyId, issuerPublic);
  const mimers = await MimersIntegration.create({
    env: { ...process.env, MIMERS_ROOT: mimersRoot, MIMERS_REQUIRED: "1" },
    forceMimers: true,
  });

  const bareRoot = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKeyId,
    public_key_fingerprint: fingerprint(rootPublic),
  });
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKeyId,
    public_key_fingerprint: fingerprint(issuerPublic),
    root_ref: { artifact_id: bareRoot.artifact_id, artifact_type: bareRoot.artifact_type },
  });
  const issuer = await verifyLuExecutionAuthorityChain({
    issuerRef: { artifact_id: bareIssuer.artifact_id, artifact_type: bareIssuer.artifact_type },
    repository: mimers.artifactRepository,
    rootVerification,
    issuerVerification,
  });
  const root = await mimers.artifactRepository.resolve<LuExecutionAuthorityRootArtifact>(
    issuer.payload.root_ref,
  );

  if (verify) {
    if (process.env[ROOT_PRIVATE_ENV] || process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM) {
      throw new Error("LU_AUTHORITY_LIFECYCLE_REJECTED: private key available during verification");
    }
    const lifecycleId = required(LU_EXECUTION_AUTHORITY_LIFECYCLE_ID_ENV);
    const lifecycle = await mimers.artifactRepository.resolve<LuExecutionAuthorityLifecycleArtifact>({
      artifact_id: lifecycleId,
      artifact_type: LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
    });
    await verifyLuExecutionAuthorityLifecycle({
      lifecycle,
      root,
      issuer,
      root_verification: rootVerification,
    });
    console.log(JSON.stringify({
      verified: true,
      lifecycle_artifact_id: lifecycle.artifact_id,
      issuer_artifact_id: issuer.artifact_id,
      valid_from: lifecycle.payload.valid_from,
      valid_until: lifecycle.payload.valid_until,
      revoked_at: lifecycle.payload.revoked_at,
      previous_lifecycle_ref: lifecycle.payload.previous_lifecycle_ref ?? null,
      private_key_available: false,
    }, null, 2));
    return;
  }

  const rootPrivate = required(ROOT_PRIVATE_ENV);
  const validFrom = requiredIso(VALID_FROM_ENV);
  const validUntil = requiredIso(VALID_UNTIL_ENV);
  const revokedAt = optionalIso(REVOKED_AT_ENV);
  const previousId = process.env[PREVIOUS_ID_ENV]?.trim();
  const previousRef = previousId
    ? { artifact_id: previousId, artifact_type: LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE }
    : undefined;
  if (previousRef) {
    const previous = await mimers.artifactRepository.resolve<LuExecutionAuthorityLifecycleArtifact>(
      previousRef,
    );
    await verifyLuExecutionAuthorityLifecycle({
      lifecycle: previous,
      root,
      issuer,
      root_verification: rootVerification,
    });
  }

  const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({
    root,
    issuer,
    valid_from: validFrom,
    valid_until: validUntil,
    revoked_at: revokedAt,
    previous_lifecycle_ref: previousRef,
  });
  const rootSigning = new LocalPemSigningKeyProvider(rootKeyId, rootPrivate, rootPublic);
  const lifecycle: LuExecutionAuthorityLifecycleArtifact = {
    ...bareLifecycle,
    attestation: await attestLuExecutionAuthorityLifecycle({
      lifecycle: bareLifecycle,
      root,
      signing: rootSigning,
    }),
  };
  await verifyLuExecutionAuthorityLifecycle({
    lifecycle,
    root,
    issuer,
    root_verification: rootVerification,
  });
  await mimers.artifactRepository.put({
    artifact_id: lifecycle.artifact_id,
    content_hash: lifecycle.content_hash,
    body: lifecycle,
  });

  console.log(JSON.stringify({
    created: true,
    lifecycle_artifact_id: lifecycle.artifact_id,
    export_env: `${LU_EXECUTION_AUTHORITY_LIFECYCLE_ID_ENV}=${lifecycle.artifact_id}`,
    issuer_artifact_id: issuer.artifact_id,
    valid_from: lifecycle.payload.valid_from,
    valid_until: lifecycle.payload.valid_until,
    revoked_at: lifecycle.payload.revoked_at,
    previous_lifecycle_ref: lifecycle.payload.previous_lifecycle_ref ?? null,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
