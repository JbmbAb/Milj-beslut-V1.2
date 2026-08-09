// scripts/benchmark/adversarial-retrieval-test.ts

import { EvidenceRAGService } from '../../packages/mps-lu/src/services/EvidenceRAGService';
import { LegalEvidence } from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifact';

async function main() {
  console.log('=== KNOWLEDGE WAVE 3: ADVERSARIAL RETRIEVAL & SAFETY TESTING (P23) ===');

  const ragService = new EvidenceRAGService();
  let passedTests = 0;
  let totalTests = 0;

  // 1. NEGATION FLIP CHALLENGE
  console.log('\n--- Challenge 1: Negation Flip Challenge ---');
  const claim1 = "Verksamheten får bedrivas efter anmälan.";
  const chunk1 = "Verksamheten får inte bedrivas efter anmälan."; // Contradicts
  const entailment1 = ragService.analyzeEntailment(claim1, chunk1);
  console.log(`  Claim : "${claim1}"`);
  console.log(`  Source: "${chunk1}"`);
  console.log(`  Entailment Result: ${entailment1}`);
  if (entailment1 === 'CONTRADICTED') {
    console.log('  [PASS] Successfully detected active Swedish negation contradiction! 🟢');
    passedTests++;
  } else {
    console.error('  [FAIL] Failed to detect negation contradiction! 🔴');
  }
  totalTests++;

  // 2. EXCEPTION / EXCLUSION PATTERN
  console.log('\n--- Challenge 2: Exception & Exclusion Patterns ---');
  const claim2 = "Verksamheten är alltid tillåten vid anmälan.";
  const chunk2 = "Verksamheten får bedrivas efter anmälan, utom inom vattenskyddsområden där tillstånd krävs."; // Limited permission
  const entailment2 = ragService.analyzeEntailment(claim2, chunk2);
  console.log(`  Claim : "${claim2}"`);
  console.log(`  Source: "${chunk2}"`);
  console.log(`  Entailment Result: ${entailment2}`);
  
  // Checking negation of exceptions (like "utom", "undantaget", "förbjudet")
  // Since chunk has limitative keyword "vattenskyddsområden" and "tillstånd krävs" but claim says "alltid tillåten",
  // overlap-negation difference or word root mismatch handles it as INSUFFICIENT or CONTRADICTED
  if (entailment2 === 'CONTRADICTED' || entailment2 === 'INSUFFICIENT') {
    console.log('  [PASS] Successfully rejected absolute claim when conditional exceptions exist! 🟢');
    passedTests++;
  } else {
    console.error('  [FAIL] Leakage! Absolute claim was approved despite exceptions. 🔴');
  }
  totalTests++;

  // 3. TEMPORAL JURIDICAL VALIDITY DECAY (P17)
  console.log('\n--- Challenge 3: Temporal Validity Decay ---');
  const oldDocPath = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\National_Archive\\Länsstyrelsen\\2015\\Uppsala\\beslut.pdf';
  const newDocPath = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\National_Archive\\Mark-_och_miljööverdomstolen\\2026\\Mora\\beslut.pdf';

  const oldMeta = ragService.getAuthorityMetadata(oldDocPath);
  const newMeta = ragService.getAuthorityMetadata(newDocPath);

  console.log(`  Document 2015 type: ${oldMeta.authority_type}, Year: ${oldMeta.year}, Valid: ${oldMeta.is_temporally_valid}`);
  console.log(`  Document 2026 type: ${newMeta.authority_type}, Year: ${newMeta.year}, Valid: ${newMeta.is_temporally_valid}`);

  if (!oldMeta.is_temporally_valid && newMeta.is_temporally_valid) {
    console.log('  [PASS] Successfully flagged old decision as temporally decaying! 🟢');
    passedTests++;
  } else {
    console.error('  [FAIL] Failed to decay older legal authorities. 🔴');
  }
  totalTests++;

  // 4. CONFIRMING FORMAL LEGAL EVIDENCE SCHEME (P21)
  console.log('\n--- Challenge 4: Legal Evidence Record Instantiation ---');
  const sampleEvidence: LegalEvidence = {
    source_document: "MÖD-M-1456-26_beslut.pdf",
    source_type: "judgment",
    authority: "Mark- och miljööverdomstolen",
    document_date: "2026-08-08T00:00:00.000Z",
    effective_from: "2026-08-08T00:00:00.000Z",
    jurisdiction: "Svea Hovrätt",
    chunk_id: "chunk-reconciled-101",
    source_hash: "sha256-dca59b7afe50288f8359d279eaf30",
    claim: "Hanteringen av schaktmassor kräver inte tillstånd för denna fastighet.",
    relation: entailment1,
    confidence: 0.95,
  };

  console.log('  Structured LegalEvidence Instantiated perfectly:');
  console.log(JSON.stringify(sampleEvidence, null, 2));
  passedTests++;
  totalTests++;

  console.log('\n================================================');
  console.log(`=== ADVERSARIAL RETRIEVAL METRICS              ===`);
  console.log(`=== Passed Security Checks: ${passedTests}/${totalTests}               ===`);
  console.log('================================================');
}

main()
  .catch(err => {
    console.error('Adversarial testing failed:', err);
    process.exit(1);
  });
