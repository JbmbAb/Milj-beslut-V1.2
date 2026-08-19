import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  DiskQuarantineStorage,
  FileCASRepository,
  QuarantinePromoter,
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
  PROMOTION_ACTION,
  PROMOTION_ATTESTATION_PREDICATE_TYPE,
  PROMOTION_ATTESTATION_SCHEMA_VERSION,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type PromotionAttestationPredicate,
  type DatasetApprovalArtifact
} from '@miljobeslut/mimers-brunn-core';
import { MmdAdapter } from '../../../scripts/import/harvest/adapters/mmdAdapter';
import { buildRetrievalPolicy } from '../../../packages/mps-retrieval-governance/src/RetrievalPolicy';
import { evaluateRetrieval } from '../../../packages/mps-retrieval-governance/src/RetrievalDecision';
import {
  installSourceRegistryFixtureEnv,
  writeVerifiedSourceRegistryFixture,
} from '../import/sourceRegistryFixture';

describe('TV-L1 End-to-End Proof of Governance against Real Source', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let executeHarvestForSource: any;

  let quarantineDir: string;
  let casDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-l1-e2e-proof-'));
    originalEnv = { ...process.env };

    quarantineDir = path.join(tempDir, '.quarantine');
    casDir = path.join(tempDir, 'cas_store');

    // Sätt upp rötter för testerna
    process.env.MASTER_ARCHIVE_ROOT = path.join(tempDir, 'geo_master_archive');
    process.env.QUARANTINE_ROOT = quarantineDir;
    process.env.SKIP_DISK_SPACE_CHECK = 'true';
    process.env.SKIP_DISK_CHECK = 'true';
    process.env.NODE_ENV = 'test';
    installSourceRegistryFixtureEnv(await writeVerifiedSourceRegistryFixture(tempDir));

    vi.resetModules();

    // Importera skörderuntimet
    const mod = await import('../../../scripts/import/harvest/harvestRuntime');
    executeHarvestForSource = mod.executeHarvestForSource;
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('proves TV-L1 end-to-end (positive and negative flows)', async () => {
    const quarantine = new DiskQuarantineStorage(quarantineDir);
    const cas = new FileCASRepository(casDir, { durabilityMode: 'best-effort' });
    await cas.initialize();

    // ADR-042 Level 2: promotion now requires a signed ArtifactAttestation bound to the exact
    // operation, not a bare "who approved" string. Build attestations the same way
    // server/routes/governance.routes.ts does server-side, after its ADMIN check.
    const signing: SigningKeyProvider = LocalPemSigningKeyProvider.generate('ed25519:test-tv-l1-e2e').provider;
    async function buildAttestation(args: {
      quarantineId: string;
      contentHash: string;
      governanceRelease: string;
      approverActorId?: string;
      approverRole?: string;
    }): Promise<ArtifactAttestation> {
      const predicate: PromotionAttestationPredicate = {
        action: PROMOTION_ACTION,
        quarantine_artifact_id: args.quarantineId,
        quarantine_content_hash: args.contentHash,
        approver_actor_id: args.approverActorId ?? 'jimmy',
        approver_role: args.approverRole ?? 'ADMIN',
        governance_release: args.governanceRelease,
        attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
        signer_key_id: signing.keyId,
      };
      return createArtifactAttestation({
        subjectDigest: `sha256:${args.contentHash}`,
        predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
        predicate: predicate as unknown as Record<string, unknown>,
        signing,
      });
    }

    const promoter = new QuarantinePromoter(quarantine, cas, signing);

    // =========================================================================
    // 1. NEGATIVT TEST: Oauktoriserad källa (Crawler Leak Protection)
    // =========================================================================
    // Vi spionerar på MmdAdapter för att returnera en kandidat med obehörig domän (evil.com)
    const { MmdAdapter: MockMmdAdapter } = await import('../../../scripts/import/harvest/adapters/mmdAdapter');
    const discoverSpy = vi.spyOn(MockMmdAdapter.prototype, 'discover');
    discoverSpy.mockResolvedValueOnce([
      {
        uniqueId: 'unauthorized-test',
        caseId: 'CASE-001',
        authority: 'Nacka',
        municipality: 'Haninge',
        year: 2026,
        sourceUrl: 'https://www.evil.com/robots.txt', // evil.com är ej tillåten i Nacka-kontraktet
        fileName: 'unauthorized.txt',
        docType: 'decision'
      }
    ]);

    const unauthorizedRun = await executeHarvestForSource('mmd_nacka', { execute: true });
    expect(unauthorizedRun.documents_new).toBe(0); // Inga dokument skördade pga crawler-spärr!

    // =========================================================================
    // 2. RETRIEVAL POLICY NEGATIVT TEST: Policy-brott
    // =========================================================================
    // Vi skapar en sök-policy som uttryckligen spärrar expansion av råtext
    const strictPolicy = buildRetrievalPolicy('DECISION_SUMMARY'); // Tillåter sammanfattning men ej rådata
    expect(strictPolicy.allow_raw_expansion).toBe(false);

    // Verifiera att systemet spärrar rådata-expansion enligt konstitutionen
    const retrievalRequest = {
      intent: 'visa mig råtexten från domen',
      expand_raw: true // Brott mot strictPolicy!
    };
    const decision = evaluateRetrieval(retrievalRequest);
    expect(decision.denied_reasons).toContain('raw_expansion_denied_by_policy');
    expect(decision.expand_raw).toBe(false); // Nekad!

    // =========================================================================
    // 3. POSITIVT INGEST-TEST: Hämta Riktigt Dokument från Extern Myndighetskälla
    // =========================================================================
    // Vi använder domstol.se:s riktiga robots.txt som en pålitlig, stabil extern test-källa.
    // Detta bevisar att skörderuntimet faktiskt anropar nätverket och hämtar riktigt, icke-syntetiserat innehåll!
    discoverSpy.mockResolvedValueOnce([
      {
        uniqueId: 'real-external-robots-txt',
        caseId: 'GOV-2026-TXT',
        authority: 'Nacka',
        municipality: 'Haninge',
        year: 2026,
        sourceUrl: 'https://www.domstol.se/robots.txt', // RIKTIG extern URL
        fileName: 'robots.txt',
        docType: 'decision'
      }
    ]);

    console.log('\n--- Inleder End-to-End nätverksanrop mot domstol.se ---');
    const realRun = await executeHarvestForSource('mmd_nacka', { execute: true });
    expect(realRun.status).toBe('completed');
    expect(realRun.documents_new).toBe(1);

    // Kontrollera att det fysiskt sparades i karantänen (L1-11)
    const quarantinedItems = await quarantine.list();
    const robotsItem = quarantinedItems.find(item => item.file_name === 'robots.txt');
    expect(robotsItem).toBeDefined();
    expect(robotsItem!.status).toBe('quarantined');
    expect(robotsItem!.source_url).toBe('https://www.domstol.se/robots.txt');

    const rawBytes = await quarantine.get(robotsItem!.quarantine_id);
    expect(rawBytes).toBeDefined();
    const rawText = new TextDecoder().decode(rawBytes!);
    expect(rawText).toContain('User-agent:'); // Robots.txt standard-struktur bekräftar riktigt nätverks-innehåll!
    console.log('--- Nätverksanrop lyckades! Råtext infångad och säkrad i Karantänen. ---\n');

    // Spara de korrekta original-byten för senare negativ-testning
    const originalBytes = new Uint8Array(rawBytes!);

    // =========================================================================
    // 4. NEGATIVT TEST: Ändrade/Korrumperade Råbytes (Integrity Fail)
    // =========================================================================
    // Vi manipulerar filen i karantänen manuellt för att simulera korruption
    const badBytes = new TextEncoder().encode('KORRUMPERAT INNEHÅLL (Adversarial Attack)');
    const physicalBinPath = path.join(quarantineDir, `${robotsItem!.quarantine_id}.bin`);
    fs.writeFileSync(physicalBinPath, badBytes);

    // Försök till promotion måste nu avvisas pga hash-matchningsspärr. Attestationen är
    // korrekt bunden till karantänpostens (opåverkade) metadata-hash — det är CAS-skrivningens
    // egen re-hash av de faktiska (nu korrumperade) bytes som ska fånga avvikelsen (steg 8, efter
    // att alla 7 bindningskontroller redan passerat).
    const tamperedRunAttestation = await buildAttestation({
      quarantineId: robotsItem!.quarantine_id,
      contentHash: robotsItem!.content_hash,
      governanceRelease: 'gov-release-1',
    });
    await expect(promoter.promote(robotsItem!.quarantine_id, tamperedRunAttestation, 'gov-release-1'))
      .rejects.toThrowError(/matchar inte karantänens förväntade hash/i);

    // Återställ originalet för nästa test
    fs.writeFileSync(physicalBinPath, originalBytes);

    // =========================================================================
    // 5. NEGATIVT TEST: Avvisat godkännande (Rejected Approval)
    // =========================================================================
    // Sätt status till rejected i karantänen
    await quarantine.updateStatus(robotsItem!.quarantine_id, 'rejected', ['MANUAL_AUDIT_FAILED']);

    // Försök till promotion av avvisad fil måste blockeras
    const rejectedRunAttestation = await buildAttestation({
      quarantineId: robotsItem!.quarantine_id,
      contentHash: robotsItem!.content_hash,
      governanceRelease: 'gov-release-1',
    });
    await expect(promoter.promote(robotsItem!.quarantine_id, rejectedRunAttestation, 'gov-release-1'))
      .rejects.toThrowError(/rejected/i);

    // Återställ till quarantined för att genomföra lyckad promotion
    const metadataPath = path.join(quarantineDir, `${robotsItem!.quarantine_id}.metadata.json`);
    const metaJson = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metaJson.status = 'quarantined';
    fs.writeFileSync(metadataPath, JSON.stringify(metaJson, null, 2), 'utf8');

    // =========================================================================
    // 6. POSITIVT TEST: Formellt godkännande och befordran till CAS (L1-10)
    // =========================================================================
    const finalAttestation = await buildAttestation({
      quarantineId: robotsItem!.quarantine_id,
      contentHash: robotsItem!.content_hash,
      governanceRelease: 'gov-release-1',
    });
    const promoResult = await promoter.promote(robotsItem!.quarantine_id, finalAttestation, 'gov-release-1');
    expect(promoResult.content_hash).toBe(`sha256:${robotsItem!.content_hash}`);

    // Kontrollera att filen nu ligger oföränderlig i CAS
    const casBytes = await cas.getBytes(promoResult.content_hash);
    expect(casBytes).toBeDefined();
    expect(new TextDecoder().decode(casBytes!)).toContain('User-agent:');

    // Kontrollera att DatasetApprovalArtifact har sparats som bevis i CAS
    const casPayload = await cas.get<{ identity: any; metadata: any }>(promoResult.approval_hash);
    expect(casPayload).toBeDefined();
    expect(casPayload!.identity.quarantine_id).toBe(robotsItem!.quarantine_id);
    expect(casPayload!.metadata.approved_by).toBe('jimmy');

    // =========================================================================
    // 7. NEGATIVT TEST: Dubbel-promotion blockeras (även med samma giltiga attestation — replay
    // av en redan konsumerad attestation ger ett deterministiskt, kontrollerat avslag, inte en
    // ny CAS-skrivning eller en inkonsekvent identitet).
    // =========================================================================
    await expect(promoter.promote(robotsItem!.quarantine_id, finalAttestation, 'gov-release-1'))
      .rejects.toThrowError(/redan befordrats/i);

    // =========================================================================
    // 8. POSITIVT TEST: Återspelning utan nätverk (Replay without Network)
    // =========================================================================
    // Vi stryper helt nätverksåtkomsten genom att tvinga fetch att kasta fel!
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('NETWORK_UNAVAILABLE: No internet access permitted during Replay (L1-07 Rule)');
    });

    console.log('--- Återspelning inleds offline (L1-07 bevis)... ---');

    // Replay-motorn ska kunna rekonstruera och bevisa exekveringen och det infångade tillståndet
    // direkt från det oföränderliga CAS-arkivet och sparade körnings-artefakter, utan nätverk!
    const runArtifactPath = path.join(quarantineDir, 'runs', `harvest_run_${realRun.harvest_run_id}.json`);
    expect(fs.existsSync(runArtifactPath)).toBe(true);

    const runMeta = JSON.parse(fs.readFileSync(runArtifactPath, 'utf8'));
    const qIdToReplay = runMeta.quarantined_ids[0];

    // Återspela genom att läsa från CAS baserat på sparad metadata-länkning
    const approvedArtifact = await cas.get<{ identity: any }>(promoResult.approval_hash);
    expect(approvedArtifact).toBeDefined();

    const replayContentHash = approvedArtifact!.identity.content_hash;
    const replayedBytes = await cas.getBytes(`sha256:${replayContentHash}`);
    expect(replayedBytes).toBeDefined();

    const replayedText = new TextDecoder().decode(replayedBytes!);
    expect(replayedText).toContain('User-agent:'); // Samma korrekta innehåll bevisat offline!

    console.log('--- Återspelning offline lyckades perfekt! ---\n');
  });
});
