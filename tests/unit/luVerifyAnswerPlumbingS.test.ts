/**
 * W-PLUMB-S -- the verify ROUTE's side of the owner decision 2026-10-02 (BINDING): a PASS over a V1/legacy-unbound form
 * must never look like the same green verification as a fully bound V4 (U30R6-REPORT K4, K5, K20, K21; U30R5-VERIFICATION
 * finding 4).
 *
 *  1. The route re-derives the answer's presentation from the answer's own machine fields with the server's one
 *     presentation function (classifyVerifyPresentation of the package root) and requires the orchestrator's claim to
 *     agree: a missing, unknown or contradicting presentation, strength or notice is NOT_VERIFIED, the strength null,
 *     the main text neutral -- never green, never the green sentence.
 *  2. The bootstrap-flag gate runs BEFORE any database or CAS read of the route -- also before authentication, whose
 *     token check reads the database: MPS_LU_BOOTSTRAP_ADMIT set outside an explicit test process is the typed 503
 *     configuration error (code BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST, retryable false, a fixed Swedish text), never a
 *     401/404/409/424 or a sanitized 500. The same refusal thrown later (H15's own gate) is the same 503.
 *  3. presentVerifyResult (the orchestrator's step) over every form of result: its class is the package's class of the
 *     result AND of the answer's JSON.
 *
 * Hermetic: server/db/prisma is the throwing guard; the orchestrator's verify is replaced by a controllable stand-in
 * (the real one is exercised by luGovernedEvidenceDetailsU20D / verifyCurrentLuAssessment); tokens are minted locally.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  verify: null as null | ((input: unknown) => Promise<unknown>),
  verifyCalls: 0,
  isTokenRevoked: 0,
  casOpened: 0,
  membership: 0,
  /** W-PLUMB-S mutant S16: a gate check that fails in an unexpected way. */
  gateOverride: null as null | (() => void),
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => {
    h.isTokenRevoked += 1;
    return false;
  }),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => {
    h.membership += 1;
  }),
}));
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: {
    create: vi.fn(async () => {
      h.casOpened += 1;
      throw new Error('CAS is not part of this test');
    }),
  },
}));
vi.mock('../../server/modules/localization/localizationOrchestrator', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    verifyCurrentLuAssessment: async (input: unknown) => {
      h.verifyCalls += 1;
      if (!h.verify) throw new Error('no verify stand-in');
      return h.verify(input);
    },
  };
});
vi.mock('../../server/modules/localization/verifyPresentation', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const realGate = original.assertVerifyBootstrapFlagGate as (...args: unknown[]) => void;
  return {
    ...original,
    assertVerifyBootstrapFlagGate: (...args: unknown[]) => (h.gateOverride ? h.gateOverride() : realGate(...args)),
  };
});
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { assertBootstrapAdmitFlagOnlyInExplicitTestProcess, classifyVerifyPresentation } from '@miljobeslut/mps-lu';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import * as localizationPublic from '../../server/modules/localization/public';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const PROJECT_ID = 'project-w-plumbs';
const OWNER_TEXT_SV =
  'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';
const GREEN_SV = 'Reproducerbarhet verifierad – resultatet matchar de pinnade artefakterna.';
const NEUTRAL_SV =
  'Reproducerbarheten kan inte visas som verifierad: kontrollens svar är ofullständigt eller motsägelsefullt (utfall, ' +
  'bindningsstyrka eller obligatorisk notis saknas eller stämmer inte överens). Det är inget fynd om att underlaget har ändrats.';
const DENY_SV = 'Reproducerbarheten kunde inte bekräftas: återexekveringen gav inte samma resultat som den sparade bedömningen.';
const CONFIGURATION_SV =
  'Verifieringen kunde inte genomföras: servern har ett konfigurationsfel (en flagga som bara får vara satt i en uttrycklig ' +
  'testprocess är satt). Det är inget kontrollutfall och inget fel i bedömningen. Felet är bestående och löses inte av ett nytt försök.';

const legacyNotice = (overrides: Record<string, unknown> = {}) => ({
  code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', basis: 'V1_FORM', authenticity_verified: false, current_authority_verified: false,
  text_sv: OWNER_TEXT_SV, finding_ids: [], detail: 'x', ...overrides,
});
const notCheckedNotice = { code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: ['finding-notchecked-water'], detail: 'x' };

const app = express();
app.use(express.json());
app.use(localizationRoutes);
const token = () => createTokenPair({ id: 'user-w-plumbs', organisationId: 'org-w-plumbs', bankidId: 'bankid:w-plumbs', role: 'ADMIN' }).accessToken;
const post = (withToken = true) => {
  const r = request(app).post(`/api/localization/${PROJECT_ID}/verify-assessment`);
  return (withToken ? r.set('Authorization', `Bearer ${token()}`) : r).send({});
};

const ENV_KEYS = ['MPS_LU_BOOTSTRAP_ADMIT', 'NODE_ENV', 'APP_ENV'] as const;
const savedEnv = new Map<string, string | undefined>();
function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  setEnv({ MPS_LU_BOOTSTRAP_ADMIT: undefined, NODE_ENV: 'test', APP_ENV: undefined });
  h.verify = null;
  h.gateOverride = null;
  h.verifyCalls = 0;
  h.isTokenRevoked = 0;
  h.casOpened = 0;
  h.membership = 0;
  hermeticPrismaTouches.length = 0;
});
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  expect(hermeticPrismaTouches).toEqual([]);
});

/** What the real orchestrator returns for a re-execution result (its own last step). */
function orchestratorAnswer(result: Record<string, unknown>) {
  const present = (localizationPublic as Record<string, unknown>).presentVerifyResult as ((r: unknown) => Record<string, unknown>) | undefined;
  expect(typeof present, 'presentVerifyResult is exported by the localization module facade').toBe('function');
  return { ok: true, assessmentArtifactId: 'assessment-w-plumbs', ...present!(result) };
}

describe('W-PLUMB-S (K4, K21): the route re-derives the presentation and fails closed', () => {
  it.each<[string, () => Record<string, unknown>, string, string | null, string]>([
    ['a well-formed fully bound answer (control)', () => orchestratorAnswer({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [] }),
      'FULLY_BOUND_GREEN', 'FULLY_BOUND', GREEN_SV],
    ['a well-formed legacy-unbound answer (control)', () => orchestratorAnswer({ outcome: 'PASS', verification_binding: 'LEGACY_UNBOUND_FORM', mismatches: [], notices: [legacyNotice(), notCheckedNotice] }),
      'LEGACY_UNBOUND_NOTICE', 'LEGACY_UNBOUND_FORM', OWNER_TEXT_SV],
    ['the answer shape from before U30-R6 (no strength, no presentation, the green sentence)',
      () => ({ ok: true, outcome: 'PASS', assessmentArtifactId: 'a', mismatches: [], notices: [], outcome_sv: GREEN_SV }), 'NOT_VERIFIED', null, NEUTRAL_SV],
    ['a green claim without a strength',
      () => ({ ok: true, outcome: 'PASS', assessmentArtifactId: 'a', mismatches: [], notices: [], presentation: 'FULLY_BOUND_GREEN', outcome_sv: GREEN_SV }), 'NOT_VERIFIED', null, NEUTRAL_SV],
    ['a green claim over legacy-unbound fields',
      () => ({ ...orchestratorAnswer({ outcome: 'PASS', verification_binding: 'LEGACY_UNBOUND_FORM', mismatches: [], notices: [legacyNotice()] }), presentation: 'FULLY_BOUND_GREEN', outcome_sv: GREEN_SV }),
      'NOT_VERIFIED', null, NEUTRAL_SV],
    ['a NOT_VERIFIED claim over well-formed fully bound fields (the claim is kept: never upgraded)',
      () => ({ ...orchestratorAnswer({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [] }), presentation: 'NOT_VERIFIED' }),
      'NOT_VERIFIED', null, NEUTRAL_SV],
    ['a notice claim whose notice text is the green sentence',
      () => ({ ok: true, outcome: 'PASS', assessmentArtifactId: 'a', mismatches: [], notices: [legacyNotice({ text_sv: GREEN_SV })], verification_binding: 'LEGACY_UNBOUND_FORM', presentation: 'LEGACY_UNBOUND_NOTICE', outcome_sv: OWNER_TEXT_SV }),
      'NOT_VERIFIED', null, NEUTRAL_SV],
    ['an unknown presentation value',
      () => ({ ...orchestratorAnswer({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [] }), presentation: 'GREEN' }), 'NOT_VERIFIED', null, NEUTRAL_SV],
    // W-PLUMB-S mutant S08 survived without this: fields that serialize differently than they read (a toJSON putting the
    // legacy notice into the JSON beside FULLY_BOUND) are never green, whatever the orchestrator claims.
    ['a green claim whose notices serialize to the legacy notice',
      () => ({ ok: true, outcome: 'PASS', assessmentArtifactId: 'a', mismatches: [], notices: Object.assign([] as unknown[], { toJSON: () => [legacyNotice()] }),
        verification_binding: 'FULLY_BOUND', presentation: 'FULLY_BOUND_GREEN', outcome_sv: GREEN_SV }),
      'NOT_VERIFIED', null, NEUTRAL_SV],
    ['a DENY that claims green',
      () => ({ ok: true, outcome: 'DENY', assessmentArtifactId: 'a', mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 'x' }], notices: [], verification_binding: 'FULLY_BOUND', presentation: 'FULLY_BOUND_GREEN', outcome_sv: GREEN_SV }),
      'NOT_VERIFIED', null, DENY_SV],
  ])('%s', async (_label, answer, presentation, binding, outcomeSv) => {
    h.verify = async () => answer();
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, presentation, verification_binding: binding, outcome_sv: outcomeSv });
    // The route's JSON classifies exactly as it says, with the package's own classifier.
    expect(classifyVerifyPresentation(res.body)).toBe(presentation);
    if (presentation !== 'FULLY_BOUND_GREEN') expect(res.body.outcome_sv).not.toContain('Reproducerbarhet verifierad');
  });
});

describe('W-PLUMB-S (U30R5-VERIFICATION finding 4, K5): the bootstrap-flag gate comes before any database or CAS read', () => {
  it.each([
    ['development, flag "1", with a token', { MPS_LU_BOOTSTRAP_ADMIT: '1', NODE_ENV: 'development', APP_ENV: undefined }, true],
    ['production, empty flag, with a token', { MPS_LU_BOOTSTRAP_ADMIT: '', NODE_ENV: 'production', APP_ENV: 'production' }, true],
    ['test without APP_ENV, flag "1", WITHOUT a token (the gate precedes authentication)', { MPS_LU_BOOTSTRAP_ADMIT: '1', NODE_ENV: 'test', APP_ENV: undefined }, false],
    ['APP_ENV "staging-zz9", flag "0"', { MPS_LU_BOOTSTRAP_ADMIT: '0', NODE_ENV: 'test', APP_ENV: 'staging-zz9' }, true],
  ] as const)('%s -> 503 BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST, nothing read', async (_label, env, withToken) => {
    h.verify = async () => orchestratorAnswer({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [] });
    const t = withToken ? token() : null;
    setEnv(env);
    const req = request(app).post(`/api/localization/${PROJECT_ID}/verify-assessment`);
    const res = await (t ? req.set('Authorization', `Bearer ${t}`) : req).send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, code: 'BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST', retryable: false, error: CONFIGURATION_SV });
    expect({ tokenChecks: h.isTokenRevoked, verifyCalls: h.verifyCalls, casOpened: h.casOpened, membership: h.membership }).toEqual({
      tokenChecks: 0, verifyCalls: 0, casOpened: 0, membership: 0,
    });
    // A fixed text: no environment value, no variable name, no English refusal message.
    expect(JSON.stringify(res.body)).not.toMatch(/staging-zz9|MPS_LU|NODE_ENV|APP_ENV|development|production|refuses/);
  });

  it('an explicit test process with the flag, and any process without it, passes the gate (control)', async () => {
    h.verify = async () => orchestratorAnswer({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [] });
    for (const env of [
      { MPS_LU_BOOTSTRAP_ADMIT: '1', NODE_ENV: 'test', APP_ENV: 'test' },
      { MPS_LU_BOOTSTRAP_ADMIT: '1', NODE_ENV: 'test', APP_ENV: 'ci' },
      { MPS_LU_BOOTSTRAP_ADMIT: undefined, NODE_ENV: 'production', APP_ENV: 'production' },
    ]) {
      const t = token();
      setEnv(env);
      const res = await request(app).post(`/api/localization/${PROJECT_ID}/verify-assessment`).set('Authorization', `Bearer ${t}`).send({});
      expect(res.status, JSON.stringify(env)).toBe(200);
      expect(res.body.presentation).toBe('FULLY_BOUND_GREEN');
    }
    expect(h.verifyCalls).toBe(3);
  });

  it('a gate check that fails in any other way fails closed: a technical error, never verify (W-PLUMB-S mutant S16)', async () => {
    h.verify = async () => orchestratorAnswer({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [] });
    h.gateOverride = () => {
      throw new TypeError('the gate could not be evaluated');
    };
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body ?? {})).not.toMatch(/FULLY_BOUND_GREEN|Reproducerbarhet verifierad/);
    expect({ tokenChecks: h.isTokenRevoked, verifyCalls: h.verifyCalls, casOpened: h.casOpened }).toEqual({ tokenChecks: 0, verifyCalls: 0, casOpened: 0 });
  });

  it('the same refusal thrown INSIDE verify (H15\'s own gate, e.g. after the environment changed) is the same typed 503, never a sanitized 500', async () => {
    h.verify = async () => {
      assertBootstrapAdmitFlagOnlyInExplicitTestProcess({ MPS_LU_BOOTSTRAP_ADMIT: '1', NODE_ENV: 'production' }, 'reexecution');
      throw new Error('unreachable');
    };
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, code: 'BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST', retryable: false, error: CONFIGURATION_SV });
  });

  it('the refusal of another gate than verify keeps the code and the class of the error, with a neutral lead', async () => {
    h.verify = async () => {
      assertBootstrapAdmitFlagOnlyInExplicitTestProcess({ MPS_LU_BOOTSTRAP_ADMIT: '1', NODE_ENV: 'production' }, 'canonical_product_assessment');
      throw new Error('unreachable');
    };
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false, code: 'BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST', retryable: false,
      error: CONFIGURATION_SV.replace('Verifieringen kunde inte genomföras', 'Begäran kunde inte genomföras'),
    });
  });
});

describe('W-PLUMB-S (K3, K21): presentVerifyResult -- the orchestrator\'s one presentation step', () => {
  it('over every form of result its class is the package\'s class of the result and of the answer\'s own JSON; null strength unless presented', () => {
    const present = (localizationPublic as Record<string, unknown>).presentVerifyResult as ((r: unknown) => Record<string, unknown>) | undefined;
    expect(typeof present).toBe('function');
    const OUTCOMES = ['PASS', 'DENY', 'pass', undefined];
    const BINDINGS = ['FULLY_BOUND', 'LEGACY_UNBOUND_FORM', null, undefined, 'UNKNOWN'];
    const MISMATCHES = [[], [{ code: 'FINDINGS_MISMATCH', detail: 'x' }], undefined];
    const NOTICES = [[], [legacyNotice()], [legacyNotice({ basis: 'LEGACY_UNBOUND' }), notCheckedNotice], [notCheckedNotice], [notCheckedNotice, legacyNotice()],
      [legacyNotice({ authenticity_verified: true })], [{ code: 'SOMETHING_NEW' }], undefined, 'x'];
    const seen = new Set<string>();
    for (const outcome of OUTCOMES) for (const verification_binding of BINDINGS) for (const mismatches of MISMATCHES) for (const notices of NOTICES) {
      const result: Record<string, unknown> = { outcome, verification_binding, mismatches, notices, assessment_artifact_id: 'a', fresh_findings: [], fresh_rule_refs: [] };
      for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key];
      const answer = present!(result);
      const expected = classifyVerifyPresentation(result);
      seen.add(expected);
      expect(answer.presentation, JSON.stringify(result)).toBe(expected);
      expect(classifyVerifyPresentation(JSON.parse(JSON.stringify(answer))), JSON.stringify(result)).toBe(expected);
      if (expected === 'NOT_VERIFIED') expect(answer.verification_binding).toBeNull();
      else expect(answer.verification_binding).toBe(result.verification_binding);
      expect(Array.isArray(answer.mismatches) && Array.isArray(answer.notices)).toBe(true);
      expect(typeof answer.outcome_sv).toBe('string');
      if (expected === 'LEGACY_UNBOUND_NOTICE') expect(answer.outcome_sv).toBe(OWNER_TEXT_SV);
      if (expected !== 'FULLY_BOUND_GREEN') expect(answer.outcome_sv).not.toContain('Reproducerbarhet verifierad');
      if (expected === 'NOT_VERIFIED' && outcome === 'DENY') expect(answer.outcome_sv).toBe(DENY_SV);
      if (expected === 'NOT_VERIFIED' && outcome !== 'DENY') expect(answer.outcome_sv).toBe(NEUTRAL_SV);
    }
    expect([...seen].sort()).toEqual(['FULLY_BOUND_GREEN', 'LEGACY_UNBOUND_NOTICE', 'NOT_VERIFIED']);
  });

  it('a DENY gets the EXECUTION_SUBJECT_UNBOUND text only when that is its one and only deviation (W-PLUMB-S mutant S06)', () => {
    const present = (localizationPublic as Record<string, unknown>).presentVerifyResult as ((r: unknown) => Record<string, unknown>) | undefined;
    expect(typeof present).toBe('function');
    const UNBOUND_SV =
      'Reproducerbarheten kan inte bekräftas: körningen bakom bedömningen saknar ett styrt exekveringssubjekt (äldre eller ' +
      'obunden körningsform) och kan inte bindas till bedömningen. Resultatet påstår inte att underlaget har ändrats.';
    const unbound = { code: 'EXECUTION_SUBJECT_UNBOUND', detail: 'execution subject binding: x', text_sv: UNBOUND_SV };
    const deny = (mismatches: unknown[]) => present!({ outcome: 'DENY', verification_binding: null, mismatches, notices: [] });
    expect(deny([unbound]).outcome_sv).toBe(UNBOUND_SV);
    expect(deny([unbound, { code: 'MANIFEST_ATTEMPT_MISMATCH', detail: 'x' }]).outcome_sv).toBe(DENY_SV);
    expect(deny([{ code: 'MANIFEST_ATTEMPT_MISMATCH', detail: 'x' }, unbound]).outcome_sv).toBe(DENY_SV);
    expect(deny([{ ...unbound, text_sv: 'något annat' }]).outcome_sv).toBe(DENY_SV);
    expect(deny([]).outcome_sv).toBe(DENY_SV);
  });

  it('a result that is not an object, or whose fields read differently than their JSON, is NOT_VERIFIED -- never green', () => {
    const present = (localizationPublic as Record<string, unknown>).presentVerifyResult as ((r: unknown) => Record<string, unknown>) | undefined;
    expect(typeof present).toBe('function');
    for (const junk of [null, undefined, 'PASS', 42, []]) {
      expect(present!(junk), String(junk)).toMatchObject({ presentation: 'NOT_VERIFIED', verification_binding: null, mismatches: [], notices: [], outcome_sv: NEUTRAL_SV });
    }
    // An array that serializes to something else than it holds (toJSON): the green class of the object is not the class
    // of its JSON -- NOT_VERIFIED.
    const notices = Object.assign([] as unknown[], { toJSON: () => [legacyNotice()] });
    const answer = present!({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices });
    expect(answer).toMatchObject({ presentation: 'NOT_VERIFIED', verification_binding: null, outcome_sv: NEUTRAL_SV });
    expect(classifyVerifyPresentation(JSON.parse(JSON.stringify(answer)))).toBe('NOT_VERIFIED');
    // A strength only on the prototype: JSON of the read field would say FULLY_BOUND, the package says NOT_VERIFIED.
    const inherited = Object.assign(Object.create({ verification_binding: 'FULLY_BOUND' }), { outcome: 'PASS', mismatches: [], notices: [] });
    expect(present!(inherited)).toMatchObject({ presentation: 'NOT_VERIFIED', verification_binding: null });
  });
});
