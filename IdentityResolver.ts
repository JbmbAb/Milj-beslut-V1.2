import { RegistryReference, HashDescriptor } from '../types';
import { ExecutionManifest } from './ExecutionManifest';
import { CanonicalIdentityEnvelope } from './CanonicalIdentityEnvelope';
import { Canonicalizer } from '../canonical/RFC8785Canonicalizer';
import { CanonicalizationProfile } from '../canonical/CanonicalizationProfile';
import { HashEngine } from '../crypto/HashEngine';
import { InputHashCalculator } from './InputHashCalculator';

export interface IdentityResolver {
  resolve(
    manifest: ExecutionManifest,
    resolvedInputs: Record<string, unknown>,
    dependencyArtifacts: RegistryReference[],
    worldStateRef: RegistryReference,
    envelopeSchemaRef: RegistryReference, // Reference to the schema of CanonicalIdentityEnvelope
  ): Promise<{ envelope: CanonicalIdentityEnvelope; inputHash: HashDescriptor }>;
}

export class DefaultIdentityResolver implements IdentityResolver {
  private inputHashCalculator: InputHashCalculator;

  constructor(
    private canonicalizer: Canonicalizer,
    private canonicalizationProfile: CanonicalizationProfile,
    private hashEngine: HashEngine,
  ) {
    this.inputHashCalculator = new DefaultInputHashCalculator(
      canonicalizer,
      canonicalizationProfile,
      hashEngine,
    );
  }

  async resolve(
    manifest: ExecutionManifest,
    resolvedInputs: Record<string, unknown>,
    dependencyArtifacts: RegistryReference[],
    worldStateRef: RegistryReference,
    envelopeSchemaRef: RegistryReference,
  ): Promise<{ envelope: CanonicalIdentityEnvelope; inputHash: HashDescriptor }> {
    const envelope: CanonicalIdentityEnvelope = {
      envelope_schema_ref: envelopeSchemaRef,
      identity_schema_ref: manifest.identity_schema_ref,
      execution_manifest_ref: manifest.identity.schema_ref, // Reference to the manifest's own schema
      resolved_inputs: resolvedInputs,
      dependency_artifact_ids: dependencyArtifacts,
      world_state_reference: worldStateRef,
      planner_context: manifest.planning_context,
      policy_context: {}, // Placeholder for actual policy context
      feature_flags: manifest.feature_flags,
      execution_semantics: 'default', // This should come from CapabilityDefinition
      input_hash: { algorithm: '', digest: '', bit_length: 0 }, // Will be filled after calculation
    };

    const inputHash = await this.inputHashCalculator.calculate(envelope);
    envelope.input_hash = inputHash;

    return { envelope, inputHash };
  }
}
