/**
 * W-UI1-R2 -- the corrections UI1-VERIFICATION.md asked for (CORRECTION_REQUIRED, narrow), in the UI only:
 *  - finding 1 (Medel): a verify answer that lands after the assessment was read again (a re-read, a run, a lookup)
 *    belongs to the earlier reading and is never shown as a result -- never green beside a root that became a
 *    technical error; the answer is presented at render time against the read-back on screen NOW;
 *  - finding 4: "Försök igen" never beside a text that calls the fault lasting or a refusal (bootstrap), never against
 *    a server's false (an error without an HTTP status), never from an inherited flag;
 *  - finding 5: a site whose record's integrity cannot be attested is never ranked and never best, whatever the
 *    summary says;
 *  - finding 6: a root with a missing or unknown status (or an unknown assurance) is unresolved -- no PASS is a
 *    confirmation next to it;
 *  - finding 7: the UI is as strict as the package's classifier about notices (at most two, each code once,
 *    NOT_CHECKED with non-empty string finding ids and a detail, the legacy notice without finding ids);
 *  - finding 8: no "innehållshash" in a visible row;
 *  - M2e verification finding 4 (truth-critical): a "no hit" is never green when its own evidence says otherwise,
 *    is missing, listed twice, of an unknown integrity, or when a spatial row names no evidence;
 *  - M2e verification finding 5: a 401 names a cause only where the server's text says it.
 * Fully mocked: no network, no database.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';
import { isLuRootUnresolved, presentLuControlChecks } from '../../components/app/lu/luControlChecks';
import { LU_VERIFY_STALE_SV, presentLuVerifyResult } from '../../components/app/lu/luVerifyPresentation';
import { presentBootstrapFailure, presentLuError } from '../../components/app/lu/luErrorPresentation';
import { presentLuSiteRanking } from '../../components/app/lu/luSiteRanking';
import { governedReadBack } from '../fixtures/luGovernedReadBack';

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

const fetchPropertyInfo = vi.fn();
const callApi = vi.fn();
vi.mock('../../src/ui/api-client/geo.client', () => ({ fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args) }));
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => 'proj-1',
}));
vi.mock('../../components/CesiumMapView', () => ({ default: () => <div data-testid="cesium-map-view" /> }));

const apiError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });
const greenPass = (id: string, extra: Record<string, unknown> = {}) => ({
  ok: true, outcome: 'PASS', assessmentArtifactId: id, mismatches: [], notices: [],
  verification_binding: 'FULLY_BOUND', presentation: 'FULLY_BOUND_GREEN', ...extra,
});
const withRoot = (readBack: Record<string, any>, root: Record<string, unknown> | undefined) => ({ ...readBack, propertyRoot: root });

function mockApi(opts: { currentAssessment: () => unknown; verify?: () => unknown }) {
  fetchPropertyInfo.mockResolvedValue({
    id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
    geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
  });
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) {
      const value = opts.currentAssessment();
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/viewer/evidence')) return Promise.resolve({ type: 'FeatureCollection', features: [] });
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
      });
    }
    if (url.includes('/verify-assessment')) {
      const value = opts.verify?.();
      if (value instanceof Promise) return value;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    throw new Error(`unexpected callApi call in this test: ${url}`);
  });
}

async function open() {
  const user = userEvent.setup();
  render(<LuWorkspace />);
  await user.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('lu-lookup'));
  expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
  return user;
}

beforeEach(() => {
  fetchPropertyInfo.mockReset();
  callApi.mockReset();
});

describe('W-UI1-R2 finding 1 (Medel): a verify answer belongs to the reading it started in', () => {
  // A read-back whose overall line is retryable (a pinned read error) -- the control panel offers "Försök igen".
  const base = (id: string) => governedReadBack({ id, layers: { water: { kind: 'unreadable', readError: true } } });

  it('the verifier\'s probe: a green answer requested before a re-read that made the root ROOT_READ_ERROR is never shown green', async () => {
    let rootFault = false;
    let resolveVerify: (v: unknown) => void = () => undefined;
    mockApi({
      currentAssessment: () =>
        rootFault ? withRoot(base('assess-race'), { status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR', message_sv: 'x' }) : base('assess-race'),
      verify: () => new Promise((resolve) => { resolveVerify = resolve; }),
    });
    const user = await open();
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    const retry = await screen.findByTestId('lu-control-retry');
    rootFault = true;
    await user.click(retry);
    await waitFor(() => expect(screen.getByTestId('lu-check-state-property')).toHaveTextContent('kunde inte läsas just nu'));
    await act(async () => {
      resolveVerify(greenPass('assess-race'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
    const shown = screen.getByTestId('lu-verify-result-not-verified');
    expect(shown).toHaveAttribute('data-tone', 'neutral');
    expect(shown).toHaveTextContent(LU_VERIFY_STALE_SV);
  });

  it('also when the re-read keeps a sound root: an answer of the earlier reading is not this reading\'s result -- and a new check is green', async () => {
    let resolveVerify: (v: unknown) => void = () => undefined;
    let deferred = true;
    mockApi({
      currentAssessment: () => base('assess-race2'),
      verify: () => (deferred ? new Promise((resolve) => { resolveVerify = resolve; }) : greenPass('assess-race2')),
    });
    const user = await open();
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    await user.click(await screen.findByTestId('lu-control-retry'));
    await act(async () => {
      resolveVerify(greenPass('assess-race2'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-verify-result-not-verified')).toHaveTextContent('lästes in på nytt');
    deferred = false;
    await user.click(screen.getByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-result-pass')).toBeInTheDocument();
  });

  it('a verify ERROR of an earlier reading is not shown as this reading\'s error either', async () => {
    let rejectVerify: (e: unknown) => void = () => undefined;
    mockApi({
      currentAssessment: () => base('assess-race3'),
      verify: () => new Promise((_resolve, reject) => { rejectVerify = reject; }),
    });
    const user = await open();
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    await user.click(await screen.findByTestId('lu-control-retry'));
    await act(async () => {
      rejectVerify(apiError(503, 'x', { code: 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', failureClass: 'READ_ERROR', reasonCode: 'EVIDENCE_READ_ERROR', retryable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('lu-verify-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-verify-result-not-verified')).toHaveTextContent(LU_VERIFY_STALE_SV);
  });

  it('pure: a stale answer is never a result, whatever it says', () => {
    for (const raw of [greenPass('a'), { ...greenPass('a'), outcome: 'DENY', mismatches: [{ code: 'TAMPERED_EVIDENCE', detail: 'x' }] }, null]) {
      const v = presentLuVerifyResult(raw, 'a', { stale: true });
      expect(v.kind).toBe('NOT_VERIFIED');
      expect(v.tone).toBe('neutral');
      expect(v.headSv).toBe(LU_VERIFY_STALE_SV);
    }
  });
});

describe('W-UI1-R2 finding 6: a root that is missing or not known is unresolved -- fail-closed', () => {
  it('which roots count as resolved: only RESOLVED with its known assurance, and NOT_RECORDED', () => {
    expect(isLuRootUnresolved({ status: 'RESOLVED', assurance: 'UNBOUND_METADATA' })).toBe(false);
    expect(isLuRootUnresolved({ status: 'NOT_RECORDED' })).toBe(false);
    for (const root of [
      { status: 'SOME_FUTURE_STATUS' },
      { status: 'technical_error' },
      { status: 'RESOLVED', assurance: 'UNKNOWN' },
      { status: 'RESOLVED' },
      {},
      { status: 7 },
      undefined,
      null,
      'RESOLVED',
      [],
      Object.create({ status: 'RESOLVED', assurance: 'UNBOUND_METADATA' }),
    ]) {
      expect(isLuRootUnresolved(root), JSON.stringify(root) ?? String(root)).toBe(true);
    }
    const getter = {} as Record<string, unknown>;
    Object.defineProperty(getter, 'status', { get: () => 'NOT_RECORDED', enumerable: true });
    expect(isLuRootUnresolved(getter)).toBe(true);
  });

  it('a green answer beside a root with an unknown status is not shown as confirmed (the verifier\'s probe F_unknownRoot)', async () => {
    mockApi({
      currentAssessment: () => withRoot(governedReadBack({ id: 'assess-u' }), { status: 'SOME_FUTURE_STATUS', technical_error_class: null, message_sv: 'x' }),
      verify: () => greenPass('assess-u'),
    });
    const user = await open();
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-result-not-verified')).toHaveTextContent('har ett läge som inte kan tolkas här');
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });
});

describe('W-UI1-R2 finding 7: notices as strict as the package\'s classifier', () => {
  const notChecked = (extra: Record<string, unknown> = {}) => ({ code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: ['finding-notchecked-ebh'], detail: 'd', ...extra });
  const kind = (notices: unknown) => presentLuVerifyResult(greenPass('a', { notices }), 'a').kind;

  it('one well-formed NOT_CHECKED notice may stand next to green; nothing else', () => {
    expect(kind([notChecked()])).toBe('FULLY_BOUND_GREEN');
    expect(kind([notChecked(), notChecked()])).toBe('NOT_VERIFIED');
    expect(kind([notChecked({ finding_ids: [1] })])).toBe('NOT_VERIFIED');
    expect(kind([notChecked({ finding_ids: [''] })])).toBe('NOT_VERIFIED');
    expect(kind([notChecked({ finding_ids: 'finding-notchecked-ebh' })])).toBe('NOT_VERIFIED');
    expect(kind([notChecked({ finding_ids: Array.from({ length: 65 }, (_, i) => `finding-notchecked-${i}`) })])).toBe('NOT_VERIFIED');
    expect(kind([notChecked({ detail: undefined })])).toBe('NOT_VERIFIED');
    expect(kind([notChecked({ detail: 5 })])).toBe('NOT_VERIFIED');
    expect(kind([notChecked(), notChecked({ code: 'NOT_CHECKED_CAUSE_NOT_PINNED' }), notChecked()])).toBe('NOT_VERIFIED');
    expect(kind(Array.from({ length: 5000 }, () => notChecked()))).toBe('NOT_VERIFIED');
  });

  it('a notice list longer than two is refused by its length alone: not verified, and no notice of it is read (mutation N1)', () => {
    const three = [notChecked(), { code: 'SOMETHING_NEW', finding_ids: [], detail: 'd' }, { code: 'OTHER_NEW', finding_ids: [], detail: 'd' }];
    const v = presentLuVerifyResult(greenPass('a', { notices: three }), 'a');
    expect(v.kind).toBe('NOT_VERIFIED');
    expect(v.lines).toEqual([]);
    expect(v.technical.some((row) => row.label === 'Notis')).toBe(false);
  });

  it('the legacy notice has no finding ids and a detail', () => {
    const owner = 'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';
    const legacyNotice = (extra: Record<string, unknown> = {}) => ({
      code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', basis: 'V1_FORM', authenticity_verified: false, current_authority_verified: false,
      text_sv: owner, finding_ids: [], detail: 'd', ...extra,
    });
    const legacyKind = (notice: unknown) =>
      presentLuVerifyResult(greenPass('a', { verification_binding: 'LEGACY_UNBOUND_FORM', presentation: 'LEGACY_UNBOUND_NOTICE', notices: [notice] }), 'a').kind;
    expect(legacyKind(legacyNotice())).toBe('LEGACY_UNBOUND_NOTICE');
    expect(legacyKind(legacyNotice({ finding_ids: ['f-1'] }))).toBe('NOT_VERIFIED');
    expect(legacyKind(legacyNotice({ detail: undefined }))).toBe('NOT_VERIFIED');
  });
});

describe('W-UI1-R2 finding 5: a record whose integrity cannot be attested is never ranked, whatever the summary says', () => {
  it('assessed and best in the summary, not in not_ranked_site_ids -- still not ranked, never best', () => {
    for (const summary of [
      { assessed_site_ids: ['s'], bestAlternativeId: 's' },
      { assessed_site_ids: ['s'], bestAlternativeId: 's', not_ranked_site_ids: [] },
      {},
      null,
    ]) {
      const v = presentLuSiteRanking(summary, 's', 'RECORD_INTEGRITY_ERROR');
      expect(v.state, JSON.stringify(summary)).toBe('NOT_RANKED');
      expect(v.mayBeBest).toBe(false);
      expect(v.textSv).toBe('Platsen rangordnas inte och kan inte vara bästa alternativ: postens integritet kan inte intygas.');
    }
    expect(presentLuSiteRanking({ assessed_site_ids: ['s'], bestAlternativeId: 's' }, 's', 'ASSESSED')).toEqual({ state: 'RANKED', textSv: null, mayBeBest: true });
  });
});

describe('W-UI1-R2 finding 4: "Försök igen" never against the server\'s false, never beside a lasting text, never from an inherited flag', () => {
  it('an error without an HTTP status: the server\'s false holds', () => {
    const statusless = (extra: Record<string, unknown>) => Object.assign(new Error('raw'), extra);
    expect(presentLuError(statusless({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: false }), 'current-assessment').retryable).toBe(false);
    expect(presentLuError(statusless({ retryable: false }), 'current-assessment').retryable).toBe(false);
    expect(presentLuError(statusless({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR' }), 'current-assessment').retryable).toBe(true);
  });

  it.each(['BOOTSTRAP_STORAGE_INTEGRITY_FAULT', 'BOOTSTRAP_REFUSED', 'CURRENT_BINDING_INTEGRITY_FAULT', 'CURRENT_BINDING_REFUSED'])(
    'bootstrap %s: the text says lasting or refused -- no button even when the server says true, and the consequence agrees',
    (code) => {
      const v = presentBootstrapFailure({ status: 'FAILED', failureCode: code, retryable: true });
      expect(v.reasonSv).toMatch(/bestående|underkändes/);
      expect(v.retryable).toBe(false);
      expect(v.consequenceSv).toBe('Lokaliseringen är skapad, men fastigheten kan inte knytas till den. Ingen bedömning kan göras.');
    },
  );

  it('bootstrap: a transient reason still follows the server\'s flag', () => {
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode: 'BOOTSTRAP_EXECUTION_ERROR', retryable: true }).retryable).toBe(true);
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode: 'CURRENT_BINDING_READ_ERROR', retryable: true }).retryable).toBe(true);
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode: 'BOOTSTRAP_EXECUTION_ERROR', retryable: false }).retryable).toBe(false);
  });

  it('an inherited (polluted) or getter flag is never read', () => {
    const proto = Object.prototype as Record<string, unknown>;
    try {
      proto.retryable = true;
      expect(presentLuError(apiError(503, 'x', { code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR' }), 'current-assessment').retryable).toBe(false);
      expect(presentLuError(apiError(500, 'Internal Server Error'), 'current-assessment').retryable).toBe(false);
    } finally {
      delete proto.retryable;
    }
    const getter = apiError(503, 'x', { code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR' });
    Object.defineProperty(getter, 'retryable', { get: () => true, enumerable: true });
    expect(presentLuError(getter, 'current-assessment').retryable).toBe(false);
  });
});

describe('M2e verification finding 4 (truth-critical): a "no hit" is green only on evidence that says so itself', () => {
  const property = { lookedUp: true, geometry: { artifact_id: 'g', provenance: 'user_defined', wgs84LngLat: [17, 59] as [number, number] }, propertyRoot: undefined };
  const present = (mutate: (readBack: Record<string, any>) => void) => {
    const readBack = governedReadBack({ id: 'assess-m2e4' }) as Record<string, any>;
    readBack.evidenceDetails = readBack.evidenceDetails.map((d: Record<string, unknown>) => ({ ...d, result: d.result ? { ...(d.result as object) } : d.result }));
    readBack.governedLayerChecks = readBack.governedLayerChecks.map((c: Record<string, unknown>) => ({ ...c }));
    mutate(readBack);
    const rows = presentLuControlChecks({
      property,
      assessment: { status: 'present' },
      server: { layerChecks: readBack.governedLayerChecks, evidenceDetails: readBack.evidenceDetails, limitedCoverageLayers: [] },
    } as never);
    return rows.find((r) => r.key === 'water')!;
  };
  const waterDetail = (readBack: Record<string, any>) => readBack.evidenceDetails.find((d: Record<string, unknown>) => d.layer === 'water');

  it('the control: an untouched no-hit is the server\'s NO_HIT', () => {
    const water = present(() => undefined);
    expect(water.state).toBe('NO_HIT');
    expect(water.stateLabel).toBe('Kontrollerat – ingen registrerad träff');
  });

  it.each([
    ['its evidence says exists:true, 3 matches (a hit hidden on the chip)', (rb: Record<string, any>) => { waterDetail(rb).result.exists = true; waterDetail(rb).result.match_count_observed = 3; }],
    ['its evidence says exists:false but 2 matches', (rb: Record<string, any>) => { waterDetail(rb).result.match_count_observed = 2; }],
    ['the named evidence detail is missing', (rb: Record<string, any>) => { rb.evidenceDetails = rb.evidenceDetails.filter((d: Record<string, unknown>) => d.layer !== 'water'); }],
    ['the detail is listed twice (the first sound, the second TAMPERED)', (rb: Record<string, any>) => { rb.evidenceDetails.push({ ...waterDetail(rb), integrity: 'TAMPERED' }); }],
    ['the integrity is an unknown value', (rb: Record<string, any>) => { waterDetail(rb).integrity = 'SOMETHING_NEW'; }],
    ['the integrity is missing', (rb: Record<string, any>) => { waterDetail(rb).integrity = null; }],
    ['the spatial row names no evidence', (rb: Record<string, any>) => { rb.governedLayerChecks.find((c: Record<string, unknown>) => c.layer === 'water').evidence_artifact_id = null; }],
  ])('%s -> never green, the row says it is contradictory', (_name, mutate) => {
    const water = present(mutate as (rb: Record<string, any>) => void);
    expect(water.state).toBe('UNCERTAIN');
    expect(water.stateLabel).not.toContain('ingen registrerad träff');
    expect(water.summary).toBe('Kontrollposten från servern är motsägelsefull och visas därför inte som kontrollerad.');
  });
});

describe('W-UI1-R2 finding 8 and M2e verification finding 5: words', () => {
  it('the visible integrity row says "innehållskontroll", never "innehållshash"', () => {
    const readBack = governedReadBack({ id: 'assess-words' }) as Record<string, any>;
    const rows = presentLuControlChecks({
      property: { lookedUp: true, geometry: { artifact_id: 'g', provenance: 'user_defined', wgs84LngLat: [17, 59] }, propertyRoot: readBack.propertyRoot },
      assessment: { status: 'present' },
      server: { layerChecks: readBack.governedLayerChecks, evidenceDetails: readBack.evidenceDetails, limitedCoverageLayers: [] },
    } as never);
    const water = rows.find((r) => r.key === 'water')!;
    expect(water.details).toContainEqual({ label: 'Integritet', value: 'Innehållet stämmer med evidensens innehållskontroll' });
    for (const row of rows) expect(row.details.map((d) => d.value).join(' ')).not.toMatch(/innehållshash/i);
  });

  it.each([
    ['Missing bearer token', 'Du är inte inloggad – logga in för att fortsätta.'],
    ['Token expired', 'Sessionen har gått ut – logga in igen.'],
    ['Session expired', 'Sessionen har gått ut – logga in igen.'],
    ['Token has been revoked or session terminated', 'Sessionen har avslutats – logga in igen.'],
    ['Invalid signature', 'Inloggningen kunde inte bekräftas – logga in igen.'],
    ['Unauthorized', 'Inloggningen kunde inte bekräftas – logga in igen.'],
    ['', 'Inloggningen kunde inte bekräftas – logga in igen.'],
  ])('a 401 with the server\'s text %j -> %s', (message, text) => {
    const p = presentLuError(apiError(401, message), 'current-assessment');
    expect(p.kind).toBe('UNAUTHORIZED');
    expect(p.messageSv).toBe(`Den sparade bedömningen kunde inte läsas. ${text}`);
    expect(p.retryable).toBe(false);
  });
});
