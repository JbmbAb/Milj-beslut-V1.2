import './loadEnvFirst';
console.log('🚀 EXPRESS BACKEND STARTING - DATABASE_URL:', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@')); // demo: redact password
import http from 'http';
import { logger } from './logger';
import { createApp } from './createApp';
import { initializeWebSocketServer } from './websocket';
import { warnProductionDevFlags } from './warnProductionDevFlags';
import { shouldStartWorkersInProcess, startInProcessWorkers } from './workers/registry';
import { assertSecurityEnv } from './security/env';
import { ExporterAdapter, validateObservabilityStartup } from './observability';
import { prisma } from './db/prisma';
import { assertExecutionAttestationSecretAtStartup } from './modules/release/executionAttestationStartupGate';
import { assertBootstrapAdmitFlagOnlyInExplicitTestProcess } from '@miljobeslut/mps-lu';

warnProductionDevFlags();

if (process.env.NODE_ENV === 'production') {
  assertSecurityEnv();
}

if (process.env.NODE_ENV !== 'test') {
  validateObservabilityStartup();
  new ExporterAdapter().start();
}

export const app = createApp();
const port = Number(process.env.PORT || 8787);

const server = http.createServer(app);

// Skapa servern men starta den bara om vi inte är i testmiljö.
// Vitest importerar denna fil för att få 'app'-instansen.
if (process.env.NODE_ENV !== 'test') {
  // W-U402 (U40-2, U30R6 §9 K6; owner decision Round 2 row 12): MPS_LU_BOOTSTRAP_ADMIT present (any value) in a process
  // that is not an explicit test process refuses the START -- mps-lu's own rule (package-root export, gate
  // process_startup), decided before anything else starts here. A listening web process is never an explicit test
  // process, so with the flag set it never serves (the verify route's 503 stays as defence in depth).
  try {
    assertBootstrapAdmitFlagOnlyInExplicitTestProcess(process.env, 'process_startup');
  } catch (error) {
    logger.error('bootstrap admission flag: refusing to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  // W-U42 (owner 2026-10-03 (5), BINDING): outside an explicit development/test process the web process must not
  // start on the built-in development HMAC secret for outcome attestations; it needs its own
  // (MPS_EXECUTION_ATTESTATION_HMAC_SECRET), which the LU kernel client then signs with. Decided before anything
  // listens. Not a statement about authenticity: an outcome attestation stays the producing process's own.
  try {
    const attestationSigner = assertExecutionAttestationSecretAtStartup(process.env, 'web');
    logger.info('execution attestation signer', { process_role: 'web', ...attestationSigner });
  } catch (error) {
    logger.error('execution attestation secret: refusing to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  initializeWebSocketServer(server);

  // Bakgrundsjobb: kör separat via `npm run worker:all` i produktion (START_WORKERS_IN_PROCESS=false).
  if (shouldStartWorkersInProcess()) {
    startInProcessWorkers();
  } else {
    logger.info('In-process workers disabled (set START_WORKERS_IN_PROCESS=true to force-enable)');
  }

  if (port === 3000 && process.env.NODE_ENV !== 'production') {
    logger.warn(
      'PORT=3000 kolliderar med Vite (npm run dev). Sätt PORT=8787 i .env.local och kör backend med npm run dev:server.',
      { port },
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // FAIL-FAST POLICY: SOVEREIGN DATABASE VALIDATION ON STARTUP
  // ═════════════════════════════════════════════════════════════════════════
  async function verifyDatabaseSanity(): Promise<void> {
    logger.info('🔍 Running sovereign database sanity checks (Fail-Fast Policy)...');
    try {
      // 1. Connection check
      await prisma.$queryRaw`SELECT 1`;

      // 2. PostGIS Extension check
      const postgisVer = await prisma.$queryRaw<any[]>`SELECT PostGIS_Full_Version() as ver;`;
      if (!postgisVer || !postgisVer[0]?.ver) {
        throw new Error('PostGIS extension is not installed or enabled in the database.');
      }
      logger.info(`✅ PostGIS detected: ${postgisVer[0].ver.split(' ')[0]}`);

      // 3. Schema presence check ('core' and 'env' must exist)
      const schemas = await prisma.$queryRaw<any[]>`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name IN ('core', 'env', 'topo10', 'lm');
      `;
      const foundSchemas = schemas.map(s => s.schema_name);
      const requiredSchemas = ['core', 'env'];
      const missing = requiredSchemas.filter(s => !foundSchemas.includes(s));
      
      if (missing.length > 0) {
        throw new Error(`Missing required PostGIS schemas: ${missing.join(', ')}`);
      }
      logger.info(`✅ Required schemas found: ${foundSchemas.join(', ')}`);

      // 4. Spatial references count check (spatial_ref_sys must be populated)
      const spatialRefs = await prisma.$queryRaw<any[]>`SELECT COUNT(*) as count FROM public.spatial_ref_sys;`;
      const refCount = Number(spatialRefs[0]?.count || 0);
      if (refCount < 100) {
        throw new Error(`Spatial reference table (spatial_ref_sys) is empty or incomplete (found only ${refCount} rows).`);
      }
      logger.info(`✅ Spatial reference systems loaded: ${refCount} definitions`);

      logger.info('🚀 Sovereign database validation SUCCEEDED! Starting platform...');
    } catch (err: any) {
      logger.error('❌ SOVEREIGN DATABASE VALIDATION FAILED! Stopping server startup to prevent silent failure.', {
        error: err.message || err,
        db_url: process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@') // Redact password
      });
      process.exit(1);
    }
  }

  // Execute the validation and start listening only if it succeeds
  verifyDatabaseSanity()
    .then(async () => {
      // Fail-closed Mimers CAS when MIMERS_REQUIRED is set (ExecutionKernel store).
      const { assertMimersCasReady } = await import(
        '../packages/mps-runtime/src/repository/createKernelArtifactRepository.js'
      );
      await assertMimersCasReady(process.env);
      // W-U42: the web process binds the files it runs to the configured product release before it listens
      // (re-measured source digest vs release-identity.json vs the signed release manifest in the CAS). A
      // deviation, or a product process without a release identity, refuses to start; only an explicit
      // development/test process (NODE_ENV and APP_ENV both set exactly) may run without one.
      const { assertProductReleaseIdentityAtStartup } = await import('./modules/release/productReleaseStartup');
      await assertProductReleaseIdentityAtStartup({ role: 'web' });
    })
    .then(() => {
      server.listen(port, () => {
        logger.info('Miljöbeslut backend started with WebSocket support', { port });
      });
    })
    .catch((err) => {
      logger.error('Critical startup validation failed (DB or Mimers CAS):', err);
      process.exit(1);
    });
}
