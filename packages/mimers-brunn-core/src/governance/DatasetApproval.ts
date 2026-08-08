import { createHash } from 'node:crypto';
import { RawSourceArtifact, QuarantineStorage } from './QuarantineStorage';
import { CASRepository } from '../cas/CASRepository';
import { canonicalizeStrict } from '../serialization';

export interface DatasetApprovalIdentity {
  readonly quarantine_id: string;      // ID för karantänsartefakt (RawSourceArtifact)
  readonly content_hash: string;       // Innehållets SHA-256 hash
  readonly source_id: string;          // Källans ID (t.ex. 'mmd_nacka')
  readonly schema_version: number;     // Schemaschema för godkännandet (t.ex. 1)
  readonly approved_for_cas: boolean;  // Måste vara true
}

export interface DatasetApprovalMetadata {
  readonly approved_at: string;        // ISO Tidsstämpel för godkännandet
  readonly approved_by: string;        // Vem som godkände (t.ex. 'jimmy')
  readonly approval_signature: string; // Signatur av godkännandets identitet
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
 */
export class QuarantinePromoter {
  constructor(
    private readonly quarantine: QuarantineStorage,
    private readonly cas: CASRepository
  ) {}

  /**
   * Befordrar (promotes) en karantänsfil till CAS.
   * Skapar och lagrar en DatasetApprovalArtifact i CAS som bevis för befordran.
   */
  async promote(
    quarantineId: string,
    approvedBy: string,
    governanceRelease: string
  ): Promise<PromotionResult> {
    // 1. Hämta rådokumentet och dess metadata från karantänen
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

    const bytes = await this.quarantine.get(quarantineId);
    if (!bytes) {
      throw new Error(`Kunde inte läsa binärinnehåll för karantänsartefakt '${quarantineId}'.`);
    }

    // 2. Beräkna identitet och signatur för godkännandet
    const identity: DatasetApprovalIdentity = {
      quarantine_id: quarantineId,
      content_hash: meta.content_hash,
      source_id: meta.source_id,
      schema_version: 1,
      approved_for_cas: true,
    };

    // Generera kryptografisk signatur av identity
    const identitySerialized = canonicalizeStrict(identity);
    const signature = createHash('sha256').update(identitySerialized).digest('hex');

    const metadata: DatasetApprovalMetadata = {
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      approval_signature: signature,
      governance_release: governanceRelease,
    };

    // 3. Spara rådata i CAS (L1-10) — detta är den enda lagliga skrivvägen för rådata till CAS
    const casContentResult = await this.cas.putBytes(bytes);
    
    // Säkerställ hash-matchning
    const expectedPrefixHash = `sha256:${meta.content_hash}`;
    if (casContentResult.hash !== expectedPrefixHash) {
      throw new Error(
        `Kritiskt fel: CAS-genererad hash '${casContentResult.hash}' matchar inte karantänens förväntade hash '${expectedPrefixHash}'.`
      );
    }

    // 4. Spara DatasetApprovalArtifact i CAS som en oföränderlig länk (governance-bevis)
    // Vi låter CAS beräkna den unika hashen för { identity, metadata } automatiskt
    const casArtifactResult = await this.cas.putCanonical({ identity, metadata });
    const approvalHash = casArtifactResult.hash;

    const artifact: DatasetApprovalArtifact = {
      approval_hash: approvalHash,
      identity,
      metadata,
    };

    // 5. Uppdatera karantänens status till 'promoted'
    await this.quarantine.updateStatus(quarantineId, 'promoted');

    return {
      approval_hash: approvalHash,
      content_hash: casContentResult.hash,
      is_duplicate: casContentResult.existed,
      artifact,
    };
  }
}
