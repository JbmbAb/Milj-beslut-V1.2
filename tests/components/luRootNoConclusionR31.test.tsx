/**
 * W-UI1 (D) -- owner decision R3-1 (Jimmy, 2026-10-03): R3-1 is accepted on the condition that the UI shows the
 * property root's technical fault CLEARLY and implies nothing about authenticity or present provenance. When a
 * read-back marks the root as a technical error (ROOT_READ_ERROR, and the root's other technical classes) the UI
 * says that the provenance could not be read just now and that no conclusion about authenticity or present
 * provenance can be drawn -- neutral/warning style, no green confirmation, no words "äkta", "verifierad
 * proveniens" or "aktuell". The same rule for ROOT_PROVENANCE_TAMPERED (the root tampered; 424).
 * Locked here: the text, the style (the warning colour, never a green one) and that no PASS stands as a
 * confirmation next to such a root. Fully mocked: no network, no database.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';
import { isLuRootUnresolved } from '../../components/app/lu/luControlChecks';
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

const NO_CONCLUSION = 'Ingen slutsats kan dras om fastighetsrotens äkthet eller om dess proveniens gäller nu.';
/** The owner's forbidden words next to a root fault (a claim of authenticity, verified or present provenance). */
const FORBIDDEN = /äkta|verifierad proveniens|aktuell/i;
/** The UI's green colours (a NO_HIT chip, a green verify head) and the plain "found" colour -- never on such a root. */
const GREEN_OR_FOUND = /rgb\(110, 231, 183\)|rgb\(16, 185, 129\)|rgb\(165, 243, 252\)|rgb\(34, 211, 238\)|#6EE7B7|#10B981|#A5F3FC|#22D3EE/i;
const WARNING_TEXT = 'rgb(253, 186, 116)'; // #FDBA74
const WARNING_BORDER = 'rgb(249, 115, 22)'; // #F97316
const ERROR_TEXT = 'rgb(248, 113, 113)'; // #F87171

const apiError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });

const OWNER_LEGACY = 'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';
const greenPass = (id: string) => ({
  ok: true, outcome: 'PASS', assessmentArtifactId: id, mismatches: [], notices: [],
  verification_binding: 'FULLY_BOUND', presentation: 'FULLY_BOUND_GREEN',
});
const legacyPass = (id: string) => ({
  ok: true, outcome: 'PASS', assessmentArtifactId: id, mismatches: [],
  verification_binding: 'LEGACY_UNBOUND_FORM', presentation: 'LEGACY_UNBOUND_NOTICE',
  notices: [{ code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', basis: 'V1_FORM', authenticity_verified: false, current_authority_verified: false, text_sv: OWNER_LEGACY, finding_ids: [] }],
});

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

/** A read-back of the governed fixture whose property root the server marks as given. */
const withRoot = (id: string, root: Record<string, unknown>) => {
  const base = governedReadBack({ id });
  return { ...base, propertyRoot: { ...base.propertyRoot, ...root } };
};

const ROOTS = [
  {
    name: 'ROOT_READ_ERROR (a read of unknown persistence)',
    root: { status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR', message_sv: 'Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas (ROOT_READ_ERROR).' },
    chip: 'Hittad · fastighetsunderlagets proveniens kunde inte läsas just nu',
    // W-UI1-R3 (owner decision 2026-10-03): a re-read -- "läs in på nytt".
    says: 'Fastighetsrotens proveniens kunde inte läsas just nu (tekniskt fel); läs in på nytt.',
  },
  {
    name: 'ROOT_PROVENANCE_TAMPERED (the root does not match its own identity)',
    root: { status: 'TAMPERED', technical_error_class: 'ROOT_PROVENANCE_TAMPERED', message_sv: 'Integritetsfel: fastighetsrotens artefakter stämmer inte med sin egen identitet.' },
    chip: 'Hittad · fastighetsunderlagets ursprung klarade inte kontrollen',
    says: 'Fastighetsrotens ursprung klarade inte integritetskontrollen.',
  },
  {
    name: 'ROOT_ARTIFACT_NOT_FOUND (the root link was never stored)',
    root: { status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_ARTIFACT_NOT_FOUND', message_sv: 'Rotens datasetbindning saknas (lägre säkerhet).' },
    chip: 'Hittad · fastighetsunderlagets ursprung finns inte i arkivet',
    says: 'Fastighetsrotens ursprung finns inte i arkivet för den här bedömningen.',
  },
  {
    // W-GAP1 (F2): a well-formed root link the CAS does not hold -- a lost referenced artifact, never "finns inte i arkivet".
    name: 'ROOT_MISSING_FROM_CAS (the root link is referenced but not in the archive -- lost, not absent)',
    root: {
      status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_MISSING_FROM_CAS',
      message_sv: 'Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel).',
    },
    chip: 'Hittad · fastighetsunderlagets ursprung kunde inte läsas ur arkivet (bestående fel)',
    says: 'Fastighetsrotens ursprung kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel).',
  },
  {
    name: 'a technical error of a class this UI has no mark for',
    root: { status: 'TECHNICAL_ERROR', technical_error_class: 'SOME_FUTURE_ROOT_FAULT', message_sv: 'Rotens datasetbindning saknas (lägre säkerhet).' },
    chip: 'Hittad · fastighetsunderlagets ursprung kunde inte läsas',
    says: 'Fastighetsrotens ursprung kunde inte läsas för den här bedömningen.',
  },
] as const;

beforeEach(() => {
  fetchPropertyInfo.mockReset();
  callApi.mockReset();
});

describe('W-UI1 D (owner decision R3-1): a root the read-back marks as a technical error or tampered implies nothing', () => {
  it.each(ROOTS)('$name: the fault is said plainly, no conclusion about authenticity or present provenance, warning style, never green', async ({ root, chip, says }) => {
    mockApi({ currentAssessment: () => withRoot('assess-root', root) });
    await open();
    const state = await screen.findByTestId('lu-check-state-property');
    await waitFor(() => expect(state).toHaveTextContent(chip));
    const row = screen.getByTestId('lu-check-property');
    // Text: the fault, and that no conclusion can be drawn -- never a claim of authenticity or present provenance.
    expect(row).toHaveTextContent(says);
    expect(row).toHaveTextContent(NO_CONCLUSION);
    expect(row.textContent ?? '').not.toMatch(FORBIDDEN);
    expect(row.textContent ?? '').not.toMatch(/[A-Z]{3,}_[A-Z0-9_]{3,}/);
    // Style: the warning colour on text, border and background; never a green or the plain "found" colour.
    expect(state).toHaveAttribute('data-qualified', 'root-assurance');
    expect(state.style.color).toBe(WARNING_TEXT);
    expect(state.style.border).toContain(WARNING_BORDER);
    for (const el of [row, ...Array.from(row.querySelectorAll<HTMLElement>('*'))]) {
      expect(el.getAttribute('style') ?? '', el.outerHTML.slice(0, 80)).not.toMatch(GREEN_OR_FOUND);
      expect(el.getAttribute('class') ?? '').not.toMatch(/green|emerald|verified/i);
    }
  });

  it('a PASS is not shown as a confirmation next to such a root -- neither the green head nor the older form\'s consistency line; after a clean re-read it is', async () => {
    let rootFault = true;
    let answer: unknown = greenPass('assess-root');
    mockApi({
      currentAssessment: () =>
        rootFault
          ? withRoot('assess-root', { status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR', message_sv: 'Rotens datasetbindning saknas (lägre säkerhet).' })
          : governedReadBack({ id: 'assess-root' }),
      verify: () => answer,
    });
    const user = await open();
    await waitFor(() => expect(screen.getByTestId('lu-check-state-property')).toHaveTextContent('kunde inte läsas just nu'));
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    const notVerified = await screen.findByTestId('lu-verify-result-not-verified');
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
    expect(notVerified).toHaveAttribute('data-tone', 'neutral');
    expect(notVerified).toHaveTextContent('Reproducerbarheten visas inte som bekräftad');
    expect(notVerified).toHaveTextContent('ingen slutsats kan dras om dess äkthet');
    expect(within(notVerified).getByTestId('lu-verify-result-not-verified-head').textContent ?? '').not.toMatch(FORBIDDEN);
    expect(notVerified.getAttribute('style') ?? '').not.toMatch(GREEN_OR_FOUND);

    // The older form's PASS: not its consistency line either.
    answer = legacyPass('assess-root');
    await user.click(screen.getByTestId('lu-verify-assessment'));
    await waitFor(() => expect(screen.getByTestId('lu-verify-result-not-verified')).toBeInTheDocument());
    expect(screen.queryByTestId('lu-verify-result-legacy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();

    // The control: the root reads again -> the same green answer is green (the rule is the root, not verify).
    rootFault = false;
    answer = greenPass('assess-root');
    await user.click(screen.getByTestId('lu-control-retry'));
    await waitFor(() => expect(screen.getByTestId('lu-check-state-property')).toHaveTextContent('Hittad · lägre säkerhet i fastighetsunderlaget'));
    await user.click(screen.getByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-result-pass')).toBeInTheDocument();
  });

  it.each(['current-assessment', 'verify'] as const)('424 GOVERNED_EVIDENCE_INTEGRITY_FAILED / ROOT_PROVENANCE_TAMPERED on %s: the root fault, no conclusion, the error colour, no retry, nothing green', async (path) => {
    const tampered = () =>
      apiError(424, 'Governed evidence integrity failed (ROOT_PROVENANCE_TAMPERED)', {
        code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED',
        failureClass: 'ROOT_PROVENANCE_TAMPERED',
        retryable: false,
      });
    mockApi({
      currentAssessment: () => (path === 'current-assessment' ? tampered() : governedReadBack({ id: 'assess-t' })),
      verify: () => tampered(),
    });
    const user = await open();
    let testId = 'lu-persisted-assessment-error';
    if (path === 'verify') {
      await user.click(await screen.findByTestId('lu-verify-assessment'));
      testId = 'lu-verify-error';
    }
    const message = await screen.findByTestId(`${testId}-message`);
    expect(message).toHaveTextContent('fastighetsrotens artefakter stämmer inte med sin identitet');
    expect(message).toHaveTextContent(NO_CONCLUSION);
    expect(message.textContent ?? '').not.toMatch(FORBIDDEN);
    expect(message.style.color).toBe(ERROR_TEXT);
    expect(screen.getByTestId(testId)).toHaveAttribute('data-error-kind', 'INTEGRITY');
    expect(screen.queryByTestId(`${testId}-retry`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });

  it('which roots count: a technical error (any class) or tampered; W-UI1-R2 (finding 6): a missing or malformed root too -- only RESOLVED/UNBOUND_METADATA and NOT_RECORDED are resolved', () => {
    expect(isLuRootUnresolved({ status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR' })).toBe(true);
    expect(isLuRootUnresolved({ status: 'TECHNICAL_ERROR' })).toBe(true);
    expect(isLuRootUnresolved({ status: 'TAMPERED', technical_error_class: 'ROOT_PROVENANCE_TAMPERED' })).toBe(true);
    expect(isLuRootUnresolved({ status: 'RESOLVED', assurance: 'UNBOUND_METADATA' })).toBe(false);
    expect(isLuRootUnresolved({ status: 'NOT_RECORDED' })).toBe(false);
    for (const raw of [undefined, null, 'TECHNICAL_ERROR', [], {}]) expect(isLuRootUnresolved(raw)).toBe(true);
  });
});
