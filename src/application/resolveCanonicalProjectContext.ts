/**
 * PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1.
 *
 * Product-facing wrapper around the reusable package canonical reader.
 * ONE semantic implementation lives in @miljobeslut/mps-lu CanonicalProjectContextReader.
 *
 * Fails closed if no unambiguous, verified binding exists for the project — never fabricates.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  CanonicalProjectContextReader,
  type CanonicalProjectContext,
  type CanonicalProjectGeometry,
} from "@miljobeslut/mps-lu";
import { PrismaProjectContextBindingIndex } from "../../server/repositories/projectContextBindingRepository";
import { createProjectContextBindingAuthorityPort } from "../../server/modules/localization/projectContextBindingAuthorityPortAdapter";
import { asProjectContextBindingIndexPort } from "../../server/modules/localization/projectContextBindingIndexPortAdapter";
import { getProjectContextBindingIssuerVerifier } from "../../server/security/projectContextBindingIssuerKey";

export type { CanonicalProjectContext, CanonicalProjectGeometry };

/**
 * Resolves and fully cryptographically verifies the canonical project/property context bound to
 * `projectId`. Composition root only — semantic authority checks live in the package reader.
 */
export async function resolveCanonicalProjectContext(
  projectId: string,
  repo: ArtifactRepositoryPort,
  index: PrismaProjectContextBindingIndex = new PrismaProjectContextBindingIndex(),
): Promise<CanonicalProjectContext> {
  const reader = new CanonicalProjectContextReader({
    artifactRepository: repo,
    bindingIndex: asProjectContextBindingIndexPort(index),
    authority: createProjectContextBindingAuthorityPort(),
    verification: getProjectContextBindingIssuerVerifier(),
  });
  return reader.resolve(projectId);
}
