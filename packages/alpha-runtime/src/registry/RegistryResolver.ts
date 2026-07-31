import {
  RegistryReference,
  ProvenanceGraph,
  HashDescriptor,
  SignatureDescriptor
} from "../types";
import { RegistryStore, RegistryEntry } from "./RegistryStore";
import { TrustPolicy } from "./TrustPolicy";
import { LineageVerifier } from "./LineageVerifier";

export interface ResolverCache<T = unknown> {
  get(reference: RegistryReference): TrustResolutionResult<T> | null;
  set(reference: RegistryReference, result: TrustResolutionResult<T>): void;
}

export interface RegistryResolverOptions<T = unknown> {
  policy: TrustPolicy;
  cache?: ResolverCache<T>;
}

export interface TrustResolutionResult<T = unknown> {
  payload: T;
  reference: RegistryReference;
  provenance?: ProvenanceGraph;
  trust: {
    hash: boolean;
    signature: boolean;
    schema: boolean;
    provenance: boolean;
    policy: boolean;
    lineage: boolean;
  };
  verification_id: string;
  resolved_at: string;
  registry_version: string;
  errors: string[];
}

export class RegistryResolver<T = unknown> {
  constructor(
    private store: RegistryStore,
    private lineageVerifier: LineageVerifier,
    private opts: RegistryResolverOptions<T>
  ) {}

  async resolve(reference: RegistryReference): Promise<TrustResolutionResult<T>> {
    const cached = this.opts.cache?.get(reference);
    if (cached) return cached;

    const errors: string[] = [];
    const entry = await this.store.get(reference);

    if (!entry) {
      errors.push("registry_entry_not_found");
      return {
        payload: undefined as unknown as T,
        reference,
        provenance: undefined,
        trust: {
          hash: false,
          signature: false,
          schema: false,
          provenance: false,
          policy: false,
          lineage: false
        },
        verification_id: "",
        resolved_at: new Date().toISOString(),
        registry_version: "unknown",
        errors
      };
    }

    const hashValid =
      entry.reference.content_hash.digest === reference.content_hash.digest &&
      entry.reference.content_hash.algorithm === reference.content_hash.algorithm;
    if (!hashValid) errors.push("content_hash_mismatch");

    let signatureValid = true;
    if (entry.signature) {
      const status = await this.verifySignature(entry.signature, entry.reference.content_hash);
      signatureValid = status === "valid";
      if (!signatureValid) errors.push("signature_invalid");
    } else if (this.opts.policy.requireSignature) {
      signatureValid = false;
      errors.push("signature_missing");
    }

    const schemaValid = await this.verifySchema(entry);
    if (!schemaValid && this.opts.policy.requireSchemaValidation) {
      errors.push("schema_invalid");
    }

    const provenanceValid = !!entry.provenance;
    if (!provenanceValid && this.opts.policy.requireProvenance) {
      errors.push("provenance_missing");
    }

    const lineageResult = entry.provenance
      ? await this.lineageVerifier.verify(entry.provenance)
      : { valid: false, errors: ["no_provenance_for_lineage"] };

    const policyValid = this.verifyPolicy(entry);
    if (!policyValid) errors.push("policy_violation");

    const result: TrustResolutionResult<T> = {
      payload: entry.content as T,
      reference: entry.reference,
      provenance: entry.provenance,
      trust: {
        hash: hashValid,
        signature: signatureValid,
        schema: schemaValid,
        provenance: provenanceValid,
        policy: policyValid,
        lineage: lineageResult.valid
      },
      verification_id: `trust-${entry.reference.id}-${entry.reference.version}`,
      resolved_at: new Date().toISOString(),
      registry_version: "registry-v2",
      errors: [...errors, ...lineageResult.errors]
    };

    this.opts.cache?.set(reference, result);
    return result;
  }

  private async verifySignature(signature: SignatureDescriptor, hash: HashDescriptor): Promise<"valid" | "invalid"> {
    // placeholder: integrate real signature verification
    return "valid";
  }

  private async verifySchema(entry: RegistryEntry): Promise<boolean> {
    // placeholder: integrate real schema validation
    return true;
  }

  private verifyPolicy(entry: RegistryEntry): boolean {
    const op = entry.provenance?.root?.operation;
    if (!op) return false;
    return this.opts.policy.allowedOperations.includes(op);
  }
}
