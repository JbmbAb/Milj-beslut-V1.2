// @vitest-environment node
// (the bootstrap resolves its fresh-verifier script from import.meta.url, which must be a file: URL)
/**
 * W-BOOT (OD-R1/OD-R2, owner decisions 2026-10-02): the project-context bootstrap may mint a new
 * ProjectContextBinding ONLY when resolving the current binding says exactly "no binding is
 * registered for this project" -- W-APR's `noBindingRegistered` contract, from an empty binding
 * graph -- and the binding index lists no supersession relation for the project either. Every other
 * failure of resolveCurrent (a read error, a lasting storage or integrity fault, a binding that is not
 * in the CAS, a verification refusal, an ambiguous head, a contract-version refusal, anything
 * unknown) is a typed, fail-closed outcome with an honest `retryable` flag and Swedish text, and
 * NOTHING is minted: no property lookup, no signing, no CAS write, no index row, no fresh verifier.
 *
 * Before W-BOOT a catch-all after resolveCurrent read every such failure as "no verified binding
 * yet" and went on to mint, so a project that already has a binding could get a second one -- with
 * another property root -- just because its binding could not be READ.
 *
 * Mock port: resolveCurrent and the binding index are stubbed with errors of the exact shapes the
 * real ProjectContextBindingProvider throws (its own error class, imported unmocked). The real
 * storage chain is luProjectContextBootstrapCasFaultChainBOOT.test.ts. Hermetic: server/db/prisma is
 * the hermetic guard (only the project and owner lookups are served), no CAS, no child process.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  project: null as unknown,
  owner: null as unknown,
  resolveCurrent: (() => undefined) as (projectId: string) => unknown,
  listSupersessionRefs: (() => undefined) as (projectId: string) => unknown,
  /** W-BOOT / APR F2: other index traces of the project (rows that only exist once a binding did). */
  assessmentRows: (() => []) as (projectId: string) => unknown,
  geometryRows: (() => []) as (projectId: string) => unknown,
  bootstrapRequests: [] as Array<{ projectId: string; status: string; contextBindingArtifactId: string | null }>,
  bootstrapRequestsError: null as Error | null,
  calls: {
    resolveCurrent: 0,
    listSupersessionRefs: 0,
    assessmentRows: 0,
    geometryRows: 0,
    bootstrapRequests: 0,
    lookup: 0,
    signer: 0,
    attest: 0,
    install: 0,
    spawn: 0,
  },
  casWrites: [] as string[],
  indexRegistrations: [] as string[],
}));

vi.mock('../../server/db/prisma', async () => {
  const guarded = (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule() as {
    prisma: Record<string | symbol, unknown>;
    Prisma: object;
  };
  // Only the reads the bootstrap itself makes are served; every other property access is the
  // hermetic guard (recorded, throws).
  const served: Record<string, unknown> = {
    project: { findUnique: async () => h.project },
    projectMember: { findFirst: async () => h.owner },
    // W-BOOT / APR F2: the bootstrap queue's own record of a completed bootstrap (with its binding).
    projectContextBootstrapRequest: {
      count: async (args: { where: { projectId?: string; status?: string; contextBindingArtifactId?: { not: null } } }) => {
        h.calls.bootstrapRequests += 1;
        if (h.bootstrapRequestsError) throw h.bootstrapRequestsError;
        // Prisma semantics for the keys the queue uses: an absent key does not filter.
        const w = args.where ?? {};
        return h.bootstrapRequests.filter(
          (r) =>
            (w.projectId === undefined || r.projectId === w.projectId) &&
            (w.status === undefined || r.status === w.status) &&
            (w.contextBindingArtifactId === undefined || r.contextBindingArtifactId !== null),
        ).length;
      },
    },
  };
  return {
    Prisma: guarded.Prisma,
    prisma: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p in served ? served[p] : guarded.prisma[p]) }),
  };
});
vi.mock('@miljobeslut/mps-runtime', () => ({
  MimersIntegration: {
    create: async () => ({
      artifactRepository: {
        put: async (artifact: { artifact_id: string }) => {
          h.casWrites.push(artifact.artifact_id);
        },
        resolve: async () => {
          throw new Error('W-BOOT mock port: the bootstrap itself never reads the CAS');
        },
      },
    }),
  },
}));
vi.mock('../../server/modules/localization/projectContextBindingRuntime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ProjectContextBindingProvider: class {
    async resolveCurrent(projectId: string) {
      h.calls.resolveCurrent += 1;
      return h.resolveCurrent(projectId);
    }
  },
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async register(binding: { artifact_id: string }) {
      h.indexRegistrations.push(binding.artifact_id);
    }
    async listSupersessionRefs(projectId: string) {
      h.calls.listSupersessionRefs += 1;
      return h.listSupersessionRefs(projectId);
    }
    async listBindingRefs() {
      throw new Error('W-BOOT mock port: listBindingRefs belongs to resolveCurrent');
    }
    async resolve() {
      throw new Error('W-BOOT mock port: resolve is not part of the bootstrap');
    }
    async findProjectContextRef() {
      throw new Error('W-BOOT mock port: findProjectContextRef is not part of the bootstrap');
    }
  },
}));
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    async listForProject(projectId: string) {
      h.calls.assessmentRows += 1;
      return h.assessmentRows(projectId);
    }
    async register() {
      throw new Error('W-BOOT mock port: the bootstrap never registers an assessment');
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async listForProject(projectId: string) {
      h.calls.geometryRows += 1;
      return h.geometryRows(projectId);
    }
    async register() {
      throw new Error('W-BOOT mock port: the bootstrap never registers a geometry');
    }
  },
}));
vi.mock('../../server/modules/localization/projectContextBindingAuthority', () => ({
  attestProjectContextBindingArtifact: async () => {
    h.calls.attest += 1;
    return { signer: 'ed25519:w-boot-mock-port' };
  },
  installVerifiedProductLuContext: async (args: { contextBinding: { artifact_id: string } }) => {
    h.calls.install += 1;
    h.indexRegistrations.push(args.contextBinding.artifact_id);
  },
}));
vi.mock('../../server/security/projectContextBindingIssuerKey', () => ({
  getProjectContextBindingIssuerSigner: () => {
    h.calls.signer += 1;
    return { keyId: 'ed25519:w-boot-mock-port' };
  },
  getProjectContextBindingIssuerVerifier: () => ({ keyId: 'ed25519:w-boot-mock-port' }),
}));
vi.mock('../../server/modules/property/public', () => ({
  lookupPropertyByDesignationFromPostgis: async () => {
    h.calls.lookup += 1;
    return {
      designation: 'GÄVLE BOOT 1:1',
      matchType: 'exact',
      geometry: { type: 'Polygon', coordinates: [[[17.14, 60.67], [17.15, 60.67], [17.15, 60.68], [17.14, 60.67]]] },
      boundaries: {
        properties: {
          sourceKey: 'lm-boot-1',
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
    h.calls.spawn += 1;
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  return { ...actual, default: { ...(actual.default as object), spawn }, spawn };
});

import { executeProjectContextBootstrap } from '../../server/modules/localization/luProjectContextBootstrap';
import { ProjectContextBindingCurrentUnavailableError } from '../../server/modules/localization/projectContextBindingRuntime';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const PROJECT_ID = 'proj-w-boot';
const INPUT = { projectId: PROJECT_ID, propertyDesignation: 'GÄVLE BOOT 1:1' } as const;

/** The refusal the real resolveCurrent wraps when the index lists no binding at all (empty graph). */
const emptyGraph = () => new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings');
const unavailable = (noBindingRegistered: boolean, cause: unknown) =>
  new ProjectContextBindingCurrentUnavailableError(noBindingRegistered, cause);
const fsError = (code: string) =>
  Object.assign(new Error(`${code}: i/o error, read 'C:\\mimers\\cas\\artifact-id-index\\0a1b.idx'`), { code });
const indexReadFailed = (reason: 'IO' | 'MALFORMED') =>
  Object.assign(
    new Error(`MIMERS_ARTIFACT_INDEX_READ_FAILED: the id->hash index entry for artifact 'project-context-binding-abc' exists but could not be read (${reason})`),
    { code: 'MIMERS_ARTIFACT_INDEX_READ_FAILED', reason },
  );
const objectMissing = () =>
  Object.assign(new Error("MIMERS_ARTIFACT_OBJECT_MISSING: the id->hash index entry for artifact 'project-context-binding-abc' names CAS object 'f00d'"), {
    code: 'MIMERS_ARTIFACT_OBJECT_MISSING',
  });
const corruptBytes = () => Object.assign(new Error('CAS object bytes do not match their address'), { name: 'CASIntegrityError' });

type Expected = {
  readonly failureCode: 'CURRENT_BINDING_READ_ERROR' | 'CURRENT_BINDING_INTEGRITY_FAULT' | 'CURRENT_BINDING_REFUSED';
  readonly reason: 'READ_ERROR' | 'STORAGE_INTEGRITY_FAULT' | 'MISSING_FROM_CAS' | 'REFUSED' | 'BINDING_INDEX_INCONSISTENT';
  readonly retryable: boolean;
  readonly refusalCode: string | null;
};
const READ: Expected = { failureCode: 'CURRENT_BINDING_READ_ERROR', reason: 'READ_ERROR', retryable: true, refusalCode: null };
const STORAGE: Expected = { failureCode: 'CURRENT_BINDING_INTEGRITY_FAULT', reason: 'STORAGE_INTEGRITY_FAULT', retryable: false, refusalCode: null };
const MISSING: Expected = { failureCode: 'CURRENT_BINDING_INTEGRITY_FAULT', reason: 'MISSING_FROM_CAS', retryable: false, refusalCode: null };
const refused = (refusalCode: string): Expected => ({ failureCode: 'CURRENT_BINDING_REFUSED', reason: 'REFUSED', retryable: false, refusalCode });
const INCONSISTENT: Expected = { failureCode: 'CURRENT_BINDING_INTEGRITY_FAULT', reason: 'BINDING_INDEX_INCONSISTENT', retryable: false, refusalCode: null };

const NO_NEW_BINDING =
  'Ingen ny bindning skapades, eftersom projektet redan kan ha en och en ny då skulle kunna ge det en andra fastighetsrot.';
const RETRYABLE = 'Ett nytt försök kan lyckas.';
const LASTING = 'Felet är bestående och löses inte av ett nytt försök. Kontakta systemets administratör.';
/** The complete Swedish text per class (the outcome's failureDetail, which the bootstrap-status API shows). */
const TEXT: Record<Expected['reason'], string> = {
  READ_ERROR: `Projektkontexten kunde inte etableras: projektets befintliga bindning kunde inte läsas (tekniskt fel). ${NO_NEW_BINDING} ${RETRYABLE}`,
  STORAGE_INTEGRITY_FAULT: `Projektkontexten kunde inte etableras: projektets befintliga bindning kunde inte läsas eller verifieras ur CAS (bestående lagrings- eller integritetsfel). ${NO_NEW_BINDING} ${LASTING}`,
  MISSING_FROM_CAS: `Projektkontexten kunde inte etableras: projektets befintliga bindning kunde inte läsas eller verifieras ur CAS (bestående lagrings- eller integritetsfel). ${NO_NEW_BINDING} ${LASTING}`,
  REFUSED: `Projektkontexten kunde inte etableras: projektets befintliga bindning underkändes vid verifieringen (utfärdare, signatur, innehåll, kontraktsversion eller ersättningskedja). ${NO_NEW_BINDING} ${LASTING}`,
  BINDING_INDEX_INCONSISTENT: `Projektkontexten kunde inte etableras: projektets bindningsindex är inkonsekvent: indexen visar att en bindning har funnits, men den saknas, är dubblerad eller hör till ett annat projekt (bestående integritetsfel). ${NO_NEW_BINDING} ${LASTING}`,
};

function nothingMinted(): void {
  expect(h.calls.lookup, 'no property lookup').toBe(0);
  expect(h.calls.signer, 'no signing key loaded').toBe(0);
  expect(h.calls.attest, 'nothing signed').toBe(0);
  expect(h.calls.install, 'nothing installed').toBe(0);
  expect(h.calls.spawn, 'no fresh verifier').toBe(0);
  expect(h.casWrites, 'no CAS write').toEqual([]);
  expect(h.indexRegistrations, 'no index row').toEqual([]);
  expect(hermeticPrismaTouches).toEqual([]);
}

async function expectTypedNoMint(expected: Expected): Promise<void> {
  const outcome = await executeProjectContextBootstrap(INPUT);
  expect(outcome).toEqual({
    ok: false,
    failureCode: expected.failureCode,
    failureDetail: TEXT[expected.reason],
    retryable: expected.retryable,
    reason: expected.reason,
    refusalCode: expected.refusalCode,
  });
  nothingMinted();
}

beforeEach(() => {
  h.project = { id: PROJECT_ID, organisationId: 'org-w-boot', propertyDesignation: 'GÄVLE BOOT 1:1' };
  h.owner = {
    userId: 'user-w-boot',
    user: { id: 'user-w-boot', organisationId: 'org-w-boot', bankidId: 'bankid:w-boot', role: 'CONSULTANT', identityEnvironment: 'TEST' },
  };
  h.listSupersessionRefs = () => [];
  h.assessmentRows = () => [];
  h.geometryRows = () => [];
  h.bootstrapRequests.length = 0;
  h.bootstrapRequestsError = null;
  for (const key of Object.keys(h.calls) as Array<keyof typeof h.calls>) h.calls[key] = 0;
  h.casWrites.length = 0;
  h.indexRegistrations.length = 0;
  hermeticPrismaTouches.length = 0;
});

describe('W-BOOT: a binding that exists but cannot be resolved is never replaced by a newly minted one', () => {
  const cases: ReadonlyArray<readonly [string, () => unknown, Expected]> = [
    ['the binding index cannot be read (EIO)', () => unavailable(false, fsError('EIO')), READ],
    ['the binding index database is unreachable (ECONNREFUSED)', () => unavailable(false, fsError('ECONNREFUSED')), READ],
    ["a binding's CAS index entry exists but could not be read (IO)", () => unavailable(false, indexReadFailed('IO')), READ],
    ["a binding's CAS index entry is torn (MALFORMED)", () => unavailable(false, indexReadFailed('MALFORMED')), STORAGE],
    ["a binding's CAS object is missing behind its index entry", () => unavailable(false, objectMissing()), STORAGE],
    ["a binding's stored bytes are corrupt (CASIntegrityError)", () => unavailable(false, corruptBytes()), STORAGE],
    ['a registered binding is not in the CAS at all', () => unavailable(false, new Error('Artifact not found: project-context-binding-abc')), MISSING],
    [
      "a binding's issuer signature is refused",
      () => unavailable(false, new Error('REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SIGNATURE')),
      refused('REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SIGNATURE'),
    ],
    [
      "a binding's contract version is refused",
      () => unavailable(false, new Error("REJECT_PROJECT_CONTEXT_BINDING: unknown binding_contract_version 'V9'")),
      refused('REJECT_PROJECT_CONTEXT_BINDING'),
    ],
    [
      'the binding graph has two heads (ambiguous)',
      () => unavailable(false, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: ambiguous head')),
      refused('REJECT_PROJECT_CONTEXT_BINDING_HEAD'),
    ],
    [
      'the binding graph forks',
      () => unavailable(false, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: fork')),
      refused('REJECT_PROJECT_CONTEXT_BINDING_HEAD'),
    ],
    ['resolveCurrent fails with an unknown error', () => new TypeError("Cannot read properties of undefined (reading 'payload')"), READ],
    [
      'the old refusal message without the noBindingRegistered contract',
      () => new Error('REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE'),
      refused('REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE'),
    ],
    // W-CATCH2 (shared classification, W-BOOT verifier finding 3): an empty-graph cause OUTSIDE the
    // provider's strict absence contract is an index that contradicts itself (the real provider only ever
    // gives it with the flag strictly true; with the flag off it means the same binding listed twice) --
    // a lasting integrity fault, still never a mint. Before: REFUSED (REJECT_PROJECT_CONTEXT_BINDING_HEAD).
    [
      "another refusal than the provider's own, even with noBindingRegistered and an empty-graph cause",
      () => Object.assign(new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE', { cause: emptyGraph() }), { noBindingRegistered: true }),
      INCONSISTENT,
    ],
    [
      'noBindingRegistered is not strictly true',
      () => Object.assign(new Error('REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE', { cause: emptyGraph() }), { noBindingRegistered: 'true' }),
      INCONSISTENT,
    ],
    // W-APR sets noBindingRegistered as soon as the index lists no binding, even when a supersession
    // relation of the project then fails: that is not an empty graph, and never a reason to mint.
    ['no binding listed, but a supersession relation could not be read (EIO)', () => unavailable(true, fsError('EIO')), READ],
    ['no binding listed, but a supersession object is missing', () => unavailable(true, objectMissing()), STORAGE],
    [
      'no binding listed, but a supersession relation is refused',
      () => unavailable(true, new Error('REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TYPE')),
      refused('REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TYPE'),
    ],
  ];

  for (const [name, error, expected] of cases) {
    it(`${name} -> ${expected.failureCode} (${expected.reason}, retryable ${expected.retryable}); nothing minted`, async () => {
      h.resolveCurrent = () => {
        throw error();
      };
      await expectTypedNoMint(expected);
      expect(h.calls.resolveCurrent).toBe(1);
    });
  }

  it('an empty binding graph while the index still lists a supersession relation (binding rows lost) -> integrity fault, nothing minted', async () => {
    h.resolveCurrent = () => {
      throw unavailable(true, emptyGraph());
    };
    h.listSupersessionRefs = () => [{ artifact_id: 'project-context-binding-supersession-abc', artifact_type: 'project_context_binding_supersession' }];
    await expectTypedNoMint(INCONSISTENT);
    expect(h.calls.listSupersessionRefs).toBe(1);
  });

  it('an empty binding graph but the supersession index cannot be read -> read error, nothing minted', async () => {
    h.resolveCurrent = () => {
      throw unavailable(true, emptyGraph());
    };
    h.listSupersessionRefs = () => {
      throw fsError('ECONNRESET');
    };
    await expectTypedNoMint(READ);
    expect(h.calls.listSupersessionRefs).toBe(1);
  });

  // W-BOOT / APR verifier F2: "no binding registered" only when NOTHING in the indexes shows that the
  // project ever had one. Each of these rows exists only once a binding did (append-only indexes;
  // assessment rows carry a NOT NULL binding id; a geometry is saved under the canonical context;
  // a COMPLETED bootstrap request records its binding).
  it('the binding provider reports supersession rows without any binding row (typed cause) -> integrity fault, nothing minted', async () => {
    h.resolveCurrent = () => {
      throw unavailable(false, Object.assign(new Error('PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT: supersession relations without any binding'), {
        code: 'PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT',
      }));
    };
    await expectTypedNoMint(INCONSISTENT);
  });

  const TRACES: ReadonlyArray<readonly [string, () => void]> = [
    ['an assessment projection row (it names a binding)', () => {
      h.assessmentRows = () => [{ projectId: PROJECT_ID, assessmentArtifactId: 'assessment-abc', bindingArtifactId: 'project-context-binding-lost' }];
    }],
    ['a localization geometry row (saved under the canonical context)', () => {
      h.geometryRows = () => [{ projectId: PROJECT_ID, geometryArtifactId: 'localization-geometry-abc' }];
    }],
    ['an earlier COMPLETED bootstrap request with its binding', () => {
      h.bootstrapRequests.push({ projectId: PROJECT_ID, status: 'COMPLETED', contextBindingArtifactId: 'project-context-binding-lost' });
    }],
  ];
  for (const [trace, arrange] of TRACES) {
    it(`empty binding graph, no supersession row, but ${trace} remains -> integrity fault (lost binding rows), nothing minted`, async () => {
      h.resolveCurrent = () => {
        throw unavailable(true, emptyGraph());
      };
      arrange();
      await expectTypedNoMint(INCONSISTENT);
    });
  }

  const TRACE_READ_ERRORS: ReadonlyArray<readonly [string, () => void]> = [
    ['the assessment projection index', () => {
      h.assessmentRows = () => {
        throw fsError('ECONNRESET');
      };
    }],
    ['the localization geometry index', () => {
      h.geometryRows = () => {
        throw fsError('ECONNRESET');
      };
    }],
    ['the bootstrap request queue', () => {
      h.bootstrapRequestsError = fsError('ECONNRESET');
    }],
  ];
  for (const [what, arrange] of TRACE_READ_ERRORS) {
    it(`empty binding graph but ${what} cannot be read -> read error (retryable), nothing minted`, async () => {
      h.resolveCurrent = () => {
        throw unavailable(true, emptyGraph());
      };
      arrange();
      await expectTypedNoMint(READ);
    });
  }

  it('the Swedish text names no artifact id, path, storage code or REJECT_* token', async () => {
    h.resolveCurrent = () => {
      throw unavailable(false, objectMissing());
    };
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome.ok).toBe(false);
    const detail = 'failureDetail' in outcome ? outcome.failureDetail : '';
    expect(detail).not.toMatch(/REJECT_|MIMERS_|EIO|ECONN|Artifact not found|project-context-binding|[\\/]|f00d/);
  });
});

describe('W-BOOT: genuine absence and an existing binding behave exactly as before', () => {
  it('no binding registered (empty graph) and no supersession relation -> the bootstrap mints exactly once', async () => {
    h.resolveCurrent = () => {
      throw unavailable(true, emptyGraph());
    };
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome).toEqual({ ok: true, contextBindingArtifactId: expect.stringMatching(/^project-context-binding-/), reused: false });
    expect(h.calls.lookup).toBe(1);
    expect(h.calls.install).toBe(1);
    expect(h.calls.spawn).toBe(1);
    expect(h.indexRegistrations).toEqual([outcome.ok ? outcome.contextBindingArtifactId : '']);
    expect(hermeticPrismaTouches).toEqual([]);
  });

  it('genuine absence consults every index trace once; a FAILED or still-running earlier request is not a trace', async () => {
    h.resolveCurrent = () => {
      throw unavailable(true, emptyGraph());
    };
    h.bootstrapRequests.push(
      { projectId: PROJECT_ID, status: 'FAILED', contextBindingArtifactId: null },
      { projectId: PROJECT_ID, status: 'LEASED', contextBindingArtifactId: null },
      { projectId: 'another-project', status: 'COMPLETED', contextBindingArtifactId: 'project-context-binding-other' },
    );
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome).toMatchObject({ ok: true, reused: false });
    expect({
      supersessions: h.calls.listSupersessionRefs,
      assessmentRows: h.calls.assessmentRows,
      geometryRows: h.calls.geometryRows,
      bootstrapRequests: h.calls.bootstrapRequests,
    }).toEqual({ supersessions: 1, assessmentRows: 1, geometryRows: 1, bootstrapRequests: 1 });
  });

  it('a verified current binding -> reused, nothing minted', async () => {
    h.resolveCurrent = () => ({ artifact_id: 'project-context-binding-existing-xyz' });
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome).toEqual({ ok: true, contextBindingArtifactId: 'project-context-binding-existing-xyz', reused: true });
    nothingMinted();
    expect(h.calls.listSupersessionRefs).toBe(0);
  });

  it('failures before the binding step keep their outcome shape (no retryable/reason fields)', async () => {
    h.owner = null;
    const outcome = await executeProjectContextBootstrap(INPUT);
    expect(outcome).toEqual({
      ok: false,
      failureCode: 'NO_LEGITIMATE_OWNER',
      failureDetail: `project ${PROJECT_ID} has no real ProjectMember{OWNER} -- refusing to bootstrap`,
    });
    expect(h.calls.resolveCurrent).toBe(0);
  });
});
