import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import type { VerifiedSourceDefinition as SourceDefinition } from '../../../packages/mps-data-governance/src/SourceRegistry';
import {
  installSourceRegistryFixtureEnv,
  writeVerifiedSourceRegistryFixture,
} from './sourceRegistryFixture';

describe('🜂 Loke Live Ingest — Scheduler & State (LSF P0)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  
  // Dynamiska hållare för att undvika hoisting-fel
  let createHarvestPlan: any;
  let startHarvestRun: any;
  let recordHarvestEvent: any;
  let completeHarvestRun: any;
  let isSourceDue: any;
  let runScheduler: any;
  let loadSchedulerState: any;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loke-scheduler-test-'));
    originalEnv = { ...process.env };

    process.env.MASTER_ARCHIVE_ROOT = tempDir;
    process.env.SKIP_DISK_SPACE_CHECK = 'true';
    process.env.SKIP_DISK_CHECK = 'true';
    process.env.NODE_ENV = 'test';
    installSourceRegistryFixtureEnv(await writeVerifiedSourceRegistryFixture(tempDir));

    // Utför dynamiska importer efter att miljövariabeln spikats
    const planMod = await import('../../../scripts/import/loke/harvestPlan');
    createHarvestPlan = planMod.createHarvestPlan;

    const ledgerMod = await import('../../../scripts/import/loke/harvestLedger');
    startHarvestRun = ledgerMod.startHarvestRun;
    recordHarvestEvent = ledgerMod.recordHarvestEvent;
    completeHarvestRun = ledgerMod.completeHarvestRun;

    const schedMod = await import('../../../scripts/import/loke/lokeScheduler');
    isSourceDue = schedMod.isSourceDue;
    runScheduler = schedMod.runScheduler;
    loadSchedulerState = schedMod.loadSchedulerState;
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'Mocked document content'
    }) as any;
  });

  describe('Step 1: HarvestPlan (Immutability & Content-Addressing)', () => {
    it('creates an immutable, content-addressed HarvestPlan', async () => {
      const plan = await createHarvestPlan('mmd_nacka', { priority: 'high' });

      expect(plan.plan_id).toBeDefined();
      expect(plan.source_id).toBe('mmd_nacka');
      expect(plan.source_snapshot.sourceId).toBe('mmd_nacka');
      expect(plan.budgets.priority).toBe('high');
      expect(plan.content_hash).toBeDefined();

      // Deep copying test
      plan.source_snapshot.adapter = 'MUTATED';
      const freshPlan = await createHarvestPlan('mmd_nacka');
      expect(freshPlan.source_snapshot.adapter).toBe('mmd_v1'); // Måste förbli opåverkad (Immutable)
    });
  });

  describe('Step 2: Harvest Ledger (Append-Only Lifecycle)', () => {
    it('creates an append-only ledger and logs state transitions safely', async () => {
      const plan = await createHarvestPlan('mmd_nacka');
      const ledger = await startHarvestRun(plan);

      expect(ledger.ledger_id).toBeDefined();
      expect(ledger.plan_id).toBe(plan.plan_id);
      expect(ledger.status).toBe('HarvestStarted');
      expect(ledger.events.length).toBe(2); // Initial (HarvestPlan) + Start event

      // Lägg till en händelse (Append-only)
      const updatedLedger = await recordHarvestEvent(ledger.ledger_id, 'DiscoveryFinished', 'Hittade 4 filer.');
      expect(updatedLedger.status).toBe('DiscoveryFinished');
      expect(updatedLedger.events.length).toBe(3);
      expect(updatedLedger.events[2]!.message).toBe('Hittade 4 filer.');

      // Slutför rundan och frys revisionsloggen till disk
      const finalLedger = await completeHarvestRun(ledger.ledger_id, 'Completed', { files_count: 4 });
      expect(finalLedger.status).toBe('Completed');
      expect(finalLedger.completed_at).not.toBeNull();

      // Kontrollera att loggen sparades fysiskt som en revisionsfil
      const runPath = path.join(tempDir, 'National_Archive', 'runs', `harvest_ledger_${ledger.ledger_id}.json`);
      expect(fs.existsSync(runPath)).toBe(true);

      const savedLedger = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      expect(savedLedger.ledger_id).toBe(ledger.ledger_id);
      expect(savedLedger.status).toBe('Completed');
      expect(savedLedger.events.length).toBe(4);
    });
  });

  describe('Step 3: Portable Scheduler State Machine', () => {
    const dummySource: SourceDefinition = {
      sourceId: 'dummy_source',
      authority: { name: 'Dummy', type: 'court' },
      adapter: 'mmd_v1',
      frequency: 'daily',
      allowedDomains: ['domstol.se'],
      artifactTypes: ['decision'],
      policy: {
        rate_limit_requests_per_second: 5,
        concurrency_limit: 1,
        politeness_delay_ms: 0,
        retry_policy: { max_attempts: 1, backoff: 'FIXED' },
      },
      registryArtifactId: 'reg-dummy',
      sourceContentHash: 'dummy-hash'
    };

    beforeEach(() => {
      // Rensa runs och state-filer så att testerna körs isolerat
      const runsDir = path.join(tempDir, 'National_Archive', 'runs');
      if (fs.existsSync(runsDir)) {
        fs.rmSync(runsDir, { recursive: true, force: true });
      }
      const stateFilePath = path.join(tempDir, 'scheduler_state.json');
      if (fs.existsSync(stateFilePath)) {
        fs.unlinkSync(stateFilePath);
      }
    });

    it('determines due correctly when no state exists', () => {
      expect(isSourceDue(dummySource, undefined)).toBe(true);
    });

    it('determines due correctly based on cooldown periods', () => {
      const state = {
        last_success: null,
        last_failure: new Date().toISOString(),
        consecutive_failures: 1,
        next_retry: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // Cooldown i 30 minuter
        cooldown_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        disabled: false,
        last_plan_id: 'plan123',
        last_run_id: 'run123'
      };

      expect(isSourceDue(dummySource, state)).toBe(false); // Ej due pga cooldown!
    });

    it('determines due correctly based on consecutive failures block', () => {
      const state = {
        last_success: null,
        last_failure: new Date().toISOString(),
        consecutive_failures: 5, // Blockerad efter 5 fel
        next_retry: null,
        cooldown_until: null,
        disabled: true,
        last_plan_id: 'plan123',
        last_run_id: 'run123'
      };

      expect(isSourceDue(dummySource, state)).toBe(false); // Ej due pga inaktiverad!
    });

    it('runs the full scheduler loop and synchs local state', async () => {
      // Kör orkestreringen skarpt
      const stats = await runScheduler({ execute: true, onlyFilters: ['mmd_nacka'] });

      expect(stats.triggeredPlansCount).toBe(1);
      expect(stats.completedRunsCount).toBe(1);
      expect(stats.failedRunsCount).toBe(0);

      // Verifiera att schemaläggartillståndet sparades och uppdaterades på disk
      const stateFilePath = path.join(tempDir, 'scheduler_state.json');
      expect(fs.existsSync(stateFilePath)).toBe(true);

      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      expect(state.mmd_nacka).toBeDefined();
      expect(state.mmd_nacka.consecutive_failures).toBe(0);
      expect(state.mmd_nacka.last_success).not.toBeNull();
      expect(state.mmd_nacka.last_run_id).toBeDefined();
    });

    it('correctly reconstructs scheduler state from historical ledgers if state file is deleted (Disaster Recovery/Replay)', async () => {
      // 1. Kör schemaläggaren så att vi har historiska ledgers lagrade på disk
      await runScheduler({ execute: true, onlyFilters: ['mmd_nacka'] });

      const stateFilePath = path.join(tempDir, 'scheduler_state.json');
      expect(fs.existsSync(stateFilePath)).toBe(true);

      // Spara ursprungliga värden innan radering
      const originalState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      expect(originalState.mmd_nacka.last_success).not.toBeNull();

      // 2. Radera den lokala tillståndsfilen (Disaster!)
      fs.unlinkSync(stateFilePath);
      expect(fs.existsSync(stateFilePath)).toBe(false);

      // 3. Ladda tillståndet igen. Detta tvingar fram en självläkande rekonstruktion från ledgers!
      const reconstructedState = await loadSchedulerState();

      expect(reconstructedState.mmd_nacka).toBeDefined();
      expect(reconstructedState.mmd_nacka.last_success).toBe(originalState.mmd_nacka.last_success);
      expect(reconstructedState.mmd_nacka.last_plan_id).toBe(originalState.mmd_nacka.last_plan_id);
      expect(reconstructedState.mmd_nacka.last_run_id).toBe(originalState.mmd_nacka.last_run_id);
      expect(reconstructedState.mmd_nacka.consecutive_failures).toBe(0);

      // Kontrollera att tillståndsfilen återskapades fysiskt på disk
      expect(fs.existsSync(stateFilePath)).toBe(true);
    });
  });
});
