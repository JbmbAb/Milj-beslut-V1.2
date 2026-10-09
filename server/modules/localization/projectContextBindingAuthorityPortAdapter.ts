import type { ProjectContextBindingAuthorityPort } from "@miljobeslut/mps-lu";
import {
  verifyProjectContextBindingArtifactAuthority,
  verifyProjectContextBindingSupersessionAuthority,
} from "./projectContextBindingAuthority";

/**
 * Wires the existing product issuer/signature verifiers into the package authority port.
 * No new trust root — same verification functions as before extraction.
 */
export function createProjectContextBindingAuthorityPort(): ProjectContextBindingAuthorityPort {
  return {
    verifyArtifactAuthority: (args) => verifyProjectContextBindingArtifactAuthority(args),
    verifySupersessionAuthority: (args) => verifyProjectContextBindingSupersessionAuthority(args),
  };
}
