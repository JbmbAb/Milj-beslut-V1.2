import type { AuthUser } from "./types";
import { resolveCanonicalHumanIdentityForAuthUser } from "./canonicalAuthorityIdentity";
import {
  contentReferenceFromHumanIdentity,
  verifyCanonicalHumanIdentityArtifact,
  type AuthenticatedPrincipalPort,
  type GovernanceReviewerIdentityAuthorityPort,
} from "../../packages/mps-data-governance/src/GovernanceReviewerIdentityAuthority";
import {
  composeDatasetApprovalAuthorityFromEnv,
} from "../../packages/mps-data-governance/src/DatasetApprovalAuthorityBindings";
import type { HarvestManifestAuthorityPort } from "../../packages/mps-data-governance/src/DatasetApprovalAuthority";

export class DatasetApprovalAuthenticatedPrincipalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetApprovalAuthenticatedPrincipalError";
  }
}

export interface DatasetApprovalRequestIdentityBindings {
  readonly authenticatedPrincipal: AuthenticatedPrincipalPort;
  readonly identityAuthority: GovernanceReviewerIdentityAuthorityPort;
}

/** The only request capability this composition boundary consumes after requireAuth. */
export interface AuthenticatedRequestContext {
  readonly authUser?: AuthUser;
}

/**
 * Creates the DatasetApproval identity ports for one already-authenticated request.
 * No identity is stored globally: both ports close over this request's AuthUser only.
 */
export function createDatasetApprovalRequestIdentityBindings(
  request: AuthenticatedRequestContext,
): DatasetApprovalRequestIdentityBindings {
  const authUser = request.authUser;
  if (!authUser) {
    throw new DatasetApprovalAuthenticatedPrincipalError(
      "REJECT_DATASET_APPROVAL_MISSING_AUTHENTICATED_PRINCIPAL",
    );
  }
  return createDatasetApprovalIdentityBindingsForAuthUser(authUser);
}

/**
 * Production request/session binding. The canonical bridge re-reads the persisted User and
 * requires exact User.id and BankID-subject agreement before it derives a HumanIdentityArtifact.
 */
export function createDatasetApprovalIdentityBindingsForAuthUser(
  authUser: Pick<AuthUser, "id" | "bankidId">,
): DatasetApprovalRequestIdentityBindings {
  return {
    authenticatedPrincipal: {
      async currentIdentityRef() {
        return contentReferenceFromHumanIdentity(
          await resolveCanonicalHumanIdentityForAuthUser(authUser),
        );
      },
    },
    identityAuthority: {
      async resolveVerifiedHumanIdentity(ref) {
        // Independently reconstruct from the persisted authenticated principal, then require
        // the caller's pinned reference to name exactly that canonical human.
        const identity = await resolveCanonicalHumanIdentityForAuthUser(authUser);
        return verifyCanonicalHumanIdentityArtifact(identity, ref);
      },
    },
  };
}

/**
 * Minimum product composition boundary for a DatasetApproval operation. A route using this must
 * put `requireAuth` before calling it; this function neither accepts request payload identity
 * fields nor provides signer/trust/root overrides.
 */
export async function composeDatasetApprovalAuthorityForAuthenticatedRequest(input: {
  readonly request: AuthenticatedRequestContext;
  readonly manifests: HarvestManifestAuthorityPort;
  readonly env?: NodeJS.ProcessEnv;
}) {
  const bindings = createDatasetApprovalRequestIdentityBindings(input.request);
  return composeDatasetApprovalAuthorityFromEnv({
    env: input.env,
    manifests: input.manifests,
    authenticatedPrincipal: bindings.authenticatedPrincipal,
    identityAuthority: bindings.identityAuthority,
  });
}
