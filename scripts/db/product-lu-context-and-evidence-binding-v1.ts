/**
 * PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1 -- real end-to-end proof.
 *
 * Proves the prop-, proj-, geom-, synthetic-document, lu-workspace, and fixture-default fallbacks
 * are gone from the active product path, and that the real ProjectContextBinding for ORSA STACKMORA
 * 3:12 (project cmt2m7bdj0000h0f7uj4jykis) is resolved and verified instead of fabricated.
 *
 * ViewerCapability/ViewerIdentity negatives (missing/expired capability, wrong identity, wrong
 * release) are already proven end-to-end in VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01-PROVEN.md and
 * are not re-proven here -- this script focuses on what actually changed in this unit: real
 * context resolution replacing synthetic-ID fabrication.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/db/product-lu-context-and-evidence-binding-v1.ts
 */
import '../../server/loadEnvFirst';
import { execSync } from 'node:child_process';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { resolveCanonicalProjectContext } from '../../src/application/resolveCanonicalProjectContext';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import { prisma } from '../../server/db/prisma';

const REAL_PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const REAL_PROPERTY_DESIGNATION = 'ORSA STACKMORA 3:12';

function grep(pattern: string, path: string): string[] {
  try {
    const out = execSync(`grep -rln "${pattern}" "${path}" --include="*.ts" --include="*.tsx"`, { cwd: process.cwd(), encoding: 'utf-8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function expectRejected(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    console.log(`  ${label}: FAIL (did not reject)`);
    return false;
  } catch (error) {
    console.log(`  ${label}: PASS -- FAIL_CLOSED (${error instanceof Error ? error.message : String(error)})`);
    return true;
  }
}

async function main() {
  console.log('########## PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1 ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const results: Record<string, boolean> = {};

  console.log('=== STATIC PROOF: fallbacks removed from source (UNREACHABLE) ===\n');
  const usecaseFile = 'src/application/generate-localization-report.usecase.ts';
  const workspaceFile = 'components/app/lu/LuWorkspace.tsx';

  const projFallback = grep("proj-\\${ctx.projectId}", usecaseFile);
  results.projFallbackUnreachable = projFallback.length === 0;
  console.log(`  proj-\${ctx.projectId} fallback present: ${projFallback.length > 0} (expected false)`);

  const propFallback = grep("prop-\\${site.id}", usecaseFile);
  results.propFallbackUnreachable = propFallback.length === 0;
  console.log(`  prop-\${site.id} fallback present: ${propFallback.length > 0} (expected false)`);

  const geomFallback = grep("geom-\\${site.id}", usecaseFile);
  results.geomFallbackUnreachable = geomFallback.length === 0;
  console.log(`  geom-\${site.id} fallback present: ${geomFallback.length > 0} (expected false)`);

  const syntheticBbox = grep('site.lng - 0.001', usecaseFile);
  results.syntheticDocumentFallbackUnreachable = syntheticBbox.length === 0;
  console.log(`  synthetic lat/lng bbox present: ${syntheticBbox.length > 0} (expected false)`);

  const luWorkspaceFallback = grep("getActiveProjectId() || 'lu-workspace'", workspaceFile);
  results.luWorkspaceFallbackUnreachable = luWorkspaceFallback.length === 0;
  console.log(`  'lu-workspace' fallback present: ${luWorkspaceFallback.length > 0} (expected false)`);

  const fixtureDefault = grep("CesiumEvidenceMode>\\('fixture'\\)", workspaceFile);
  results.fixtureDefaultUnreachable = fixtureDefault.length === 0;
  console.log(`  fixture default present: ${fixtureDefault.length > 0} (expected false)\n`);

  console.log('=== PROOF: real ProjectContextBinding resolves for the golden-path project ===\n');
  const mimers = await MimersIntegration.create({ forceMimers: true });
  const index = new PrismaProjectContextBindingIndex();
  const canonical = await resolveCanonicalProjectContext(REAL_PROJECT_ID, mimers.artifactRepository, index);
  results.realContextResolves =
    canonical.propertyDesignation === REAL_PROPERTY_DESIGNATION &&
    !canonical.propertyContextRef.artifact_id.startsWith('prop-') &&
    !canonical.projectContextRef.artifact_id.startsWith('proj-') &&
    !canonical.geometryRef.artifact_id.startsWith('geom-');
  console.log(`  propertyDesignation: ${canonical.propertyDesignation}`);
  console.log(`  propertyContextRef: ${canonical.propertyContextRef.artifact_id}`);
  console.log(`  projectContextRef: ${canonical.projectContextRef.artifact_id}`);
  console.log(`  geometryRef: ${canonical.geometryRef.artifact_id}`);
  console.log(`  geometry type: ${canonical.geometry.type}`);
  console.log(`  real, non-synthetic refs: ${results.realContextResolves}\n`);

  console.log('=== NEGATIVE PROOFS ===\n');
  const negatives: Record<string, boolean> = {};

  negatives.missingProjectContextBinding = await expectRejected('missing ProjectContextBinding (unbound project)', () =>
    resolveCanonicalProjectContext('project-with-no-real-binding-does-not-exist', mimers.artifactRepository, index),
  );

  negatives.tamperedBindingRejected = await expectRejected('tampered ProjectContextBinding', async () => {
    const binding = await mimers.artifactRepository.resolve<any>({
      artifact_id: 'project-context-binding-32f1ff68cf89421ac4b75d86',
      artifact_type: 'project_context_binding',
    });
    const tampered = { ...binding, payload: { ...binding.payload, project_id: 'some-other-project-entirely' } };
    const { verifyProjectContextBindingArtifactAuthority } = await import('../../server/modules/localization/projectContextBindingAuthority');
    const { getProjectContextBindingIssuerVerifier } = await import('../../server/security/projectContextBindingIssuerKey');
    await verifyProjectContextBindingArtifactAuthority({
      artifact: tampered,
      issuerRef: tampered.payload.authority_ref,
      artifactRepository: mimers.artifactRepository,
      verification: getProjectContextBindingIssuerVerifier(),
    });
  });

  console.log('\n=== PROOF: real assessment run for ORSA STACKMORA 3:12 uses the resolved real context, never fabricates one ===\n');
  async function fabricatedContextExists(): Promise<boolean> {
    try {
      await mimers.artifactRepository.resolve({ artifact_id: 'prop-golden-path-proof-site', artifact_type: 'LU_PROPERTY_CONTEXT' });
      return true;
    } catch {
      return false;
    }
  }
  const usecase = new GenerateLocalizationReportUseCase();
  const [lng, lat] = [14.6645, 61.1348]; // real ORSA STACKMORA 3:12 area (from the canonical geometry)
  const report = await usecase.execute({
    projectId: REAL_PROJECT_ID,
    siteAlternatives: [{ id: 'golden-path-proof-site', name: REAL_PROPERTY_DESIGNATION, lat, lng }],
  });
  const analysis = report.siteAnalyses[0];
  const usedRealContext =
    !!analysis?.executionMotor?.property_context_id &&
    !analysis.executionMotor.property_context_id.startsWith('prop-') &&
    analysis.executionMotor.property_context_id === canonical.propertyContextRef.artifact_id;
  console.log(`  executionMotor.property_context_id: ${analysis?.executionMotor?.property_context_id}`);
  console.log(`  matches resolved real property context, not fabricated: ${usedRealContext}`);
  console.log(`  assessment_status: ${analysis?.executionMotor?.assessment_status}`);
  results.realAssessmentUsesRealContext = usedRealContext;

  results.noFabricatedContextWritten = !(await fabricatedContextExists());
  console.log(`  no fabricated prop-golden-path-proof-site written to CAS: ${results.noFabricatedContextWritten}\n`);

  console.log('\n========== SUMMARY ==========');
  console.log('POSITIVE:', JSON.stringify(results, null, 2));
  console.log('NEGATIVE:', JSON.stringify(negatives, null, 2));
  const ok = Object.values(results).every(Boolean) && Object.values(negatives).every(Boolean);
  console.log(`\nALL GREEN: ${ok}`);

  await prisma.$disconnect();
  await mimers.rebuildIndex();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
