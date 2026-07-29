/**
 * Local evolution smoke / integration harness (WORM + Mimers CAS-primary).
 *
 *   npx tsx scripts/evolve-integration-test.ts
 *   npm run evolve:integration
 *
 * Honours MIMERS_ROOT / MIMERS_DURABILITY_MODE when set; otherwise uses ./tmp-mimers.
 * Fail-closed via requireMimersBackendFromEnv + orchestrator.requireMimers.
 * Artifact store is wrapped with PolicyEnforcingArtifactStore (WORM on promotion/).
 * Post-run: verifyPromotionAgainstBackend (V3 as index, CAS as truth).
 */
import path from 'node:path';
import { ArtifactPolicyViolation, RecoveryOrchestrator } from '@miljobeslut/mimers-brunn-core';
import { FileArtifactStore } from '../server/artifact/FileArtifactStore';
import type { PromotionArtifactV3 } from '../server/artifact/PromotionArtifact';
import { LocalPemSigningKeyProvider } from '../server/artifact/signingKeyProvider';
import { DefaultEvaluationEngine } from '../server/evolve/DefaultEvaluationEngine';
import { EventLedger } from '../server/evolve/EventLedger';
import { EvolutionOrchestrator } from '../server/evolve/EvolutionOrchestrator';
import type { EvolutionRun } from '../server/evolve/EvolutionRun';
import { FitnessEngine, DefaultFitnessProfile } from '../server/evolve/FitnessEngine';
import { ParetoFrontier } from '../server/evolve/ParetoFrontier';
import { SimpleApprovalGate } from '../server/evolve/SimpleApprovalGate';
import { SimpleConstraintSolver } from '../server/evolve/ConstraintSolver';
import { BatchShadowEvaluator } from '../server/evolve/BatchShadowEvaluator';
import { StubCandidateGenerator } from '../server/evolve/StubCandidateGenerator';
import type { PipelineDefinition } from '../server/compiler/types';
import {
  PolicyEnforcingArtifactStore,
  requireMimersBackendFromEnv,
  verifyPromotionAgainstBackend,
} from '../server/mimers';
import { generateAesKeyPair } from '../server/utils/signing';

async function main(): Promise<void> {
  const artifactsDir = path.resolve(process.cwd(), 'tmp-artifacts');
  const fallbackMimers = path.resolve(process.cwd(), 'tmp-mimers');
  const innerStore = new FileArtifactStore(artifactsDir);
  const store = new PolicyEnforcingArtifactStore(innerStore);
  const keys = generateAesKeyPair();
  const signing = new LocalPemSigningKeyProvider('ed25519:smoke', keys.privateKey, keys.publicKey);
  const mimers = await requireMimersBackendFromEnv({ fallbackRoot: fallbackMimers });

  // WORM smoke: overwrite of an existing promotion key must fail.
  const probeKey = `promotion/worm-probe-${Date.now()}`;
  await store.put(probeKey, { probe: true });
  try {
    await store.put(probeKey, { probe: true, again: true });
    throw new Error('Expected ArtifactPolicyViolation on promotion overwrite');
  } catch (err) {
    if (!(err instanceof ArtifactPolicyViolation)) throw err;
  }

  const run: EvolutionRun = {
    id: `evo-test-${Date.now()}`,
    seed: 'test-seed-123',
    compilerVersion: 'smoke-compiler-1',
    registryVersion: 'smoke-registry-1',
    searchSpaceHash: 'sha256:smoke',
    createdAt: Date.now(),
  };

  const baseline: PipelineDefinition = {
    id: 'baseline-pipeline',
    version: '1.0.0',
    nodes: [
      { id: 'n1', capability: 'vector_search', resources: [] },
      { id: 'n2', capability: 'reranker', resources: [] },
    ],
  };

  const shadow = new BatchShadowEvaluator();
  const fitness = new FitnessEngine(DefaultFitnessProfile);
  const evaluator = new DefaultEvaluationEngine({ shadow, fitness });
  const generator = new StubCandidateGenerator();
  const approvalGate = new SimpleApprovalGate();
  const constraintSolver = new SimpleConstraintSolver();
  const frontier = new ParetoFrontier();
  const eventLedger = new EventLedger(store, run.id);

  const orchestrator = new EvolutionOrchestrator(
    generator,
    evaluator,
    store,
    frontier,
    approvalGate,
    {
      minQualityDelta: 0.01,
      maxLatencyRegression: 500,
      maxCostRegression: 1,
      maxErrorRegression: 0.1,
    },
    constraintSolver,
    eventLedger,
    signing,
    mimers.backend,
    true, // requireMimers — CAS-primary smoke
  );

  console.log('Starting short evolution run:', run.id);
  console.log('Mimers root:', mimers.rootDir);
  const finalBaseline = await orchestrator.evolve(run, baseline, 2, 3, {
    runtimeCapabilities: { gpu: false, memoryGb: 8 },
  });

  console.log('Evolution finished. Final baseline pipeline id:', finalBaseline.id);

  const promotions = await store.list('promotion/');
  console.log('Promotions keys (all, including prior runs):', promotions.length);

  let thisRunPromotions = 0;
  for (const key of promotions) {
    const art = await store.get<PromotionArtifactV3>(key);
    if (!art || art.evolutionRunId !== run.id) continue;
    thisRunPromotions += 1;
    console.log(
      'Promotion:',
      key,
      'approvalRecordId:',
      art.approvalRecordId,
      'manifestHash:',
      art.manifestHash,
      'mimersPromotionHash:',
      art.metadata?.mimersPromotionHash,
      'executionHash:',
      art.executionHash,
    );
    if (!art.manifestHash) {
      throw new Error(`Expected Mimers dual-write manifestHash on ${key}`);
    }
    const casCheck = await verifyPromotionAgainstBackend(art, mimers.backend, {
      store,
      verifyDescriptors: true,
    });
    if (!casCheck.ok) {
      throw new Error(`CAS-primary verify failed for ${key}: ${casCheck.errors.join('; ')}`);
    }
  }
  if (thisRunPromotions === 0) {
    throw new Error(`Expected at least one promotion for run ${run.id}`);
  }

  const recovery = new RecoveryOrchestrator(mimers.cas, () => mimers.eventLog.getAllEvents());
  const l0 = await recovery.auditL0();
  const l1 = await recovery.auditL1();
  const l2 = await recovery.auditL2();
  console.log('Mimers audit:', { l0: l0.status, l1: l1.status, l2: l2.status, events: l0.processedCount });
  if (l0.status !== 'CLEAN' || l1.status !== 'CLEAN' || l2.status !== 'CLEAN') {
    throw new Error(`Mimers audit failed: ${JSON.stringify({ l0, l1, l2 })}`);
  }

  const frontierSnapshot = await store.get(`frontier/${run.id}`);
  console.log('Frontier snapshot:', JSON.stringify(frontierSnapshot, null, 2));

  const experiments = await store.list(`experiment/${run.id}/`);
  console.log('Experiment keys:', experiments);

  const approvals = await store.list('approval/');
  console.log('Approval keys:', approvals.length);

  const legacyApproved = await store.list('promotion-approved/');
  console.log('Legacy promotion-approved keys:', legacyApproved.length);

  const events = await store.list(`event/${run.id}/`);
  console.log('Event keys:', events.length);

  console.log('Integration test complete. Artifacts:', artifactsDir, 'Mimers:', mimers.rootDir);
}

main().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
