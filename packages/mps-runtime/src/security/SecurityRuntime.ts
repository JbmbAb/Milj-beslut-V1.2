/**
 * Security Runtime — Epoch II §2.9.
 *
 * Sole platform surface for execution-path trust:
 * bindPrincipal → admit → authorizeInvoke → (CapabilityRuntime) → attestOutcome
 */

import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type {
  FrozenAdmissionResult,
  FrozenExecutionManifestIdentity,
} from "../contracts/freeze/FrozenIdentities.js";
import type { AdmissionPolicy } from "../contracts/model/ExecutionPolicies.js";
import { DEFAULT_ADMISSION_POLICY } from "../contracts/model/ExecutionPolicies.js";
import {
  sha256ContentHash,
  type AdmissionPort,
  type CapabilityExecutorPort,
} from "../kernel/ExecutionKernel.js";
import { FrozenAdmissionAdapter } from "../kernel/FrozenAdmissionAdapter.js";
import type { FrozenCoreVerificationContext } from "../../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js";
import type { RuntimeState } from "../kernel/RuntimeState.js";
import type {
  AuthorizeDecision,
  CapabilityGrant,
  OutcomeAttestation,
  SecurityContext,
  SigningKeyProvider,
} from "./SecurityContracts.js";
import { SECURITY_RUNTIME_VERSION } from "./SecurityContracts.js";
import { createHmacSigningKeyProvider } from "./HmacSigningKeyProvider.js";

export type SecurityRuntimeOptions = {
  readonly admissionPolicy?: AdmissionPolicy;
  readonly grants?: readonly CapabilityGrant[];
  readonly signer?: SigningKeyProvider;
  /**
   * When true, missing FrozenCore verification context may still admit
   * (composition-root / tests). Principal + authorize remain mandatory.
   * Production SHOULD leave this false.
   */
  readonly bootstrapAdmit?: boolean;
  /** Deterministic seed for context binding (not wall-clock). */
  readonly bindSeed?: string;
  /**
   * PROD-LU-ADMISSION-01A — real FrozenCore verification context, when the composition root
   * has one. SecurityRuntime does not construct this itself and stays domain-agnostic; a
   * caller (e.g. the LU kernel client) builds it from its own canonical artifacts. Omitted or
   * null preserves prior behavior exactly (bootstrapAdmit governs the no-context path).
   */
  readonly verificationContext?: FrozenCoreVerificationContext | null;
};

/**
 * Execution Platform security facade — fail-closed by default.
 */
export class SecurityRuntime {
  private readonly admissionPolicy: AdmissionPolicy;
  private readonly grants: ReadonlySet<string>;
  private readonly signer: SigningKeyProvider;
  private readonly bootstrapAdmit: boolean;
  private readonly bindSeed: string;
  private readonly underlyingAdmit: AdmissionPort;
  private context: SecurityContext | null = null;

  private constructor(options: SecurityRuntimeOptions) {
    this.admissionPolicy = options.admissionPolicy ?? DEFAULT_ADMISSION_POLICY;
    this.grants = new Set(
      (options.grants ?? []).map(
        (g) => `${g.principal_id}::${g.capability_id}`,
      ),
    );
    this.signer =
      options.signer ??
      createHmacSigningKeyProvider(
        "mps-execution-platform-default-dev-secret",
        "hmac-execution-dev-v1",
      );
    this.bootstrapAdmit = options.bootstrapAdmit ?? false;
    this.bindSeed = options.bindSeed ?? "security.bind.v1";
    // bootstrapAdmit is explicit opt-in when FrozenCore verification context is absent.
    this.underlyingAdmit = new FrozenAdmissionAdapter(
      options.verificationContext ?? null,
      this.bootstrapAdmit,
    );
  }

  static create(options: SecurityRuntimeOptions = {}): SecurityRuntime {
    const policy = options.admissionPolicy ?? DEFAULT_ADMISSION_POLICY;
    if (policy.allow_bypass === true && !options.bootstrapAdmit) {
      throw new Error(
        "SecurityRuntime: AdmissionPolicy.allow_bypass must be false unless bootstrapAdmit is set",
      );
    }
    return new SecurityRuntime(options);
  }

  get version(): typeof SECURITY_RUNTIME_VERSION {
    return SECURITY_RUNTIME_VERSION;
  }

  bindPrincipal(
    principal_id: string,
    actor_ref: ArtifactReference | null = null,
  ): SecurityContext {
    if (!principal_id || principal_id.trim().length === 0) {
      throw new Error("SecurityRuntime: principal_id is required");
    }
    const ctx: SecurityContext = Object.freeze({
      principal: Object.freeze({
        principal_id,
        actor_ref,
      }),
      bound_at_seed: this.bindSeed,
    });
    this.context = ctx;
    return ctx;
  }

  getContext(): SecurityContext | null {
    return this.context;
  }

  authorizeInvoke(capability_id: string): AuthorizeDecision {
    if (!this.context) {
      return {
        decision: "deny",
        reason_codes: ["NO_PRINCIPAL_BOUND"],
      };
    }
    if (!capability_id) {
      return {
        decision: "deny",
        reason_codes: ["MISSING_CAPABILITY_ID"],
      };
    }
    const key = `${this.context.principal.principal_id}::${capability_id}`;
    if (!this.grants.has(key)) {
      return {
        decision: "deny",
        reason_codes: ["CAPABILITY_NOT_GRANTED"],
      };
    }
    return {
      decision: "allow",
      reason_codes: ["GRANT_MATCH"],
    };
  }

  async admit(
    manifest: FrozenExecutionManifestIdentity,
    state: RuntimeState,
  ): Promise<FrozenAdmissionResult> {
    const manifestRef = {
      artifact_id: manifest.manifest_id,
      artifact_type: "execution_manifest" as const,
    };

    if (!this.context) {
      return {
        decision: "denied",
        reason_codes: ["NO_PRINCIPAL_BOUND"],
        manifest_ref: manifestRef,
        attempt_ref: null,
        verified_rule_ids: [],
      };
    }

    if (this.admissionPolicy.allow_bypass === true && !this.bootstrapAdmit) {
      return {
        decision: "denied",
        reason_codes: ["ADMISSION_BYPASS_FORBIDDEN"],
        manifest_ref: manifestRef,
        attempt_ref: null,
        verified_rule_ids: [],
      };
    }

    const capabilityId = manifest.capability_resolution_ref.artifact_id;
    const auth = this.authorizeInvoke(capabilityId);
    if (auth.decision === "deny") {
      return {
        decision: "denied",
        reason_codes: [...auth.reason_codes],
        manifest_ref: manifestRef,
        attempt_ref: null,
        verified_rule_ids: [],
      };
    }

    const result = await this.underlyingAdmit.admit(manifest, state);
    if (result.decision !== "admitted") {
      return result;
    }

    return {
      ...result,
      reason_codes: [
        ...result.reason_codes,
        "SECURITY_ADMIT",
        `PRINCIPAL:${this.context.principal.principal_id}`,
      ],
    };
  }

  /** AdmissionPort for ExecutionKernel. */
  asAdmissionPort(): AdmissionPort {
    return {
      admit: (manifest, state) => this.admit(manifest, state),
    };
  }

  /**
   * Wraps CapabilityExecutorPort with authorize-before-invoke.
   */
  asAuthorizedExecutorPort(
    inner: CapabilityExecutorPort,
  ): CapabilityExecutorPort {
    return {
      execute: async (args) => {
        const auth = this.authorizeInvoke(args.capability_ref.artifact_id);
        if (auth.decision === "deny") {
          throw new Error(
            `Capability invoke denied: ${auth.reason_codes.join(",")}`,
          );
        }
        return inner.execute(args);
      },
    };
  }

  attestOutcome(outcome_hash: ContentHash): OutcomeAttestation {
    if (!this.context) {
      throw new Error("SecurityRuntime: cannot attest without bound principal");
    }
    if (!outcome_hash?.value) {
      throw new Error("SecurityRuntime: outcome_hash is required");
    }

    const payload = `${this.context.principal.principal_id}:${outcome_hash.algorithm}:${outcome_hash.value}`;
    const signature = this.signer.sign(payload);
    const body = {
      artifact_type: "outcome_attestation" as const,
      principal_id: this.context.principal.principal_id,
      outcome_hash,
      key_id: this.signer.key_id,
      signature,
    };
    const content_hash = sha256ContentHash(body);
    return Object.freeze({
      ...body,
      attestation_id: `attest-${content_hash.value.slice(0, 16)}`,
      content_hash,
    });
  }

  verifyAttestation(attestation: OutcomeAttestation): boolean {
    const payload = `${attestation.principal_id}:${attestation.outcome_hash.algorithm}:${attestation.outcome_hash.value}`;
    return this.signer.verify(payload, attestation.signature);
  }
}
