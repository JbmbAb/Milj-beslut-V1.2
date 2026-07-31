import { HashDescriptor } from "../../types/HashDescriptor";
import {
  CanonicalRegistryReference,
  RegistryReferenceCanonicalizer,
} from "../canonicalization/RegistryReferenceCanonicalizer";
import { JsonCanonicalizer } from "../engines/SimpleCanonicalizer";
import { Sha256HashEngine } from "../engines/Sha256HashEngine";

export interface ReplayFingerprintPayload {
  readonly schema_version: "1";
  readonly execution_identity_hash: HashDescriptor;
  readonly execution_plan_hash: HashDescriptor;
  readonly dependency_graph_hash: HashDescriptor;
  readonly completed_steps: readonly string[];
  readonly output_references: readonly CanonicalRegistryReference[];
}

export interface ReplayFingerprintArtifact {
  readonly payload: ReplayFingerprintPayload;
  readonly fingerprint: HashDescriptor;
}

export class ReplayFingerprintFactory {
  static async create(payload: Omit<ReplayFingerprintPayload, "schema_version">): Promise<ReplayFingerprintArtifact> {
    const basePayload: ReplayFingerprintPayload = {
      schema_version: "1",
      ...payload,
    };

    const sortedPayload: ReplayFingerprintPayload = {
      ...basePayload,
      output_references: [...basePayload.output_references].sort(
        RegistryReferenceCanonicalizer.compare,
      ),
    };

    const canonicalizer = new JsonCanonicalizer();
    const canonicalJson = canonicalizer.serialize(sortedPayload);
    
    const hasher = new Sha256HashEngine();
    const fingerprint = await hasher.hash(canonicalJson, "sha256-v1");

    return { payload: sortedPayload, fingerprint };
  }
}
