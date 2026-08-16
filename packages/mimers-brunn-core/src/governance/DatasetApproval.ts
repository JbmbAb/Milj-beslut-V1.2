import { RawSourceArtifact, QuarantineStorage } from './QuarantineStorage';
import { CASRepository } from '../cas/CASRepository';
import { verifyArtifactAttestation } from '../signing/attestation';
import type { ArtifactAttestation, SigningKeyProvider } from '../signing/SignatureEnvelope';

/**
 * ADR-042 Level 2 — Cryptographic Promotion Authority.
 * See docs/architecture/GAP-REPORT-harvest-governance-2026-08-10.md, "SPEC TIGHTENED".
 *
 * `action` value that a promotion attestation's signed predicate must carry. Distinguishes
 * a promotion attestation from an attestation minted for a different operation (e.g. reject)
 * so one cannot be replayed as the other.
 */
export const PROMOTION_ACTION = 'quarantine.promote' as const;

/** Stable predicateType for promotion attestations (ArtifactAttestation.predicateType). */
export const PROMOTION_ATTESTATION_PREDICATE_TYPE = 'mimers-brunn/quarantine-promotion/v1' as const;

/**
 * Version of the *shape* of the signed predicate below (not the outer attestation envelope).
 * Bump if fields are added/removed/renamed so verifiers can reject predicates signed under an
 * unrecognized shape rather than silently misreading them.
 */
export const PROMOTION_ATTESTATION_SCHEMA_VERSION = 1;

/**
 * The signed predicate a promotion attestation must carry (all fields inside
 * `ArtifactAttestation.predicate`, i.e. part of the signed bytes — not appended after signing).
 */
export interface PromotionAttestationPredicate {
  readonly action: typeof PROMOTION_ACTION;
  readonly quarantine_artifact_id: string;
  readonly quarantine_content_hash: string;
  readonly approver_actor_id: string;
  readonly approver_role: string;
  readonly governance_release: string;
  readonly attestation_schema_version: number;
  readonly signer_key_id: string;
}

/** Raised when an attestation fails cryptographic verification or binding checks (steps 1-7). */
export class GovernanceAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernanceAttestationError';
  }
}

export interface DatasetApprovalIdentity {
  readonly quarantine_id: string;      // ID för karantänsartefakt (RawSourceArtifact)
  readonly content_hash: string;       // Innehållets SHA-256 hash
  readonly source_id: string;          // Källans ID (t.ex. 'mmd_nacka')
  readonly schema_version: number;     // Schemaschema för godkännandet (t.ex. 1)
  readonly approved_for_cas: boolean;  // Måste vara true
}

export interface DatasetApprovalMetadata {
  readonly approved_at: string;         // ISO Tidsstämpel för godkännandet
  readonly approved_by: string;         // = attestation.predicate.approver_actor_id (verifierat)
  readonly approver_role: string;       // = attestation.predicate.approver_role (verifierat)
  /**
   * Den fullständiga, kryptografiskt verifierade attestationen (ADR-042 Level 2).
   * Ersätter det tidigare `approval_signature`-fältet, som trots namnet bara var
   * `sha256(canonical(identity))` — en hash, inte en signatur; vem som helst som kunde
   * konstruera samma identity-objekt kunde reproducera samma "signatur". Detta fält
   * lagrar istället det verkliga, asymmetriskt signerade beviset.
   */
  readonly attestation: ArtifactAttestation;
  readonly governance_release: string; // Motsvarande governance release
}

export interface DatasetApprovalArtifact {
  readonly approval_hash: string;      // Unik hash för godkännandeartefakten (prefixad med sha256:)
  readonly identity: DatasetApprovalIdentity;
  readonly metadata: DatasetApprovalMetadata;
}

export interface PromotionResult {
  readonly approval_hash: string;
  readonly content_hash: string;
  readonly is_duplicate: boolean;
  readonly artifact: DatasetApprovalArtifact;
}

/**
 * QuarantinePromoter — Formell, tvingande länk mellan Karantän (L1-11) och CAS (L1-10)
 * Garanterar fullständig spårbarhet och att INGET skräp hamnar i CAS utan DatasetApprovalArtifact.
 *
 * ADR-042 Level 2: promotion kräver nu en kryptografiskt verifierad `ArtifactAttestation`
 * bunden till exakt denna operation (artifact, content hash, governance release, action) —
 * inte längre en fri textsträng. Detta objekt är förtroenderoten: ett anrop till `promote()`
 * som går förbi HTTP-lagret helt måste misslyckas utan en giltig, korrekt bunden attestation.
 */
export class QuarantinePromoter {
  constructor(
    private readonly quarantine: QuarantineStorage,
    private readonly cas: CASRepository,
    private readonly signing: SigningKeyProvider,
  ) {}

  /**
   * Befordrar (promotes) en karantänsfil till CAS.
   * Skapar och lagrar en DatasetApprovalArtifact i CAS som bevis för befordran.
   */
  async promote(
    quarantineId: string,
    attestation: ArtifactAttestation,
    governanceRelease: string
  ): Promise<PromotionResult> {
    // ---- Business-state preconditions (not security bindings) ----
    const meta = await this.quarantine.getMetadata(quarantineId);
    if (!meta) {
      throw new Error(`Karantänsartefakt med ID '${quarantineId}' hittades inte.`);
    }

    if (meta.status === 'rejected') {
      throw new Error(`Kan inte befordra karantänsartefakt '${quarantineId}' eftersom dess status är 'rejected'.`);
    }

    if (meta.status === 'promoted') {
      throw new Error(`Karantänsartefakt '${quarantineId}' har redan befordrats.`);
    }

    // ---- Cryptographic attestation verification + binding checks (steps 1-7) ----
    // Every check below must pass before any mutation (CAS write, status update). Gather all
    // results first, then a single gate, then side effects — no early return interleaved with
    // a write. See GAP-REPORT-harvest-governance-2026-08-10.md, "SPEC TIGHTENED", explicit
    // acceptance criterion: no CAS write may follow a partially-successful verification.
    const predicate = attestation.predicate as Partial<PromotionAttestationPredicate>;

    const signatureValid = await verifyArtifactAttestation(attestation, this.signing);
    const signerKeyBound =
      predicate.signer_key_id === this.signing.keyId && attestation.signer === this.signing.keyId;
    const actionBound = predicate.action === PROMOTION_ACTION;
    const artifactBound = predicate.quarantine_artifact_id === quarantineId;
    const contentHashBound = predicate.quarantine_content_hash === meta.content_hash;
    const releaseBound = predicate.governance_release === governanceRelease;
    const approverActorId = predicate.approver_actor_id;
    const approverRole = predicate.approver_role;
    const approverBound =
      typeof approverActorId === 'string' &&
      approverActorId.length > 0 &&
      typeof approverRole === 'string' &&
      approverRole.length > 0;

    const checks: ReadonlyArray<readonly [boolean, string]> = [
      [signatureValid, 'Attestationens kryptografiska signatur är ogiltig.'],
      [signerKeyBound, 'Attestationen är inte signerad med den förväntade governance-nyckeln.'],
      [actionBound, `Attestationens action är inte '${PROMOTION_ACTION}'.`],
      [artifactBound, 'Attestationen är bunden till en annan karantänsartefakt än den som befordras.'],
      [contentHashBound, 'Attestationens quarantine_content_hash matchar inte karantänsartefaktens nuvarande innehåll.'],
      [releaseBound, 'Attestationens governance_release matchar inte anropets värde.'],
      [approverBound, 'Attestationen saknar giltig approver_actor_id/approver_role i den signerade payloaden.'],
    ];
    const failedCheck = checks.find(([ok]) => !ok);
    if (failedCheck) {
      throw new GovernanceAttestationError(failedCheck[1]);
    }

    // ---- All 7 checks passed. Only now may side effects occur (step 8). ----
    const bytes = await this.quarantine.get(quarantineId);
    if (!bytes) {
      throw new Error(`Kunde inte läsa binärinnehåll för karantänsartefakt '${quarantineId}'.`);
    }

    const identity: DatasetApprovalIdentity = {
      quarantine_id: quarantineId,
      content_hash: meta.content_hash,
      source_id: meta.source_id,
      schema_version: 1,
      approved_for_cas: true,
    };

    const metadata: DatasetApprovalMetadata = {
      approved_at: new Date().toISOString(),
      approved_by: approverActorId as string,
      approver_role: approverRole as string,
      attestation,
      governance_release: governanceRelease,
    };

    // Spara rådata i CAS (L1-10) — detta är den enda lagliga skrivvägen för rådata till CAS
    const casContentResult = await this.cas.putBytes(bytes);

    // Säkerställ hash-matchning
    const expectedPrefixHash = `sha256:${meta.content_hash}`;
    if (casContentResult.hash !== expectedPrefixHash) {
      throw new Error(
        `Kritiskt fel: CAS-genererad hash '${casContentResult.hash}' matchar inte karantänens förväntade hash '${expectedPrefixHash}'.`
      );
    }

    // Spara DatasetApprovalArtifact i CAS som en oföränderlig länk (governance-bevis)
    // Vi låter CAS beräkna den unika hashen för { identity, metadata } automatiskt
    const casArtifactResult = await this.cas.putCanonical({ identity, metadata });
    const approvalHash = casArtifactResult.hash;

    const artifact: DatasetApprovalArtifact = {
      approval_hash: approvalHash,
      identity,
      metadata,
    };

    // Uppdatera karantänens status till 'promoted'
    await this.quarantine.updateStatus(quarantineId, 'promoted');

    return {
      approval_hash: approvalHash,
      content_hash: casContentResult.hash,
      is_duplicate: casContentResult.existed,
      artifact,
    };
  }
}
