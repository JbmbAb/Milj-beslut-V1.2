import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type { ProductReleaseManifestArtifact } from "../../../packages/mps-governance/src/release/ProductReleaseAuthority.js";
import { getProductReleaseIssuerVerifier } from "../../security/productReleaseIssuerKey.js";
import { verifyProductRelease } from "./productReleaseAuthority.js";

export const PRODUCT_RELEASE_ARTIFACT_ID_ENV = "PRODUCT_RELEASE_ARTIFACT_ID" as const;

export async function resolveCanonicalProductRelease(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<ProductReleaseManifestArtifact> {
  const env = args.env ?? process.env;
  const artifactId = env[PRODUCT_RELEASE_ARTIFACT_ID_ENV]?.trim();
  if (!artifactId) throw new Error("REJECT_PRODUCT_RELEASE_RUNTIME_CONFIGURATION: PRODUCT_RELEASE_ARTIFACT_ID is required");
  let release: ProductReleaseManifestArtifact;
  try {
    release = await args.artifactRepository.resolve<ProductReleaseManifestArtifact>({ artifact_id: artifactId, artifact_type: "product_release_manifest" });
  } catch {
    throw new Error("REJECT_PRODUCT_RELEASE_RUNTIME_UNAVAILABLE");
  }
  await verifyProductRelease({ release, artifactRepository: args.artifactRepository, verification: getProductReleaseIssuerVerifier(env) });
  return release;
}
