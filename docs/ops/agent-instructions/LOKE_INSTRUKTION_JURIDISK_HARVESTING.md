# Loke: Instruktion för Juridisk RAG Harvesting

**Adressat:** Loke (Prototypings- & Tvätt-agent / Listige formskiftaren)  
**Projekt:** Juridisk RAG — Master Harvesting  
**Timeline:** 2 veckor parallelt harvest  
**Scope:** ALL miljöjuridik (SFS, föreskrifter, ABVA, domar) UTOM enskilda avlopp

---

## DIN ROLL: Download-First & Polite Scraping

Du är ansvarig för **harvesting** — all datainsamling från externa källor:

✅ Hämta från Riksdagen, Naturvårdsverket, HaV, Boverket, Kommuner, Domstolsverket  
✅ Arkivera lokalt i `GEO_Master_Archive/Documents/Sources/`  
✅ Beräkna SHA-256 checksums  
✅ Skapa manifest med metadata  
✅ Implementera polite crawling (rate limiting, retry logic)  
✅ Hantera checkpoints (resume om krockar)  

❌ Du chunkar INTE (det gör Tor)  
❌ Du embeddar INTE (det gör Tor)  
❌ Du importerar INTE till PostgreSQL (det gör Tor)  

---

## ARCHITECTURE: Parallell Harvest (4 Workers samtidigt)

```
┌─────────────────────────────────────────────────────────────┐
│                   LOKE HARVEST COORDINATOR                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  WORKER 1                WORKER 2                           │
│  SFS Harvester    ║    NFS/HVMFS/BFS Harvester             │
│  (Riksdagen)      ║    (NVM/HaV/Boverket)                  │
│  ~1000 files      ║    ~45 files                           │
│  Parallel: 5      ║    Parallel: 3                         │
│                   ║                                        │
│  WORKER 3                WORKER 4                           │
│  Municipal ABVA   ║    Court Decisions Harvester           │
│  (290 kommuner)   ║    (Domstolsverket)                    │
│  ~290 files       ║    ~5000 files                         │
│  Parallel: 2      ║    Parallel: 1 (rate-limited)         │
│                   ║                                        │
│  Checkpoint System: Resume från sista OK-file               │
│  Rate Limiting: Respektera server-regler (2s mellan req)   │
│  Error Handling: Exponential backoff (3x retry)            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
      │
      ├─→ GEO_Master_Archive/FOUNDATION/SFS/
      ├─→ GEO_Master_Archive/REGULATORY/
      ├─→ GEO_Master_Archive/MUNICIPAL/
      ├─→ GEO_Master_Archive/PRECEDENT/
      │
      └─→ Manifest creation for each worker
```

---

## WORKER 1: SFS Harvester (Riksdagen)

**File:** `scripts/import/harvest-sfs-all.ts`

```typescript
/**
 * LOKE WORKER 1: Harvest all Swedish statutes (SFS) from Riksdagen.
 * 
 * Source: https://data.riksdagen.se/
 * 
 * Strategy:
 * 1. Fetch register of all SFS (1998-1 → 2026-XX)
 * 2. For each SFS, download TXT or PDF
 * 3. SHA256 hash, save to archive
 * 4. Create manifest with metadata
 * 5. Support checkpoint-based resume
 * 
 * Rate Limiting: 2 sec between requests (polite)
 * Concurrency: 5 parallel downloads max
 * Retry: Exponential backoff (1s, 2s, 4s)
 */

interface SFSHarvestConfig {
  startFrom?: string;              // e.g., "1998-808" to resume
  maxConcurrency: number;          // Default: 5
  polliteDelayMs: number;          // Default: 2000
  maxRetries: number;              // Default: 3
}

interface SFSManifest {
  worker: "sfs_harvester";
  harvest_date: Date;
  total_files: number;
  total_size_mb: number;
  completed: number;
  failed: number;
  sfs_entries: Array<{
    sfs_id: string;                // "1998:808"
    title: string;
    url: string;
    filename: string;
    file_size: number;
    sha256: string;
    downloaded_at: Date;
    retry_count: number;
    status: "OK" | "FAILED";
  }>;
  last_checkpoint: string;         // sfs_id of last successful download
}

async function harvestAllSFS(config: SFSHarvestConfig): Promise<SFSManifest> {
  const logger = createLogger('SFS_HARVESTER');
  const manifest: SFSManifest = {
    worker: "sfs_harvester",
    harvest_date: new Date(),
    total_files: 0,
    total_size_mb: 0,
    completed: 0,
    failed: 0,
    sfs_entries: [],
    last_checkpoint: config.startFrom || "1998-808",
  };

  // 1. Fetch SFS register
  logger.info('Fetching SFS register from Riksdagen...');
  const sfsList = await fetchSFSRegister();  // Returns sorted array of all SFS IDs
  manifest.total_files = sfsList.length;

  // 2. Resume from checkpoint if specified
  let startIndex = config.startFrom 
    ? sfsList.findIndex(s => s >= config.startFrom) 
    : 0;

  // 3. Download in parallel batches
  const batchSize = config.maxConcurrency;
  for (let i = startIndex; i < sfsList.length; i += batchSize) {
    const batch = sfsList.slice(i, i + batchSize);
    
    const results = await Promise.allSettled(
      batch.map(sfs_id => downloadSingleSFS(sfs_id, config.maxRetries, config.polliteDelayMs))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        manifest.sfs_entries.push(result.value);
        manifest.completed++;
        manifest.total_size_mb += result.value.file_size / (1024 * 1024);
        manifest.last_checkpoint = result.value.sfs_id;
      } else {
        manifest.failed++;
      }
    }

    // Save checkpoint every batch (resume-safe)
    await saveManifest(manifest, 'storage/manifests/sfs-harvest-checkpoint.json');
    logger.info(`Progress: ${manifest.completed}/${manifest.total_files} (${manifest.failed} failed)`);
  }

  logger.info(`✅ SFS Harvest Complete: ${manifest.completed} files, ${manifest.total_size_mb.toFixed(1)} MB`);
  return manifest;
}

async function downloadSingleSFS(
  sfs_id: string,
  maxRetries: number,
  polliteDelayMs: number
): Promise<SFSManifestEntry> {
  let lastError: Error | null = null;

  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      if (retry > 0) {
        const backoffMs = Math.pow(2, retry) * 1000;  // 1s, 2s, 4s, 8s
        await sleep(backoffMs);
      }

      // Fetch from Riksdagen
      const response = await fetch(`https://data.riksdagen.se/dokument/sfs-${sfs_id.replace(':', '-')}.text`, {
        headers: { 'User-Agent': 'MiljobeslutLegalBot/1.0' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = await response.buffer();
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      
      // Save to archive
      const archivePath = `GEO_Master_Archive/FOUNDATION/SFS/${sfs_id}/raw/`;
      await ensureDir(archivePath);
      const filename = `sfs-${sfs_id}.txt`;
      await fs.promises.writeFile(path.join(archivePath, filename), buffer);

      // Polite delay before next request
      await sleep(polliteDelayMs);

      return {
        sfs_id,
        title: `SFS ${sfs_id}`,  // Would parse title from content in production
        url: `https://data.riksdagen.se/dokument/sfs-${sfs_id.replace(':', '-')}.text`,
        filename,
        file_size: buffer.length,
        sha256,
        downloaded_at: new Date(),
        retry_count: retry,
        status: 'OK',
      };
    } catch (err) {
      lastError = err;
    }
  }

  // All retries failed
  return {
    sfs_id,
    title: `SFS ${sfs_id}`,
    url: '(failed)',
    filename: '',
    file_size: 0,
    sha256: '',
    downloaded_at: new Date(),
    retry_count: maxRetries,
    status: 'FAILED',
  };
}

// Main execution
async function main() {
  const config: SFSHarvestConfig = {
    maxConcurrency: 5,
    polliteDelayMs: 2000,
    maxRetries: 3,
  };

  const manifest = await harvestAllSFS(config);
  await saveManifest(manifest, 'storage/manifests/sfs-harvest-final-2026-08-09.json');
}

main().catch(err => console.error('SFS Harvest failed:', err));
```

**Checklist för LOKE:**
- [ ] Parse Riksdagens SFS-register (iterate all IDs)
- [ ] Fetch + download (handle redirects, encoding)
- [ ] SHA256 hashing
- [ ] Checkpoint-based resume (safe for interruptions)
- [ ] Exponential backoff retry
- [ ] Polite rate limiting (2 sec between requests)
- [ ] Archive directory structure
- [ ] Manifest creation & checkpoint saving
- [ ] Error logging (all failed downloads tracked)
- [ ] Test med första 10 SFS

---

## WORKER 2: Regulatory Harvester (NFS, HVMFS, BFS)

**File:** `scripts/import/harvest-regulatory-all.ts`

Samma mönster som Worker 1, men för tre myndigheter:

```typescript
interface RegulatoryConfig {
  sources: Array<{
    name: "NFS" | "HVMFS" | "BFS";
    base_url: string;
    list_page: string;           // URL to page listing all regulations
    pattern: RegExp;             // To extract regulation IDs
  }>;
  maxConcurrency: number;        // Default: 3 (slower rate för dessa sources)
}

async function harvestAllRegulations(config: RegulatoryConfig): Promise<RegulatoryManifest> {
  // Similar structure to SFS harvester, but loop over multiple sources
}
```

**Sources:**
- **NFS:** naturvardsverket.se/publikationer/foreskrifter/
- **HVMFS:** havochvatten.se/foreskrifter/
- **BFS:** boverket.se/foreskrifter/

**Checklist för LOKE:**
- [ ] Web scrape regulation lists
- [ ] Extract regulation IDs + URLs
- [ ] Download PDFs (handle different mime-types)
- [ ] Checkpoint & retry logic
- [ ] Manifest creation

---

## WORKER 3: Municipal ABVA Harvester

**File:** `scripts/import/harvest-municipal-abva-all.ts`

```typescript
/**
 * LOKE WORKER 3: Harvest municipal ABVA from 290 Swedish communes.
 * 
 * Challenge: Each commune publishes ABVA on their own website
 * with different structures. Need intelligent scraping.
 * 
 * Strategy:
 * 1. Load commune register (Lantmäteriet eller SKL)
 * 2. For each commune, try multiple search patterns:
 *    - kommun.se/avfallt-och-vatten/foreskrifter/
 *    - kommun.se/miljö/föreskrifter/
 *    - kommun.se/miljo-och-halsa/
 * 3. Download ABVA PDFs/docs
 * 4. Extract metadata (commune name, date, jurisdiction)
 * 5. Checkpoint per region (Dalarna, Värmland, etc)
 * 
 * Priority: Dalarna first (9 communes), then others
 */

interface CommuneABVAManifest {
  worker: "municipal_abva_harvester";
  harvest_date: Date;
  total_communes: number;
  successful: number;
  failed: number;
  communes: Array<{
    commune_id: string;
    commune_name: string;
    region: string;
    abva_url: string;
    abva_filename: string;
    file_size: number;
    sha256: string;
    downloaded_at: Date;
    status: "OK" | "FAILED" | "NOT_FOUND";
  }>;
}

async function harvestAllCommuneABVA(): Promise<CommuneABVAManifest> {
  // Load Swedish communes
  const communes = await loadSwedishCommuneRegister();  // 290 communes

  // Priority: Dalarna first
  const dalarnaCommunes = communes.filter(c => c.region === 'Dalarna');
  const otherCommunes = communes.filter(c => c.region !== 'Dalarna');
  
  const prioritized = [...dalarnaCommunes, ...otherCommunes];

  // Harvest with checkpoints per region
  const manifest: CommuneABVAManifest = {
    worker: "municipal_abva_harvester",
    harvest_date: new Date(),
    total_communes: prioritized.length,
    successful: 0,
    failed: 0,
    communes: [],
  };

  for (const commune of prioritized) {
    try {
      const abva = await searchAndDownloadCommuneABVA(commune);
      manifest.communes.push(abva);
      if (abva.status === 'OK') manifest.successful++;
      else manifest.failed++;
    } catch (err) {
      manifest.communes.push({
        commune_id: commune.id,
        commune_name: commune.name,
        region: commune.region,
        abva_url: '',
        abva_filename: '',
        file_size: 0,
        sha256: '',
        downloaded_at: new Date(),
        status: 'FAILED',
      });
      manifest.failed++;
    }
  }

  return manifest;
}

async function searchAndDownloadCommuneABVA(commune: Commune): Promise<CommuneABVAEntry> {
  // Try multiple search patterns on commune website
  const patterns = [
    `/avfallt-och-vatten/foreskrifter/`,
    `/miljö/föreskrifter/`,
    `/miljo-och-halsa/`,
    `/tjanster/miljö/`,
  ];

  for (const pattern of patterns) {
    try {
      const url = `https://${commune.domain}${pattern}`;
      const response = await fetch(url);
      if (response.ok) {
        // Parse page for ABVA link
        const html = await response.text();
        const abvaLink = parseABVALink(html, commune.name);
        if (abvaLink) {
          // Download ABVA
          return await downloadFile(abvaLink, commune);
        }
      }
    } catch (err) {
      // Try next pattern
      continue;
    }
  }

  // Not found
  return {
    commune_id: commune.id,
    commune_name: commune.name,
    region: commune.region,
    abva_url: '',
    abva_filename: '',
    file_size: 0,
    sha256: '',
    downloaded_at: new Date(),
    status: 'NOT_FOUND',
  };
}
```

**Checklist för LOKE:**
- [ ] Load Swedish commune register
- [ ] Prioritize Dalarna (9)
- [ ] Web scrape commune websites (multiple patterns)
- [ ] Download ABVA PDFs
- [ ] Extract metadata
- [ ] Handle 404s gracefully
- [ ] Checkpoint per region
- [ ] Retry failed communes weekly

---

## WORKER 4: Court Decisions Harvester (Domstolsverket)

**File:** `scripts/import/harvest-court-decisions-all.ts`

```typescript
/**
 * LOKE WORKER 4: Harvest Mark- och miljödomstol decisions.
 * 
 * Source: domstolsverket.se / RSS feeds + search interface
 * 
 * Strategy:
 * 1. Fetch Mark- och miljödomstol RSS feed (weekly updates)
 * 2. For senaste 20 år, archive all published decisions
 * 3. Extract metadata: case_number, date, court, parties, keywords
 * 4. Save PDFs to archive
 * 5. Slower rate-limiting (1 request per 3 seconds - politeness to domstol)
 * 
 * Priority: Landmark cases first (PFAS, grundvatten, miljöprövning)
 */

interface CourtDecisionManifest {
  worker: "court_decisions_harvester";
  harvest_date: Date;
  total_decisions: number;
  successful: number;
  failed: number;
  courts: {
    "Stockholms Miljödomstol": number;
    "Göta Miljödomstol": number;
    "Svea Miljödomstol": number;
    "Östra Sveriges Miljödomstol": number;
    "Mark- och miljööverdomstolen": number;
  };
  decisions: Array<{
    case_id: string;
    court: string;
    judgement_date: Date;
    url: string;
    filename: string;
    file_size: number;
    sha256: string;
    status: "OK" | "FAILED";
  }>;
}

async function harvestAllCourtDecisions(): Promise<CourtDecisionManifest> {
  // Slower rate limiting for court websites
  const config = {
    maxConcurrency: 1,
    polliteDelayMs: 3000,  // 3 seconds between requests
  };

  const manifest: CourtDecisionManifest = {
    worker: "court_decisions_harvester",
    harvest_date: new Date(),
    total_decisions: 0,
    successful: 0,
    failed: 0,
    courts: {
      "Stockholms Miljödomstol": 0,
      "Göta Miljödomstol": 0,
      "Svea Miljödomstol": 0,
      "Östra Sveriges Miljödomstol": 0,
      "Mark- och miljööverdomstolen": 0,
    },
    decisions: [],
  };

  // Fetch from each court
  for (const court of Object.keys(manifest.courts)) {
    const decisions = await fetchCourtDecisions(court, 2005);  // Last 20 years
    
    for (const decision of decisions) {
      try {
        await sleep(config.polliteDelayMs);
        const downloaded = await downloadDecisionPDF(decision);
        manifest.decisions.push(downloaded);
        manifest.successful++;
        manifest.courts[court]++;
      } catch (err) {
        manifest.failed++;
      }
    }
  }

  manifest.total_decisions = manifest.decisions.length;
  return manifest;
}
```

**Checklist för LOKE:**
- [ ] Fetch court RSS feeds
- [ ] Parse decision metadata
- [ ] Download PDFs (very polite rate limiting)
- [ ] Extract case info (parties, keywords, ruling)
- [ ] Archive structure (court/year/)
- [ ] Handle court website changes
- [ ] Manifest creation

---

## EXECUTION: Parallell Harvest Coordinator

**File:** `scripts/import/run-parallel-harvest.ts`

```typescript
/**
 * LOKE COORDINATOR: Start all 4 harvest workers in parallel.
 * 
 * Coordinates:
 * 1. Worker 1 (SFS): 5 parallel, 2 sec rate limit
 * 2. Worker 2 (Regulatory): 3 parallel, 2 sec rate limit
 * 3. Worker 3 (ABVA): 2 parallel, 2 sec rate limit
 * 4. Worker 4 (Court): 1 parallel, 3 sec rate limit
 * 
 * Output: 4 independent manifests + combined summary
 */

async function runParallelHarvest() {
  const logger = createLogger('HARVEST_COORDINATOR');

  logger.info('🚀 Starting parallel juridisk RAG harvest...');
  logger.info('Worker 1: SFS Harvester');
  logger.info('Worker 2: Regulatory Harvester (NFS/HVMFS/BFS)');
  logger.info('Worker 3: Municipal ABVA Harvester');
  logger.info('Worker 4: Court Decisions Harvester');

  // Start all workers in parallel
  const results = await Promise.allSettled([
    harvestAllSFS({ maxConcurrency: 5, polliteDelayMs: 2000 }),
    harvestAllRegulations({ maxConcurrency: 3, polliteDelayMs: 2000 }),
    harvestAllCommuneABVA(),
    harvestAllCourtDecisions(),
  ]);

  // Collect results
  const summary = {
    harvest_date: new Date(),
    total_files: 0,
    total_size_mb: 0,
    workers: {
      sfs: results[0].status === 'fulfilled' ? results[0].value : null,
      regulatory: results[1].status === 'fulfilled' ? results[1].value : null,
      municipal: results[2].status === 'fulfilled' ? results[2].value : null,
      court: results[3].status === 'fulfilled' ? results[3].value : null,
    },
  };

  // Save summary
  await saveManifest(summary, 'storage/manifests/harvest-summary-2026-08-09.json');

  logger.info(`✅ Parallel harvest complete!`);
  logger.info(`   SFS: ${summary.workers.sfs?.completed || 0} / ${summary.workers.sfs?.total_files || 0}`);
  logger.info(`   Regulatory: ${summary.workers.regulatory?.completed || 0} files`);
  logger.info(`   Municipal ABVA: ${summary.workers.municipal?.successful || 0} communes`);
  logger.info(`   Court Decisions: ${summary.workers.court?.successful || 0} decisions`);
}

runParallelHarvest().catch(err => console.error('Harvest failed:', err));
```

**Start LOKE:**
```bash
npm run harvest:parallel  # Starts all 4 workers
```

---

## Checkpoint & Resume Strategy

All workers save checkpoints every batch:

```
GEO_Master_Archive/
├── FOUNDATION/SFS/
│   └── _harvest_checkpoint.json     ← Resume from last OK SFS
├── REGULATORY/
│   └── _harvest_checkpoint.json     ← Resume from last OK regulation
├── MUNICIPAL/
│   └── _harvest_checkpoint.json     ← Resume from last OK commune
└── PRECEDENT/
    └── _harvest_checkpoint.json     ← Resume from last OK decision
```

If a worker crashes at SFS #500, restart with:
```bash
npm run harvest:parallel -- --resume-sfs "2020-500"
```

---

## What Happens After LOKE Finishes

When all 4 workers complete successfully:

1. **Arkiv innehåller:** ~1045 juridiska källfiler
2. **Tor tar över:** Chunking, embedding, import
3. **Veckovis verifiering:** Mimer scannar arkiv vs RAG

---

## Deliverables Expected from LOKE

| Worker | Expected Output | Files | Size |
|--------|-----------------|-------|------|
| SFS | `storage/manifests/sfs-harvest-final-*.json` | ~1000 | ~2 GB |
| Regulatory | `storage/manifests/regulatory-harvest-final-*.json` | ~45 | ~500 MB |
| Municipal ABVA | `storage/manifests/municipal-harvest-final-*.json` | ~290 | ~1.5 GB |
| Court Decisions | `storage/manifests/court-harvest-final-*.json` | ~5000 | ~3 GB |

**Total:** ~6350 files, ~7.5 GB

---

## Success Criteria for LOKE

✅ Harvest complete when:

1. All 4 worker manifests exist
2. Total files: ~6000+ juridiska källdokument arkiverade
3. Total size: ~7 GB
4. Zero critical errors (failed downloads logged, not ignored)
5. All checkpoints saved (resume-safe)
6. Manifests validated (all entries have sha256 hashes)

Then **Tor kan börja chunking.**

