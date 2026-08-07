/**
 * ============================================================================
 * MPS-CORE — Types
 *
 * Canonical, deterministic, WORM-safe domain model.
 * ============================================================================
 */

export interface HashDescriptor {
  readonly algorithm: string;
  readonly digest: string;
  readonly length?: number;
  readonly encoding?: "hex" | "base64";
  readonly version?: string;
}

export interface SignatureDescriptor {
  readonly algorithm: string;
  readonly signature: string;
  readonly key_id?: string;
  readonly signature_version?: string;
  readonly public_key_hint?: string;
}

export interface SchemaReference {
  readonly schema_id: string;
  readonly schema_version: string;
}

export interface ContentReference {
  readonly id: string;
  readonly content_hash: HashDescriptor;
  readonly schema_ref?: SchemaReference;
}

/**
 * ISO 8601 UTC timestamp.
 *
 * A Timestamp is provenance: it describes when something was observed or
 * recorded, never what it is. Timestamps SHALL NOT participate in canonical
 * identity, hashing, signing, or replay equality (IMPORT-TIME-001, SV-I06).
 */
export type Timestamp = string;

export type ActorRole =
  | "EVOLUTION_AGENT"
  | "HUMAN_OPERATOR"
  | "SYSTEM_PROCESS"
  | "GOVERNANCE_REVIEWER";

/**
 * Who acted.
 *
 * The actor is named by a resolvable identity reference rather than a free
 * string, so that "who approved this" can be verified after the fact. An
 * opaque name in a signed approval is not attributable evidence.
 */
export interface ActorReference {
  readonly identity_ref: ContentReference;
  readonly role: ActorRole;
}

/**
 * A reference to a governed artifact.
 *
 * Binds three things at once, because dropping any one of them breaks a
 * barrier the platform depends on:
 *  - `artifact_id`  — which artifact,
 *  - `artifact_type` — of which kind, so a reference cannot be redirected at
 *    an artifact of another kind,
 *  - `content_hash` — with which content, so a reference pins what it pointed
 *    at and tampering is detectable on resolve.
 *
 * A `ContentReference` binds content but not kind; use this type whenever the
 * kind matters, which is everywhere an artifact is governed.
 */
export interface ArtifactReference {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly content_hash: HashDescriptor;
}

/**
 * Base shape of every governed artifact on the platform.
 *
 * `signature` is required. An unsigned artifact is not canonical: it carries
 * no authority and SHALL NOT be treated as one. Types that model an artifact
 * before it has been signed express that explicitly with `Omit`, rather than
 * by leaving the signature optional here.
 *
 * `artifact_type` is an open string. Core cannot own a closed registry of
 * every domain's artifact kinds without every package depending upward on it;
 * a domain narrows the field in its own extension instead.
 */
export interface CanonicalArtifact {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly content_hash: HashDescriptor;
  readonly signature: SignatureDescriptor;
}

/**
 * Full verification result — restored
 */
export interface VerificationResult {
  readonly integrity: boolean;
  readonly signature_valid: boolean;
  readonly trusted: boolean;

  readonly trust_anchor?: string;
  readonly verified_at?: string;
  readonly verification_algorithm?: string;
  readonly key_id?: string;
  readonly reason?: string;
}

/**
 * Governance rule — restored
 */
export interface GovernanceRule {
  readonly rule_id: string;
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly description: string;
  readonly metadata?: Record<string, string>;
}

/**
 * Engine observability — restored
 */
export interface EngineObservability {
  readonly engine_version: string;
  readonly identity_profile: string;
  readonly verification_profile: string;
  readonly schema_validation_profile: string;
  readonly evaluation_duration_ms?: number;
  readonly warnings?: readonly string[];
}

/**
 * ArtifactResult wrapper — restored
 */
export interface ArtifactResult<TArtifact, TObservability> {
  readonly artifact: TArtifact;
  readonly observability: TObservability;
}

/**
 * Strict metadata types
 */
export interface RuntimePayloadMetadata {
  readonly runtime_version: string;
  readonly execution_profile: string;
}

export interface ReplayPayloadMetadata {
  readonly replay_version: string;
  readonly replay_profile_name: string;
}

export interface GovernancePayloadMetadata {
  readonly governance_version: string;
  readonly decision_profile: string;
}

export interface ArchivePayloadMetadata {
  readonly archive_version: string;
  readonly storage_class: string;
}

export interface PromotionPayloadMetadata {
  readonly promotion_version: string;
  readonly target_environment: string;
}

/**
 * Canonical serializer interface
 */
export interface CanonicalArtifactSerializer {
  serialize(value: unknown): Uint8Array;
}

/**
 * Hash engine — corrected to hash bytes only
 */
export interface CanonicalHashEngine {
  hash(bytes: Uint8Array): HashDescriptor;
}

/**
 * Signer — unchanged
 */
export interface Signer {
  sign(hash: HashDescriptor): Promise<SignatureDescriptor>;
}

/**
 * Signature verifier — NEW
 */
export interface SignatureVerifier {
  verify(
    hash: HashDescriptor,
    signature: SignatureDescriptor
  ): Promise<boolean>;
}

/**
 * Artifact verifier
 */
export interface ArtifactVerifier {
  verify(artifact: unknown): Promise<VerificationResult>;
}

/**
 * Identity strategy — unchanged
 */
export interface ArtifactIdentityStrategy {
  createArtifactId(contentHash: HashDescriptor): string;
}

/**
 * Schema validator — full artifact validation
 */
export interface SchemaValidator {
  validate<T>(artifact: T): void;
}

/**
 * Decision clock
 */
export interface DecisionClock {
  now(): Date;
}

/**
 * Unique ID generator
 */
export interface UniqueIdGenerator {
  generate(): string;
}
