// packages/mps-decision-governance/src/CanonicalDecisionImpactHash.ts

import * as crypto from 'crypto';
import { canonicalizeStrict } from '../../mimers-brunn-core/src/serialization/canonicalize';
import type { DecisionImpactIdentity } from "./DecisionImpactIdentity";
import type { EvidenceSetIdentity } from "./EvidenceSetArtifact";

function calculateSHA256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Kirurgisk tvätt-hjälpare (RFC8785).
 * Tar bort alla nycklar som bär värdet 'undefined' för att tillfredsställa
 * plattformens strikta canonicalizeStrict-inspektioner.
 */
function cleanPayload(obj: any): any {
  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Beräknar en deterministisk, ordningstolerant och plattforms-stabil SHA-256 hash
 * över en EvidenceSetIdentity utifrån plattformens officiella RFC8785-canonicalizer.
 */
export function hashEvidenceSetIdentity(identity: EvidenceSetIdentity): string {
  // Sortera dokumenten efter document_hash för att garantera ordningstolerant identitet!
  const sortedDocuments = [...identity.documents].sort((a, b) => 
    a.document_hash.localeCompare(b.document_hash)
  );

  const payload = cleanPayload({
    documents: sortedDocuments,
    schema_version: identity.schema_version,
    lineage_sequence: identity.lineage_sequence,
    previous_evidence_set_hash: identity.previous_evidence_set_hash,
    lineage_scope: identity.lineage_scope // Garantera att lineage_scope ingår i identitets-hashen!
  });

  return calculateSHA256(canonicalizeStrict(payload));
}

/**
 * Beräknar en deterministisk, ordningstolerant och plattforms-stabil SHA-256 hash
 * över en DecisionImpactIdentity utifrån plattformens officiella RFC8785-canonicalizer.
 */
export function hashDecisionImpactIdentity(identity: DecisionImpactIdentity): string {
  // Sortera indikatorer efter code för att garantera ordningstolerant identitet!
  const sortedIndicators = [...identity.indicators].sort((a, b) => 
    a.code.localeCompare(b.code)
  );
  
  // Sortera evidensset-hashar
  const sortedEvidenceHashes = [...identity.evidence_set_hashes].sort();

  const payload = cleanPayload({
    jurisdiction_level: identity.jurisdiction_level,
    decision_type: identity.decision_type,
    municipality_code: identity.municipality_code,
    county_code: identity.county_code,
    country_code: identity.country_code,
    period_start: identity.period_start,
    period_end: identity.period_end,
    evidence_set_hashes: sortedEvidenceHashes,
    indicators: sortedIndicators,
    schema_version: identity.schema_version,
    derivation_version: identity.derivation_version
  });

  return calculateSHA256(canonicalizeStrict(payload));
}

export function hashCanonicalLineageSlot(identity: EvidenceSetIdentity): string {
  const sortedDocs = [...identity.documents].sort((a, b) => 
    a.document_hash.localeCompare(b.document_hash)
  );

  const payload = cleanPayload({
    previous_evidence_set_hash: identity.previous_evidence_set_hash,
    lineage_scope: identity.lineage_scope,
    documents: sortedDocs
  });

  return calculateSHA256(canonicalizeStrict(payload));
}
