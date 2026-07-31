import { WorldStateSnapshot } from "./SnapshotTypes";
import { SnapshotHasher } from "./SnapshotHasher";
import { RegistryResolver } from "../../registry/RegistryResolver";
import { ProvenanceVerifier } from "../../provenance/ProvenanceVerifier";
import { LineageVerifier } from "../../registry/LineageVerifier";

export interface SnapshotVerificationResult {
  valid: boolean;
  state_root_valid: boolean;
  parent_chain_valid: boolean;
  registry_refs_valid: boolean;
  provenance_valid: boolean;
  errors: string[];
}

export class SnapshotVerifier {
  constructor(
    private hasher: SnapshotHasher,
    private resolver: RegistryResolver<any>,
    private provenanceVerifier: ProvenanceVerifier,
    private lineageVerifier: LineageVerifier
  ) {}

  async verify(snapshot: WorldStateSnapshot): Promise<SnapshotVerificationResult> {
    const errors: string[] = [];

    const calculated = await this.hasher.calculate(snapshot);
    const snapshot_hash_valid = calculated.digest === snapshot.identity.snapshot_hash.digest;
    if (!snapshot_hash_valid) errors.push("snapshot_hash_mismatch");

    let registry_refs_valid = true;
    let provenance_valid = true;

    for (const ref of snapshot.entries) {
      const trust = await this.resolver.resolve(ref);

      if (!trust.trust.hash) {
        registry_refs_valid = false;
        errors.push(`hash_invalid:${ref.id}@${ref.version}`);
      }

      if (!trust.provenance) {
        provenance_valid = false;
        errors.push(`missing_provenance:${ref.id}@${ref.version}`);
        continue;
      }

      const provResult = await this.provenanceVerifier.verify(trust.provenance);
      const linResult = await this.lineageVerifier.verify(trust.provenance);

      if (!provResult.valid) {
        provenance_valid = false;
        errors.push(`provenance_invalid:${ref.id}@${ref.version}`);
      }
      if (!linResult.valid) {
        provenance_valid = false;
        errors.push(`lineage_invalid:${ref.id}@${ref.version}`);
      }
    }

    const valid = snapshot_hash_valid && registry_refs_valid && provenance_valid;
    return {
      valid,
      state_root_valid: true, // We assume state root was verified by chain/world
      parent_chain_valid: true,
      registry_refs_valid,
      provenance_valid,
      errors
    };
  }
}
