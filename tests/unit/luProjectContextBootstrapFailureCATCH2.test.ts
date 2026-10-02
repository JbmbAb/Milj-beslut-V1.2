// @vitest-environment node
// (the bootstrap resolves its fresh-verifier script from import.meta.url, which must be a file: URL)
/**
 * W-CATCH2 #4 (owner decisions 2026-10-02/03): the bootstrap's outer catch stored `error.message` as
 * failureDetail for every error without its own failureCode -- raw storage paths, SQL or provider text
 * that GET .../bootstrap-status then sent to the client, under one code (BOOTSTRAP_EXECUTION_ERROR)
 * whatever the fault was.
 *
 * Now the persisted record carries a STABLE code from the shared classification and a neutral Swedish
 * text (no schema change, `retryable` derives from the code at presentation):
 *  - a read of unknown persistence -> BOOTSTRAP_EXECUTION_ERROR (as before, now neutral text);
 *  - a lasting storage/integrity fault (another object already under a write-once id, ...) ->
 *    BOOTSTRAP_STORAGE_INTEGRITY_FAULT;
 *  - a refusal (REJECT_*) -> BOOTSTRAP_REFUSED.
 * The raw text survives only as the outcome's internal `diagnostic` (the worker logs it; never stored,
 * never sent). Errors that already carry their own failureCode, and W-BOOT's typed binding fault, are
 * unchanged. The worker logs the diagnostic next to the stored code.
 *
 * Mock port as in luProjectContextBootstrapBindingFaultBOOT.test.ts; hermetic.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  project: null as unknown,
  projectError: null as Error | null,
  owner: null as unknown,
  mimersError: null as Error | null,
  lookupError: null as Error | null,
  installError: null as Error | null,
  casWrites: [] as string[],
}));

vi.mock('../../server/db/prisma', async () => {
  const guarded = (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule() as { prisma: Record<string | symbol, unknown>; Prisma: object };
  const served: Record<string, unknown> = {
    project: {
      findUnique: async () => {
        if (h.projectError) throw h.projectError;
        return h.project;
      },
    },
    projectMember: { findFirst: async () => h.owner },
    projectContextBootstrapRequest: { count: async () => 0 },
  };
  return { Prisma: guarded.Prisma, prisma: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p in served ? served[p] : guarded.prisma[p]) }) };
});
vi.mock('@miljobeslut/mps-runtime', () => ({
  MimersIntegration: {
    create: async () => {
      if (h.mimersError) throw h.mimersError;
      return {
        artifactRepository: {
          put: async (artifact: { artifact_id: string }) => {
            h.casWrites.push(artifact.artifact_id);
          },
          resolve: async () => {
            throw new Error('never read in this test');
          },
        },
      };
    },
  },
}));
vi.mock('../../server/modules/localization/projectContextBindingRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/modules/localization/projectContextBindingRuntime')>();
  return {
    ...actual,
    ProjectContextBindingProvider: class {
      async resolveCurrent() {
        // Genuine absence, exactly as the real provider reports it: mint may proceed.
        throw new actual.ProjectContextBindingCurrentUnavailableError(true, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings'));
      }
    },
  };
});
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async listSupersessionRefs() {
      return [];
    }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    async listForProject() {
      return [];
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async listForProject() {
      return [];
    }
  },
}));
vi.mock('../../server/modules/localization/projectContextBindingAuthority', () => ({
  attestProjectContextBindingArtifact: async () => ({ signer: 'ed25519:w-catch2-mock-port' }),
  installVerifiedProductLuContext: async () => {
    if (h.installError) throw h.installError;
  },
}));
vi.mock('../../server/security/projectContextBindingIssuerKey', () => ({
  getProjectContextBindingIssuerSigner: () => ({ keyId: 'ed25519:w-catch2-mock-port' }),
  getProjectContextBindingIssuerVerifier: () => ({ keyId: 'ed25519:w-catch2-mock-port' }),
}));
vi.mock('../../server/modules/property/public', () => ({
  lookupPropertyByDesignationFromPostgis: async () => {
    if (h.lookupError) throw h.lookupError;
    return {
      designation: 'GÄVLE CATCH2 1:1',
      matchType: 'exact',
      geometry: { type: 'Polygon', coordinates: [[[17.14, 60.67], [17.15, 60.67], [17.15, 60.68], [17.14, 60.67]]] },
      boundaries: {
        properties: {
          sourceKey: 'lm-catch2-1',
          sourceDataset: 'lm_fastighetsytor',
          sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
          centroidSweref99Tm: [617000, 6730000],
          municipalityName: 'Gävle',
        },
      },
    };
  },
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const spawn = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  return { ...actual, default: { ...(actual.default as object), spawn }, spawn };
});

import { executeProjectContextBootstrap } from '../../server/modules/localization/luProjectContextBootstrap';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const PROJECT_ID = 'proj-w-catch2-bootstrap';
const INPUT = { projectId: PROJECT_ID, propertyDesignation: 'GÄVLE CATCH2 1:1' } as const;
const RAW = /mimer-demo|[A-Za-z]:[\\/]|SELECT|prisma|EIO|WORM|REJECT_|ECONNREFUSED|\.idx/;

beforeEach(() => {
  h.project = { id: PROJECT_ID, organisationId: 'org-1', propertyDesignation: 'GÄVLE CATCH2 1:1' };
  h.projectError = null;
  h.owner = { userId: 'owner-1', user: { id: 'owner-1', organisationId: 'org-1', bankidId: 'b-1', role: 'CONSULTANT', identityEnvironment: 'TEST' } };
  h.mimersError = null;
  h.lookupError = null;
  h.installError = null;
  h.casWrites.length = 0;
});

describe('W-CATCH2 #4: an error without its own failureCode gets a STABLE code by class and a neutral text; the raw text is only an internal diagnostic', () => {
  const cases: Array<[string, () => void, string, boolean, RegExp]> = [
    [
      'the CAS root cannot be opened (raw path in the message)',
      () => { h.mimersError = Object.assign(new Error("EIO: i/o error, scandir 'D:\\mimer-demo\\cas\\objects'"), { code: 'EIO' }); },
      'BOOTSTRAP_EXECUTION_ERROR',
      true,
      /mimer-demo/,
    ],
    [
      'the project row cannot be read (Prisma, SQL in the message)',
      () => {
        h.projectError = Object.assign(new Error('Invalid `prisma.project.findUnique()` invocation: SELECT "id" FROM "projects" -- connection refused'), {
          name: 'PrismaClientKnownRequestError',
          code: 'P1001',
        });
      },
      'BOOTSTRAP_EXECUTION_ERROR',
      true,
      /SELECT/,
    ],
    [
      'an unknown error while minting',
      () => { h.lookupError = new TypeError("Cannot read properties of undefined (reading 'boundaries') at C:\\wt\\server\\x.ts:12"); },
      'BOOTSTRAP_EXECUTION_ERROR',
      true,
      /boundaries/,
    ],
    [
      'another object is already stored under a write-once id while installing',
      () => { h.installError = new Error('WORM violation: project-context-binding-4b6f80d4'); },
      'BOOTSTRAP_STORAGE_INTEGRITY_FAULT',
      false,
      /WORM/,
    ],
    [
      'the index refuses a conflicting binding while installing',
      () => { h.installError = new Error('REJECT_PROJECT_CONTEXT_BINDING_CONFLICT: project/context already has a different binding'); },
      'BOOTSTRAP_REFUSED',
      false,
      /REJECT_PROJECT_CONTEXT_BINDING_CONFLICT/,
    ],
  ];
  for (const [name, arrange, failureCode, retryable, diagnosticPattern] of cases) {
    it(`${name} -> ${failureCode} (retryable ${retryable})`, async () => {
      arrange();
      const outcome = (await executeProjectContextBootstrap(INPUT)) as Record<string, unknown>;
      expect({ ok: outcome.ok, failureCode: outcome.failureCode, retryable: outcome.retryable }).toEqual({ ok: false, failureCode, retryable });
      expect(typeof outcome.failureDetail).toBe('string');
      expect(outcome.failureDetail as string).toMatch(/^Projektkontexten kunde inte etableras/);
      expect(outcome.failureDetail as string).not.toMatch(RAW);
      // The raw text is kept for the server log only.
      expect(outcome.diagnostic as string).toMatch(diagnosticPattern);
      expect(hermeticPrismaTouches).toEqual([]);
    });
  }
});

describe('W-CATCH2 #4: unchanged outcomes', () => {
  it('an error with its own failureCode keeps code and detail (PROJECT_NOT_FOUND), no diagnostic', async () => {
    h.project = null;
    expect(await executeProjectContextBootstrap(INPUT)).toEqual({ ok: false, failureCode: 'PROJECT_NOT_FOUND', failureDetail: `no Project with id ${PROJECT_ID}` });
  });
  it('a typed lookup refusal keeps its own failureCode', async () => {
    h.lookupError = Object.assign(new Error('Fastighet hittades inte i PostGIS: GÄVLE CATCH2 1:1'), { failureCode: 'LOCAL_PROPERTY_NOT_FOUND' });
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome).toEqual({ ok: false, failureCode: 'LOCAL_PROPERTY_NOT_FOUND', failureDetail: 'Fastighet hittades inte i PostGIS: GÄVLE CATCH2 1:1' });
  });
  it('a healthy mint is unchanged', async () => {
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome).toEqual({ ok: true, contextBindingArtifactId: expect.stringMatching(/^project-context-binding-/), reused: false });
  });
});
