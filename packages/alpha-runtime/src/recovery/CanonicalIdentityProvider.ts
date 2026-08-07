import { CanonicalizerRegistry, CanonicalizerId } from './CanonicalizerRegistry';

/**
 * Identity for runtime *projections* — execution outputs, replay references and
 * UI representations.
 *
 * MAT-I05: this provider does not mint Decision Authority. DecisionImpactArtifact
 * identity is produced only by mps-materialization through the decision-governance
 * identity provider.
 *
 * MAT-I02 still applies inside the runtime: callers request identity here rather
 * than hashing on their own.
 */
export class CanonicalIdentityProvider {
  /**
   * Generates the identity for a runtime projection.
   * MAT-I04: extraction_model MUST NOT participate in the hash.
   */
  static generateProjectionIdentity(
    canonicalizerId: CanonicalizerId,
    evidenceRefs: any[],
    facts: any,
    ruleVersion: string,
    materializationVersion: string,
    provenance: { extraction_model?: string } // explicitly segregated provenance
  ): string {
    
    // Identity payload strictly excludes provenance like extraction_model
    const identityPayload = {
      evidenceRefs,
      facts,
      ruleVersion,
      materializationVersion
    };

    return CanonicalizerRegistry.generateIdentityHash(canonicalizerId, identityPayload);
  }
}
