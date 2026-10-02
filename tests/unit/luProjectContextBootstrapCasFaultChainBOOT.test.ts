// @vitest-environment node
// (the bootstrap resolves its fresh-verifier script from import.meta.url, which must be a file: URL)
/**
 * W-BOOT: OD-R1 + OD-R2 for the project-context BOOTSTRAP, on a REAL FileCAS (owner decisions
 * 2026-10-02: a CAS/read error is a technical error, never "missing"; fail closed).
 *
 * The bootstrap is reconciliation-first: it resolves the project's current ProjectContextBinding and
 * reuses it, and mints a new one only when the project has none. This file proves that "has none"
 * means exactly that -- an empty binding graph with no supersession relation registered -- and that a
 * binding which EXISTS but cannot be read or verified is never replaced by a newly minted one.
 *
 * Everything is stored through the production storage stack in a fresh temp directory and every run
 * of the bootstrap gets a COLD stack (new FileCASRepository, no cache):
 *
 *   FileCASRepository (mkdtemp) -> MimersByteStorageBackend -> CasBackedArtifactRepository
 *     -> executeProjectContextBootstrap (real) -> ProjectContextBindingProvider.resolveCurrent (real)
 *     -> real signing (fixed-seed Ed25519 test key) -> installVerifiedProductLuContext (real)
 *
 * The damage scenario is the realistic one: the project was bootstrapped, the property layer has been
 * re-imported since (the PostGIS lookup now returns a newer `source_updated_at` and a slightly
 * different polygon), and then the project's binding cannot be read. A bootstrap that mints in that
 * situation gives the project a SECOND binding with ANOTHER property root (another observation,
 * property binding and project context) -- two unconnected heads, or a fresh root over a history.
 *
 * Replaced (hermetic): server/db/prisma (the hermetic guard; only the project and owner lookups are
 * served), the Prisma binding index (in memory, same contract: append-only, ON CONFLICT DO NOTHING,
 * conflict check), the PostGIS property lookup, and the fresh-verifier child process (recorded, exit
 * 0). Never a real CAS root: mkdtemp() under the OS temp directory.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  casDir: '',
  indexDir: '',
  project: null as unknown,
  owner: null as unknown,
  /** 'v1' = the property as first bootstrapped; 'v2' = the same property after a re-import. */
  lookupVersion: 'v1' as 'v1' | 'v2',
  lookups: 0,
  spawns: [] as Array<{ readonly args: readonly string[]; readonly privateKeyInChildEnv: boolean }>,
  puts: [] as string[],
  bindingRows: [] as Array<{ projectId: string; bindingArtifactId: string; contextId: string; contextType: string }>,
  bindingSupersessions: [] as Array<{ projectId: string; artifactId: string }>,
  /** When set, listing the project's binding rows fails with this error. */
  listError: null as Error | null,
  /** W-BOOT / APR F2: other index traces of the project. */
  assessmentRows: [] as Array<{ projectId: string; assessmentArtifactId: string; bindingArtifactId: string }>,
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string }>,
  bootstrapRequests: [] as Array<{ projectId: string; status: string; contextBindingArtifactId: string | null }>,
}));

vi.mock('../../server/db/prisma', async () => {
  const guarded = (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule() as {
    prisma: Record<string | symbol, unknown>;
    Prisma: object;
  };
  const served: Record<string, unknown> = {
    project: { findUnique: async () => state.project },
    projectMember: { findFirst: async () => state.owner },
    // The bootstrap queue (same where-contract as projectContextBootstrapRequestQueue.ts).
    projectContextBootstrapRequest: {
      count: async (args: { where: { projectId: string; status: string; contextBindingArtifactId: { not: null } } }) =>
        state.bootstrapRequests.filter(
          (r) => r.projectId === args.where.projectId && r.status === args.where.status && r.contextBindingArtifactId !== null,
        ).length,
    },
  };
  return {
    Prisma: guarded.Prisma,
    prisma: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p in served ? served[p] : guarded.prisma[p]) }),
  };
});
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      // As the Prisma index: INSERT ... ON CONFLICT (project, context) DO NOTHING, then the conflict check.
      const p = binding.payload;
      if (!state.bindingRows.some((r) => r.projectId === p.project_id && r.contextId === p.project_context_ref.artifact_id && r.contextType === p.project_context_ref.artifact_type)) {
        state.bindingRows.push({ projectId: p.project_id, bindingArtifactId: binding.artifact_id, contextId: p.project_context_ref.artifact_id, contextType: p.project_context_ref.artifact_type });
      }
      if ((await this.resolve(p.project_id, p.project_context_ref)) !== binding.artifact_id) {
        throw new Error('REJECT_PROJECT_CONTEXT_BINDING_CONFLICT: project/context already has a different binding');
      }
    }
    async registerSupersession(supersession: { artifact_id: string; payload: { project_id: string } }) {
      if (!state.bindingSupersessions.some((r) => r.artifactId === supersession.artifact_id)) {
        state.bindingSupersessions.push({ projectId: supersession.payload.project_id, artifactId: supersession.artifact_id });
      }
    }
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = state.bindingRows.filter((r) => r.projectId === projectId && r.contextId === ref.artifact_id && r.contextType === ref.artifact_type);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.bindingArtifactId;
    }
    async listBindingRefs(projectId: string) {
      if (state.listError) throw state.listError;
      return state.bindingRows.filter((r) => r.projectId === projectId).map((r) => ({ artifact_id: r.bindingArtifactId, artifact_type: 'project_context_binding' }));
    }
    async listSupersessionRefs(projectId: string) {
      if (state.listError) throw state.listError;
      return state.bindingSupersessions
        .filter((r) => r.projectId === projectId)
        .map((r) => ({ artifact_id: r.artifactId, artifact_type: 'project_context_binding_supersession' }));
    }
    async findProjectContextRef(projectId: string) {
      const rows = state.bindingRows.filter((r) => r.projectId === projectId);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return { artifact_id: rows[0]!.contextId, artifact_type: rows[0]!.contextType };
    }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    async listForProject(projectId: string) {
      return state.assessmentRows.filter((r) => r.projectId === projectId);
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async listForProject(projectId: string) {
      return state.geometryRows.filter((r) => r.projectId === projectId);
    }
  },
}));
vi.mock('../../server/modules/property/public', () => ({
  lookupPropertyByDesignationFromPostgis: async () => {
    state.lookups += 1;
    const reimported = state.lookupVersion === 'v2';
    return {
      designation: 'GÄVLE BOOT 1:1',
      matchType: 'exact',
      geometry: {
        type: 'Polygon',
        coordinates: [[[17.14, 60.67], [17.15, 60.67], [17.15, reimported ? 60.681 : 60.68], [17.14, 60.67]]],
      },
      boundaries: {
        properties: {
          sourceKey: 'lm-boot-1',
          sourceDataset: 'lm_fastighetsytor',
          sourceUpdatedAt: reimported ? '2026-09-30T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
          centroidSweref99Tm: [617000, reimported ? 6730010 : 6730000],
          municipalityName: 'Gävle',
        },
      },
    };
  },
}));
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { FileCASRepository } = await import('@miljobeslut/mimers-brunn-core');
  const { MimersByteStorageBackend } = await import('../../packages/mps-runtime/src/repository/MimersByteStorageBackend');
  const { CasBackedArtifactRepository } = await import('../../packages/mps-runtime/src/repository/CasBackedArtifactRepository');
  return {
    ...actual,
    MimersIntegration: {
      // A COLD production storage stack on the temp CAS for every bootstrap run; every write is recorded.
      create: async () => {
        const inner = new CasBackedArtifactRepository(
          new MimersByteStorageBackend(new FileCASRepository(state.casDir, { durabilityMode: 'none' }), state.indexDir),
        );
        return {
          artifactRepository: {
            resolve: (ref: { artifact_id: string; artifact_type: string }) => inner.resolve(ref),
            put: (artifact: { artifact_id: string }) => {
              state.puts.push(artifact.artifact_id);
              return inner.put(artifact as never);
            },
          },
        };
      },
    },
  };
});
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const spawn = (_command: string, args: readonly string[], options: { env?: Record<string, string | undefined> }) => {
    state.spawns.push({ args: [...args], privateKeyInChildEnv: Boolean(options?.env?.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM) });
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  return { ...actual, default: { ...(actual.default as object), spawn }, spawn };
});

import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createProductLuProjectContextArtifact,
  createProjectContextBindingArtifactV2,
  createProjectContextBindingSupersessionArtifactV2,
  createProjectContextBindingSupersessionIssuerArtifact,
  type ProjectContextBindingArtifactV2,
  type ProjectContextBindingIssuerArtifact,
} from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import { executeProjectContextBootstrap } from '../../server/modules/localization/luProjectContextBootstrap';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';

const PROJECT_ID = 'project-w-boot-chain';
const INPUT = { projectId: PROJECT_ID, propertyDesignation: 'GÄVLE BOOT 1:1' } as const;

/** An Ed25519 key derived from a fixed seed: signatures (and so every artifact byte) are reproducible. */
function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-boot-chain:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const issuerKey = fixedEd25519('ed25519:pcb-issuer-w-boot-chain');
const supersessionKey = fixedEd25519('ed25519:pcb-supersession-issuer-w-boot-chain');
const verification = new LocalPemVerificationKeyProvider(issuerKey.keyId, issuerKey.publicKeyPem);

const ENV_KEYS = [
  'PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID',
  'PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM',
  'PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM',
  'PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID',
  'PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM',
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let root: string;

/** A cold production stack for the test's own reads and owner-side writes (not recorded in `puts`). */
function repository(): CasBackedArtifactRepository {
  return new CasBackedArtifactRepository(
    new MimersByteStorageBackend(new FileCASRepository(state.casDir, { durabilityMode: 'none' }), state.indexDir),
  );
}

function indexEntryPath(artifactId: string): string {
  return path.join(state.indexDir, `${createHash('sha256').update(artifactId).digest('hex')}.idx`);
}
function storedHash(artifactId: string): string {
  return (JSON.parse(readFileSync(indexEntryPath(artifactId), 'utf8')) as { hash: string }).hash;
}
function objectPath(artifactId: string): string {
  return new FileCASRepository(state.casDir).getFilePath(storedHash(artifactId));
}

/** Every file under the temp CAS, with the sha256 of its bytes (the whole stored state). */
function casFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[path.relative(state.casDir, full).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  walk(state.casDir);
  return files;
}

async function bootstrap() {
  return executeProjectContextBootstrap(INPUT);
}

/** First bootstrap of the project (property v1); returns the minted binding id. */
async function bootstrapOnce(): Promise<string> {
  const outcome = await bootstrap();
  expect(outcome).toEqual({ ok: true, contextBindingArtifactId: expect.stringMatching(/^project-context-binding-/), reused: false });
  return outcome.ok ? outcome.contextBindingArtifactId : '';
}

type Sabotage = (bindingId: string, issuerId: string) => Promise<void> | void;
const SABOTAGE: Record<string, Sabotage> = {
  'binding object missing (index entry intact)': (b) => unlinkSync(objectPath(b)),
  'binding index entry missing': (b) => unlinkSync(indexEntryPath(b)),
  'binding index entry unreadable (EISDIR)': (b) => {
    unlinkSync(indexEntryPath(b));
    mkdirSync(indexEntryPath(b));
  },
  'binding index entry torn (half-written)': (b) => writeFileSync(indexEntryPath(b), '{"artifact_id":"'),
  'binding bytes corrupted': (b) => writeFileSync(objectPath(b), Buffer.from('{"artifact_id":"not-what-the-hash-says"}')),
  // A VALID CAS object (its bytes match its address) whose binding payload was edited after persistence.
  'binding content tampered (valid CAS object)': async (b) => {
    const envelope = JSON.parse(readFileSync(objectPath(b), 'utf8')) as { body: { payload: Record<string, unknown> } };
    envelope.body.payload = {
      ...envelope.body.payload,
      project_context_ref: { artifact_id: 'lu-project-context-edited-after-persistence', artifact_type: 'LU_PROJECT_CONTEXT' },
    };
    const cas = new FileCASRepository(state.casDir, { durabilityMode: 'none' });
    await cas.initialize();
    const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
    writeFileSync(indexEntryPath(b), JSON.stringify({ artifact_id: b, hash }));
  },
  // The binding's index entry names ANOTHER artifact's object (a mixed-up index).
  'binding index entry names another object (the issuer)': (b, i) => writeFileSync(indexEntryPath(b), JSON.stringify({ artifact_id: b, hash: storedHash(i) })),
  "the binding's issuer object missing": (_b, i) => unlinkSync(objectPath(i)),
};

const NO_NEW_BINDING =
  'Ingen ny bindning skapades, eftersom projektet redan kan ha en och en ny då skulle kunna ge det en andra fastighetsrot.';
const LASTING = 'Felet är bestående och löses inte av ett nytt försök. Kontakta systemets administratör.';
const TEXT_READ = `Projektkontexten kunde inte etableras: projektets befintliga bindning kunde inte läsas (tekniskt fel). ${NO_NEW_BINDING} Ett nytt försök kan lyckas.`;
const TEXT_STORAGE = `Projektkontexten kunde inte etableras: projektets befintliga bindning kunde inte läsas eller verifieras ur CAS (bestående lagrings- eller integritetsfel). ${NO_NEW_BINDING} ${LASTING}`;
const TEXT_REFUSED = `Projektkontexten kunde inte etableras: projektets befintliga bindning underkändes vid verifieringen (utfärdare, signatur, innehåll, kontraktsversion eller ersättningskedja). ${NO_NEW_BINDING} ${LASTING}`;
const TEXT_INCONSISTENT = `Projektkontexten kunde inte etableras: projektets bindning saknas i bindningsindexet, men indexen visar att en bindning har funnits (bestående integritetsfel). ${NO_NEW_BINDING} ${LASTING}`;

const READ = { failureCode: 'CURRENT_BINDING_READ_ERROR', reason: 'READ_ERROR', retryable: true, refusalCode: null, failureDetail: TEXT_READ } as const;
const STORAGE = { failureCode: 'CURRENT_BINDING_INTEGRITY_FAULT', reason: 'STORAGE_INTEGRITY_FAULT', retryable: false, refusalCode: null, failureDetail: TEXT_STORAGE } as const;
const MISSING = { failureCode: 'CURRENT_BINDING_INTEGRITY_FAULT', reason: 'MISSING_FROM_CAS', retryable: false, refusalCode: null, failureDetail: TEXT_STORAGE } as const;
const REFUSED = {
  failureCode: 'CURRENT_BINDING_REFUSED', reason: 'REFUSED', retryable: false,
  refusalCode: expect.stringMatching(/^REJECT_PROJECT_CONTEXT_BINDING/), failureDetail: TEXT_REFUSED,
} as const;
const INCONSISTENT = {
  failureCode: 'CURRENT_BINDING_INTEGRITY_FAULT', reason: 'BINDING_INDEX_INCONSISTENT', retryable: false, refusalCode: null, failureDetail: TEXT_INCONSISTENT,
} as const;

const CASES: ReadonlyArray<readonly [string, typeof READ | typeof STORAGE | typeof MISSING | typeof REFUSED]> = [
  ['binding object missing (index entry intact)', STORAGE],
  ['binding index entry missing', MISSING],
  ['binding index entry unreadable (EISDIR)', READ],
  ['binding index entry torn (half-written)', STORAGE],
  ['binding bytes corrupted', STORAGE],
  ['binding content tampered (valid CAS object)', REFUSED],
  ['binding index entry names another object (the issuer)', REFUSED],
  ["the binding's issuer object missing", STORAGE],
];

/** A typed fail-closed outcome, and nothing at all was minted, written, looked up or verified. */
async function expectNoMint(expected: object, before: { rows: string; supersessions: string; files: Record<string, string>; spawns: number }) {
  const outcome = await bootstrap();
  expect(outcome).toEqual({ ok: false, ...expected });
  expect(state.lookups, 'no PostGIS property lookup').toBe(0);
  expect(state.puts, 'no CAS write').toEqual([]);
  expect(state.spawns.length, 'no fresh verifier').toBe(before.spawns);
  expect(JSON.stringify(state.bindingRows), 'no new binding row').toBe(before.rows);
  expect(JSON.stringify(state.bindingSupersessions)).toBe(before.supersessions);
  expect(casFiles(), 'the stored state is unchanged').toEqual(before.files);
  const detail = 'failureDetail' in outcome ? outcome.failureDetail : '';
  expect(detail).not.toMatch(/REJECT_|MIMERS_|EISDIR|Artifact not found|project-context-binding|lu-project-context|[\\/]/);
  expect(detail).not.toContain(root);
}

function snapshot() {
  return {
    rows: JSON.stringify(state.bindingRows),
    supersessions: JSON.stringify(state.bindingSupersessions),
    files: casFiles(),
    spawns: state.spawns.length,
  };
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'wboot-bootstrap-chain-'));
  state.casDir = path.join(root, 'cas');
  state.indexDir = path.join(state.casDir, 'artifact-id-index');
  const cas = new FileCASRepository(state.casDir, { durabilityMode: 'none' });
  await cas.initialize();
  state.project = { id: PROJECT_ID, organisationId: 'org-w-boot', propertyDesignation: 'GÄVLE BOOT 1:1' };
  state.owner = {
    userId: 'user-w-boot',
    user: { id: 'user-w-boot', organisationId: 'org-w-boot', bankidId: 'bankid:w-boot', role: 'CONSULTANT', identityEnvironment: 'TEST' },
  };
  state.lookupVersion = 'v1';
  state.lookups = 0;
  state.spawns.length = 0;
  state.puts.length = 0;
  state.bindingRows.length = 0;
  state.bindingSupersessions.length = 0;
  state.listError = null;
  state.assessmentRows.length = 0;
  state.geometryRows.length = 0;
  state.bootstrapRequests.length = 0;
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = issuerKey.keyId;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = issuerKey.publicKeyPem;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM = issuerKey.privateKeyPem;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = supersessionKey.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = supersessionKey.publicKeyPem;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  hermeticPrismaTouches.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  rmSync(root, { recursive: true, force: true });
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('W-BOOT normal flows on a real FileCAS (unchanged)', () => {
  it('a project without a binding is bootstrapped once: seven artifacts, one index row, a fresh verifier without the private key', async () => {
    const bindingId = await bootstrapOnce();
    expect(state.lookups).toBe(1);
    expect(state.bindingRows).toEqual([expect.objectContaining({ projectId: PROJECT_ID, bindingArtifactId: bindingId })]);
    expect(new Set(state.puts).size).toBe(7);
    expect(state.puts).toContain(bindingId);
    expect(state.spawns).toEqual([{ args: expect.arrayContaining([bindingId, PROJECT_ID]), privateKeyInChildEnv: false }]);
    const stored = await repository().resolve<ProjectContextBindingArtifactV2>({ artifact_id: bindingId, artifact_type: 'project_context_binding' });
    expect(stored.payload.project_id).toBe(PROJECT_ID);
  });

  it('a retry reuses that binding -- also after the property layer was re-imported: no lookup, no write, no verifier', async () => {
    const bindingId = await bootstrapOnce();
    const before = snapshot();
    state.lookups = 0;
    state.puts.length = 0;
    state.lookupVersion = 'v2';
    expect(await bootstrap()).toEqual({ ok: true, contextBindingArtifactId: bindingId, reused: true });
    expect(state.lookups).toBe(0);
    expect(state.puts).toEqual([]);
    expect(state.spawns.length).toBe(before.spawns);
    expect(casFiles()).toEqual(before.files);
  });

  it('the minted bytes are reproducible: two independent temp CAS roots hold identical objects and identical outcomes', async () => {
    const first = await bootstrapOnce();
    const firstFiles = casFiles();
    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(tmpdir(), 'wboot-bootstrap-chain-'));
    state.casDir = path.join(root, 'cas');
    state.indexDir = path.join(state.casDir, 'artifact-id-index');
    await new FileCASRepository(state.casDir, { durabilityMode: 'none' }).initialize();
    state.bindingRows.length = 0;
    const second = await bootstrapOnce();
    expect(second).toBe(first);
    expect(casFiles()).toEqual(firstFiles);
  });
});

describe('W-BOOT: the existing binding cannot be resolved -> typed fail-closed outcome, and NO second binding is minted', () => {
  for (const [name, expected] of CASES) {
    it(`${name} -> ${expected.failureCode} (${expected.reason}, retryable ${expected.retryable})`, async () => {
      const bindingId = await bootstrapOnce();
      const binding = await repository().resolve<ProjectContextBindingArtifactV2>({ artifact_id: bindingId, artifact_type: 'project_context_binding' });
      await SABOTAGE[name]!(bindingId, binding.payload.authority_ref.artifact_id);
      const before = snapshot();
      state.lookups = 0;
      state.puts.length = 0;
      state.lookupVersion = 'v2'; // the property layer was re-imported since the first bootstrap
      await expectNoMint(expected, before);
    });
  }

  // W-BOOT / APR verifier F2: the binding row is lost but other index traces show the project had one.
  const TRACES: ReadonlyArray<readonly [string, (bindingId: string) => void]> = [
    ['the worker\'s own COMPLETED bootstrap request (a bootstrapped project not yet assessed)', (b) => {
      state.bootstrapRequests.push({ projectId: PROJECT_ID, status: 'COMPLETED', contextBindingArtifactId: b });
    }],
    ['an assessment projection row naming the binding', (b) => {
      state.assessmentRows.push({ projectId: PROJECT_ID, assessmentArtifactId: 'assessment-under-the-lost-binding', bindingArtifactId: b });
    }],
    ['a localization geometry row of the project', () => {
      state.geometryRows.push({ projectId: PROJECT_ID, geometryArtifactId: 'localization-geometry-of-the-project' });
    }],
  ];
  for (const [trace, arrange] of TRACES) {
    it(`the binding row lost, ${trace} remains -> CURRENT_BINDING_INTEGRITY_FAULT (index inconsistent); no new binding is minted`, async () => {
      const bindingId = await bootstrapOnce();
      arrange(bindingId);
      state.bindingRows.length = 0; // e.g. a partial restore of the binding projection
      const before = snapshot();
      state.lookups = 0;
      state.puts.length = 0;
      state.lookupVersion = 'v2';
      await expectNoMint(INCONSISTENT, before);
    });
  }

  it('the binding index cannot be listed (database read error) -> CURRENT_BINDING_READ_ERROR, retryable', async () => {
    await bootstrapOnce();
    const before = snapshot();
    state.lookups = 0;
    state.puts.length = 0;
    state.lookupVersion = 'v2';
    state.listError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    await expectNoMint(READ, before);
  });
});

describe('W-BOOT: a binding history (B1 superseded by B2) on a real FileCAS', () => {
  /** B1 from the bootstrap, B2 an owner-issued corrected context for the same property, and a signed B1 -> B2 relation. */
  async function history(): Promise<{ b1: string; b2: string }> {
    const b1 = await bootstrapOnce();
    const repo = repository();
    const binding1 = await repo.resolve<ProjectContextBindingArtifactV2>({ artifact_id: b1, artifact_type: 'project_context_binding' });
    const issuer = await repo.resolve<ProjectContextBindingIssuerArtifact>(binding1.payload.authority_ref);
    const context1 = await repo.resolve<{ payload: { property_refs: readonly { artifact_id: string; artifact_type: string }[] } }>(binding1.payload.project_context_ref);
    const corrected = createProductLuProjectContextArtifact({
      project_id: PROJECT_ID, project_name: 'GÄVLE BOOT 1:1', description: 'W-BOOT owner-corrected LU project context',
      created_by: 'user-w-boot', property_context_ref: context1.payload.property_refs[0]!,
      project_property_binding_ref: binding1.payload.project_property_binding_ref,
    });
    await repo.put({ artifact_id: corrected.artifact_id, content_hash: corrected.content_hash, body: corrected });
    const bare2 = createProjectContextBindingArtifactV2({
      project_id: PROJECT_ID,
      project_context_ref: { artifact_id: corrected.artifact_id, artifact_type: corrected.artifact_type },
      project_property_binding_ref: binding1.payload.project_property_binding_ref,
      binding_version: 'project-context-binding-v2',
      authority_ref: binding1.payload.authority_ref,
    });
    const binding2 = { ...bare2, attestation: await attestProjectContextBindingArtifact({ artifact: bare2, issuer, signing: issuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repo, index: new PrismaProjectContextBindingIndex(), binding: binding2, verification });

    const bareIssuer = createProjectContextBindingSupersessionIssuerArtifact({ issuer_key_id: supersessionKey.keyId, owner_authority_ref: binding1.payload.authority_ref });
    const supersessionIssuer = {
      ...bareIssuer,
      attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: bareIssuer, signing: supersessionKey.provider }),
    };
    await repo.put({ artifact_id: supersessionIssuer.artifact_id, content_hash: supersessionIssuer.content_hash, body: supersessionIssuer });
    const bareRelation = createProjectContextBindingSupersessionArtifactV2({
      project_id: PROJECT_ID,
      superseded_binding_ref: { artifact_id: b1, artifact_type: 'project_context_binding' },
      successor_binding_ref: { artifact_id: binding2.artifact_id, artifact_type: 'project_context_binding' },
      reason_code: 'W_BOOT_OWNER_CORRECTION',
      issuer_ref: { artifact_id: supersessionIssuer.artifact_id, artifact_type: supersessionIssuer.artifact_type },
      issuer_key_id: supersessionKey.keyId,
    });
    const relation = {
      ...bareRelation,
      attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: bareRelation, issuer: supersessionIssuer, signing: supersessionKey.provider }),
    };
    const current = await installOwnerIssuedProjectContextBindingSupersession({
      artifactRepository: repo, index: new PrismaProjectContextBindingIndex(), supersession: relation, verification,
    });
    expect(current.artifact_id).toBe(binding2.artifact_id);
    return { b1, b2: binding2.artifact_id };
  }

  it('the bootstrap reuses the current head B2 (unchanged)', async () => {
    const { b2 } = await history();
    state.lookups = 0;
    state.puts.length = 0;
    expect(await bootstrap()).toEqual({ ok: true, contextBindingArtifactId: b2, reused: true });
    expect(state.lookups).toBe(0);
    expect(state.puts).toEqual([]);
  });

  it('both binding rows lost while the signed B1 -> B2 relation is still registered -> integrity fault; no fresh root is minted over the history', async () => {
    await history();
    state.bindingRows.length = 0; // e.g. a partial restore of the binding projection
    const before = snapshot();
    state.lookups = 0;
    state.puts.length = 0;
    state.lookupVersion = 'v2';
    await expectNoMint(INCONSISTENT, before);
  });

  it('two unconnected heads (the relation row lost) -> refused as ambiguous; no third binding is minted', async () => {
    await history();
    state.bindingSupersessions.length = 0;
    const before = snapshot();
    state.lookups = 0;
    state.puts.length = 0;
    state.lookupVersion = 'v2';
    await expectNoMint({ ...REFUSED, refusalCode: 'REJECT_PROJECT_CONTEXT_BINDING_HEAD' }, before);
  });
});
