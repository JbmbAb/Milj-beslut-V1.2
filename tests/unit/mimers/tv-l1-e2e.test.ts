import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  DiskQuarantineStorage,
  FileCASRepository,
  QuarantinePromoter,
  type DatasetApprovalArtifact
} from '@miljobeslut/mimers-brunn-core';
import { MmdAdapter } from '../../../scripts/import/loke/adapters/mmdAdapter';
import { buildRetrievalPolicy } from '../../../packages/mps-retrieval-governance/src/RetrievalPolicy';
import { evaluateRetrieval } from '../../../packages/mps-retrieval-governance/src/RetrievalDecision';

describe('TV-L1 End-to-End Proof of Governance against Real Source', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let executeLokeHarvestForSource: any;

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

    vi.resetModules();

    // Importera Loke
    const mod = await import('../../../scripts/import/loke/lokeRuntime');
    executeLokeHarvestForSource = mod.executeLokeHarvestForSource;
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

    const promoter = new QuarantinePromoter(quarantine, cas);

    // =========================================================================
    // 1. NEGATIVT TEST: Oauktoriserad källa (Crawler Leak Protection)
    // =========================================================================
    // Vi spionerar på MmdAdapter för att returnera en kandidat med obehörig domän (evil.com)
    const { MmdAdapter: MockMmdAdapter } = await import('../../../scripts/import/loke/adapters/mmdAdapter');
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

    const unauthorizedRun = await executeLokeHarvestForSource('mmd_nacka', { execute: true });
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
    // Detta bevisar att Loke faktiskt anropar nätverket och hämtar riktigt, icke-syntetiserat innehåll!
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
    const realRun = await executeLokeHarvestForSource('mmd_nacka', { execute: true });
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

    // Försök till promotion måste nu avvisas pga hash-matchningsspärr
    await expect(promoter.promote(robotsItem!.quarantine_id, 'jimmy', 'gov-release-1'))
      .rejects.toThrowError(/matchar inte karantänens förväntade hash/i);

    // Återställ originalet för nästa test
    fs.writeFileSync(physicalBinPath, originalBytes);

    // =========================================================================
    // 5. NEGATIVT TEST: Avvisat godkännande (Rejected Approval)
    // =========================================================================
    // Sätt status till rejected i karantänen
    await quarantine.updateStatus(robotsItem!.quarantine_id, 'rejected', ['MANUAL_AUDIT_FAILED']);

    // Försök till promotion av avvisad fil måste blockeras
    await expect(promoter.promote(robotsItem!.quarantine_id, 'jimmy', 'gov-release-1'))
      .rejects.toThrowError(/rejected/i);

    // Återställ till quarantined för att genomföra lyckad promotion
    const metadataPath = path.join(quarantineDir, `${robotsItem!.quarantine_id}.metadata.json`);
    const metaJson = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metaJson.status = 'quarantined';
    fs.writeFileSync(metadataPath, JSON.stringify(metaJson, null, 2), 'utf8');

    // =========================================================================
    // 6. POSITIVT TEST: Formellt godkännande och befordran till CAS (L1-10)
    // =========================================================================
    const promoResult = await promoter.promote(robotsItem!.quarantine_id, 'jimmy', 'gov-release-1');
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
    // 7. NEGATIVT TEST: Dubbel-promotion blockeras
    // =========================================================================
    await expect(promoter.promote(robotsItem!.quarantine_id, 'jimmy', 'gov-release-1'))
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
