/**
 * Owner-only installation command for an already-issued ProductViewerCapabilityArtifact (V2).
 *
 * Usage:
 *   MIMERS_ROOT=/secure/mimers npx tsx scripts/ops/install-lu-viewer-capability.ts \
 *     --in /secure/issued/viewer-capability.json --execute
 *
 * This command never accepts signing keys and never creates a capability. It only verifies the
 * full cryptographic issuer-trust chain and persists the supplied owner-issued artifact, then
 * prints the runtime references needed by createLocalizationViewerRuntime().
 */
import { readFile } from "node:fs/promises";

import { MimersIntegration } from "@miljobeslut/mps-runtime";
import type { ProductViewerCapabilityArtifact } from "@miljobeslut/mps-lu";
import { installOwnerIssuedLocalizationViewerCapability } from "../../server/modules/localization/installLocalizationViewerCapability.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  throw new Error(`VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1: ${message}`);
}

async function main(): Promise<void> {
  if (!process.argv.includes("--execute")) {
    fail("refusing to write without --execute");
  }
  const inputPath = option("in");
  if (!inputPath) fail("--in <owner-issued-viewer-capability.json> is required");
  if (!process.env.MIMERS_ROOT?.trim()) {
    fail("MIMERS_ROOT is required; refusing an implicit local CAS target");
  }

  const raw = await readFile(inputPath, "utf8");
  let capability: ProductViewerCapabilityArtifact;
  try {
    capability = JSON.parse(raw) as ProductViewerCapabilityArtifact;
  } catch {
    fail("input is not valid JSON");
  }
  if (!capability.payload?.product_release_hash) fail("input has no payload.product_release_hash");

  const env = { ...process.env, MIMERS_REQUIRED: "1" } as NodeJS.ProcessEnv;
  const mimers = await MimersIntegration.create({ env, forceMimers: true });
  const result = await installOwnerIssuedLocalizationViewerCapability({
    artifactRepository: mimers.artifactRepository,
    capability,
  });

  console.log(
    JSON.stringify(
      {
        installed: true,
        artifact_id: result.artifactId,
        release_hash: result.releaseHash,
        runtime_environment: {
          LU_VIEWER_CAPABILITY_ARTIFACT_ID: result.runtimeConfig.capabilityArtifactId,
          LU_VIEWER_PROJECT_ID: result.runtimeConfig.expectedProjectId,
          LU_VIEWER_CONTEXT_BINDING_ID: result.runtimeConfig.expectedContextBindingId,
          LU_VIEWER_IDENTITY_ID: result.runtimeConfig.expectedViewerIdentityId,
          LU_VIEWER_RELEASE_ID: result.runtimeConfig.expectedReleaseId,
          LU_VIEWER_RELEASE_HASH: result.runtimeConfig.expectedReleaseHash,
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
