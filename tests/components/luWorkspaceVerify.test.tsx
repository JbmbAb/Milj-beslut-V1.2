/**
 * W-UI1 (A) -- the verify presentation in the workspace (owner decision 2026-10-02; U30R6 K8-K13, K18, K21).
 *
 * Green ONLY for presentation FULLY_BOUND_GREEN + verification_binding FULLY_BOUND + outcome PASS; the
 * owner's text in the warning colour for LEGACY_UNBOUND_NOTICE; everything else (NOT_VERIFIED, null,
 * missing, unknown, DENY, a 424 or 503 answer) never green. UNBOUND has its own text. Fully mocked: no
 * network, no database; the read-back is built by the server's own presentation functions (fixture).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';
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

const SHOWN = 'assessment-shown';
const OWNER_TEXT = 'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';
const GREEN_HEAD = 'Reproducerbarheten verifierad – resultatet matchar de pinnade artefakterna.';

const apiError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });

const legacyNotice = (basis: string) => ({
  code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY',
  basis,
  authenticity_verified: false,
  current_authority_verified: false,
  text_sv: OWNER_TEXT,
  finding_ids: [],
  detail: `assessment ${SHOWN}`,
});
const green = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  outcome: 'PASS',
  assessmentArtifactId: SHOWN,
  mismatches: [],
  notices: [],
  verification_binding: 'FULLY_BOUND',
  presentation: 'FULLY_BOUND_GREEN',
  outcome_sv: 'Reproducerbarhet verifierad – resultatet matchar de pinnade artefakterna.',
  ...extra,
});
const legacy = (basis: string, extra: Record<string, unknown> = {}) =>
  green({ verification_binding: 'LEGACY_UNBOUND_FORM', presentation: 'LEGACY_UNBOUND_NOTICE', notices: [legacyNotice(basis)], ...extra });

let verifyAnswer: () => unknown = () => green();

function mockApi() {
  fetchPropertyInfo.mockResolvedValue({
    id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
    geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
  });
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) return Promise.resolve(governedReadBack({ id: SHOWN }));
    if (url.includes('/viewer/evidence')) return Promise.resolve({ type: 'FeatureCollection', features: [] });
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
      });
    }
    if (url.includes('/verify-assessment')) {
      const value = verifyAnswer();
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    throw new Error(`unexpected callApi call in this test: ${url}`);
  });
}

async function verify(answer: () => unknown) {
  verifyAnswer = answer;
  const user = userEvent.setup();
  render(<LuWorkspace />);
  await user.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('lu-lookup'));
  await user.click(await screen.findByTestId('lu-verify-assessment'));
  return user;
}

/** Nothing in the visible results reads as the green verification. */
function expectNoGreen() {
  expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  expect(screen.queryByTestId('lu-verify-result-pass-head')).not.toBeInTheDocument();
  expect(screen.getByTestId('lu-results')).not.toHaveTextContent(GREEN_HEAD);
}

describe('W-UI1 A: the verify presentation in the workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('FULLY_BOUND_GREEN + FULLY_BOUND + PASS: the green head, consistency only', async () => {
    await verify(() => green());
    const pass = await screen.findByTestId('lu-verify-result-pass');
    expect(pass).toHaveAttribute('data-verify-presentation', 'FULLY_BOUND_GREEN');
    expect(pass).toHaveAttribute('data-tone', 'verified');
    expect(screen.getByTestId('lu-verify-result-pass-head').textContent).toBe(GREEN_HEAD);
    expect(pass).toHaveTextContent('Den intygar inte vem som har skapat underlaget.');
    expect(screen.getByTestId('lu-results')).not.toHaveTextContent(OWNER_TEXT);
  });

  it.each(['V1_FORM', 'LEGACY_UNBOUND'])('LEGACY_UNBOUND_NOTICE (%s): the owner text in the warning colour -- never the green head', async (basis) => {
    await verify(() => legacy(basis));
    const notice = await screen.findByTestId('lu-verify-result-legacy');
    expect(notice).toHaveAttribute('data-verify-presentation', 'LEGACY_UNBOUND_NOTICE');
    expect(notice).toHaveAttribute('data-tone', 'notice');
    expect(screen.getByTestId('lu-verify-result-legacy-head').textContent).toBe(OWNER_TEXT);
    expect(notice).toHaveStyle({ color: '#FDBA74' });
    expect(notice).not.toHaveStyle({ color: '#A5F3FC' });
    expect(notice).toHaveTextContent('Den intygar inte vem som har skapat underlaget.');
    // No machine code in the visible lines; the code and basis only under Teknisk information.
    const technical = screen.getByTestId('lu-verify-result-technical');
    expect(technical).not.toHaveAttribute('open');
    expect(technical).toHaveTextContent('LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY');
    expect((notice.textContent ?? '').replace(technical.textContent ?? '', '')).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    expectNoGreen();
  });

  it.each([
    ['NOT_VERIFIED from the server', () => green({ presentation: 'NOT_VERIFIED', verification_binding: null })],
    ['an older answer without binding or presentation (K18)', () => ({ ok: true, outcome: 'PASS', assessmentArtifactId: SHOWN, mismatches: [], notices: [] })],
    ['binding null under a green presentation', () => green({ verification_binding: null })],
    ['an unknown presentation value', () => green({ presentation: 'FULLY_BOUND_GREEN_V2' })],
    ['an unknown binding value', () => green({ verification_binding: 'SUBJECT_BOUND' })],
    ['a legacy notice without the legacy binding (notice without binding)', () => green({ notices: [legacyNotice('V1_FORM')] })],
    ['the legacy binding without its notice (binding without notice)', () => legacy('V1_FORM', { notices: [] })],
    ['a notice this UI cannot show next to green', () => green({ notices: [{ code: 'SOMETHING_NEW', finding_ids: [] }] })],
  ])('%s: not verified, neutral, never green', async (_name, answer) => {
    await verify(answer);
    const result = await screen.findByTestId('lu-verify-result-not-verified');
    expect(result).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByTestId('lu-verify-result-not-verified-head')).toHaveTextContent('Reproducerbarheten kan inte visas som bekräftad');
    expect(screen.getByTestId('lu-results')).not.toHaveTextContent(OWNER_TEXT);
    expectNoGreen();
  });

  it('DENY with a deviation: red, the count, never green -- even if the answer claims a green presentation', async () => {
    await verify(() => green({ outcome: 'DENY', mismatches: [{ code: 'TAMPERED_EVIDENCE', detail: 'x' }] }));
    const deny = await screen.findByTestId('lu-verify-result-mismatch');
    expect(deny).toHaveAttribute('data-tone', 'denied');
    expect(screen.getByTestId('lu-verify-result-mismatch-summary')).toHaveTextContent(
      'Kontrollen hittade 1 avvikelse mot de pinnade artefakterna. Reproducerbarheten kunde inte bekräftas.',
    );
    expect(screen.getByTestId('lu-verify-result-mismatch-technical')).toHaveTextContent('TAMPERED_EVIDENCE');
    expectNoGreen();
  });

  it('DENY that is only EXECUTION_SUBJECT_UNBOUND: its own text, apart from a deviation or manipulation', async () => {
    await verify(() =>
      green({ outcome: 'DENY', verification_binding: null, presentation: 'NOT_VERIFIED', mismatches: [{ code: 'EXECUTION_SUBJECT_UNBOUND', detail: 'x' }] }),
    );
    const unbound = await screen.findByTestId('lu-verify-result-unbound');
    expect(unbound).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByTestId('lu-verify-result-unbound-head')).toHaveTextContent(
      'Reproducerbarheten kan inte bekräftas: körningen bakom bedömningen saknar ett styrt exekveringssubjekt',
    );
    expect(unbound).toHaveTextContent('Resultatet påstår inte att underlaget har ändrats.');
    expect(screen.queryByTestId('lu-verify-result-mismatch')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-results')).not.toHaveTextContent(/avvikelse/);
    expectNoGreen();
  });

  it('424 GOVERNED_EVIDENCE_INTEGRITY_FAILED (lasting manipulated evidence): an integrity fault that names what verify did not do, no retry, never green', async () => {
    await verify(() =>
      apiError(424, 'Bedömningens underlag klarade inte integritetskontrollen (EVIDENCE_TAMPERED: e1). Reproducerbarhetskontrollen genomfördes därför inte och inget utfall anges.', {
        code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED',
        failureClass: 'EVIDENCE_TAMPERED',
        reasonCode: 'EVIDENCE_TAMPERED',
      }),
    );
    const message = await screen.findByTestId('lu-verify-error-message');
    expect(message).toHaveTextContent('klarade inte integritetskontrollen');
    expect(message).toHaveTextContent('Reproducerbarhetskontrollen genomfördes därför inte');
    expect(message).not.toHaveTextContent(/Bedömningen visas därför inte|EVIDENCE_TAMPERED|e1/);
    expect(screen.getByTestId('lu-verify-error')).toHaveAttribute('data-error-kind', 'INTEGRITY');
    expect(screen.queryByTestId('lu-verify-error-retry')).not.toBeInTheDocument();
    expectNoGreen();
  });

  it('503 the server marks retryable: "Försök igen" re-runs the check; a 503 marked not retryable offers none', async () => {
    let calls = 0;
    const user = await verify(() => {
      calls += 1;
      return calls === 1
        ? apiError(503, 'x', { code: 'LU_REEXECUTION_STORAGE_FAULT', failureClass: 'REEXECUTION_STORAGE_FAULT', reasonCode: 'EXECUTION_OUTCOME', retryable: true })
        : green();
    });
    const retry = await screen.findByTestId('lu-verify-error-retry');
    expectNoGreen();
    await user.click(retry);
    expect(await screen.findByTestId('lu-verify-result-pass')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('503 marked not retryable: no "Försök igen", never green', async () => {
    await verify(() =>
      apiError(503, 'x', { code: 'LU_REEXECUTION_STORAGE_FAULT', failureClass: 'REEXECUTION_STORAGE_FAULT', reasonCode: 'EXECUTION_OUTCOME', retryable: false }),
    );
    await screen.findByTestId('lu-verify-error-message');
    expect(screen.queryByTestId('lu-verify-error-retry')).not.toBeInTheDocument();
    expectNoGreen();
  });

  it('a later green answer replaces an older form\'s notice, and the other way round -- nothing carries over', async () => {
    let answer: unknown = legacy('V1_FORM');
    const user = await verify(() => answer);
    await screen.findByTestId('lu-verify-result-legacy');
    answer = green();
    await user.click(screen.getByTestId('lu-verify-assessment'));
    await screen.findByTestId('lu-verify-result-pass');
    expect(screen.queryByTestId('lu-verify-result-legacy')).not.toBeInTheDocument();
    answer = legacy('LEGACY_UNBOUND');
    await user.click(screen.getByTestId('lu-verify-assessment'));
    await waitFor(() => expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument());
    expect(screen.getByTestId('lu-verify-result-legacy')).toBeInTheDocument();
  });
});
