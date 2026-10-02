import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  LuClientError,
  isNoCurrentAssessmentError,
  presentLuError,
} from '../../components/app/lu/luErrorPresentation';
import { LuErrorNotice } from '../../components/app/lu/LuErrorNotice';

// DEMO M2b item 3. Pure mapping + one tiny component. No network, no database.
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

describe('DEMO M2b presentLuError', () => {
  it.each([
    [httpError(424, 'Governed LU assessment failed tamper verification.'), 'current-assessment', 'INTEGRITY', 'klarade inte integritetskontrollen'],
    [httpError(424, 'Governed LU assessment is not bound to this project.'), 'current-assessment', 'INTEGRITY', 'hör till det här projektet'],
    [httpError(424, 'REJECT_LOCALIZATION_PRESENTATION: assessment canonical_body_hash'), 'viewer-evidence', 'INTEGRITY', 'Kontrollunderlaget klarade inte integritetskontrollen'],
    [httpError(404, 'Governed viewer capability is not configured for this project.'), 'viewer-evidence', 'TECHNICAL', 'Kartvisningen för projektet är inte förberedd ännu'],
    [httpError(403, 'Not authorized for this project.'), 'verify', 'UNAUTHORIZED', 'Du saknar behörighet till det här projektet.'],
    [httpError(401, 'Unauthorized'), 'export', 'UNAUTHORIZED', 'Sessionen har gått ut'],
    [httpError(500, 'Cannot read properties of undefined'), 'run', 'TECHNICAL', 'Bedömningen kunde inte köras. Ett tekniskt fel uppstod på servern.'],
    [httpError(424, 'Unsupported assessment contract version 9'), 'current-assessment', 'INTEGRITY', 'Underlaget stämmer inte med sin lagrade identitet'],
    [new TypeError('Failed to fetch'), 'viewer-evidence', 'TECHNICAL', 'Servern kunde inte nås eller svarade oväntat.'],
    [httpError(503, 'Otillräcklig datakvalitet för plats site-1 i strikt läge.', { code: 'LOCALIZATION_DATA_UNAVAILABLE' }), 'run', 'TECHNICAL', 'För många datakällor var otillgängliga'],
  ] as const)('%s (%s) -> %s, plain Swedish main text', (err, context, kind, text) => {
    const p = presentLuError(err, context);
    expect(p.kind).toBe(kind);
    expect(p.messageSv).toContain(text);
    // The raw server/JS text is never the main text ...
    expect(p.messageSv).not.toContain((err as Error).message);
    // ... it is kept for the collapsed technical section.
    expect(p.technical.map((r) => r.value)).toContain((err as Error).message);
  });

  it('a currentness failure shows the server\'s own Swedish user message (contract), keeping class and reason as codes', () => {
    const err = httpError(409, 'Projektet har flera möjliga aktuella lokaliseringspunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.', {
      code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY',
      reasonCode: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY',
    });
    const p = presentLuError(err, 'run');
    expect(p.kind).toBe('REFUSED');
    expect(p.retryable).toBe(false);
    expect(p.messageSv).toBe(err.message);
    expect(p.technical).toContainEqual({ label: 'Felklass', value: 'AMBIGUOUS_CURRENT_GEOMETRY' });
    expect(p.technical).toContainEqual({ label: 'Orsakskod', value: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY' });
    const technical = presentLuError({ ...err, message: err.message, status: 503 } as unknown, 'run');
    expect(technical.kind).not.toBe('REFUSED');
  });

  it('only the server\'s exact 404 text means "no current assessment"; any other 404 is not read as absence', () => {
    expect(isNoCurrentAssessmentError(new Error('No current governed LU assessment is available for this project.'))).toBe(true);
    expect(isNoCurrentAssessmentError(httpError(404, 'Cannot GET /api/localization/x/current-assessment'))).toBe(false);
    expect(presentLuError(httpError(404, 'No current governed LU assessment is available for this project.'), 'export').messageSv).toBe(
      'Det finns ingen sparad bedömning att exportera.',
    );
  });

  it('M2c item 3: a 404 from the control results while an assessment IS shown is never "ingen sparad bedömning", and can be retried', () => {
    // viewer-evidence is only fetched for a displayed assessment, so any 404 there contradicts the view.
    for (const err of [
      httpError(404, 'No current governed LU assessment is available for this project.'), // probe D
      httpError(404, 'Viewer capability not configured.'), // probe C: a reworded capability text
      httpError(404, 'Cannot GET /api/localization/x/viewer/evidence'),
    ]) {
      const p = presentLuError(err, 'viewer-evidence');
      expect(p.kind).toBe('INCOHERENT');
      expect(p.retryable).toBe(true);
      expect(p.messageSv).not.toMatch(/ingen sparad bedömning/i);
      expect(p.messageSv).toContain('Kontrollresultaten kunde inte hämtas');
      expect(p.messageSv).not.toContain(err.message);
    }
    expect(presentLuError(httpError(404, 'No current governed LU assessment is available for this project.'), 'viewer-evidence').messageSv).toBe(
      // W-M2d item 1: the viewer evidence feeds only the map.
      'Kontrollresultaten kunde inte hämtas till kartan: servern anger att projektet inte längre har någon aktuell bedömning, men en bedömning visas här. Läs in bedömningen på nytt.',
    );
  });

  it('M2c item 3: a status the mapping does not know (e.g. 422) says the server answered -- never "kunde inte nås"', () => {
    const p = presentLuError(httpError(422, 'Unprocessable'), 'viewer-evidence');
    expect(p.kind).toBe('TECHNICAL');
    expect(p.messageSv).toBe('Kontrollresultaten kunde inte hämtas till kartan. Servern svarade med ett oväntat fel.');
    expect(p.messageSv).not.toMatch(/kunde inte nås/);
    expect(p.technical).toContainEqual({ label: 'HTTP-status', value: '422' });
  });

  it('a client-side Swedish error is shown as written', () => {
    expect(presentLuError(new LuClientError('Slå upp en fastighet först.'), 'run').messageSv).toBe('Slå upp en fastighet först.');
  });

  it('LuErrorNotice: Swedish line, retry only when retryable, raw text only in a collapsed "Teknisk information"', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <LuErrorNotice testId="x" error={presentLuError(httpError(500, 'raw server text'), 'verify')} onRetry={onRetry} />,
    );
    expect(screen.getByTestId('x-message')).toHaveTextContent('Reproducerbarhetskontrollen kunde inte genomföras. Ett tekniskt fel uppstod på servern.');
    expect(screen.getByTestId('x-message')).not.toHaveTextContent('raw server text');
    expect(screen.getByTestId('x-technical')).not.toHaveAttribute('open');
    expect(screen.getByTestId('x-technical')).toHaveTextContent('raw server text');
    screen.getByTestId('x-retry').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<LuErrorNotice testId="x" error={presentLuError(httpError(424, 'Governed LU assessment failed tamper verification.'), 'verify')} onRetry={onRetry} />);
    expect(screen.queryByTestId('x-retry')).not.toBeInTheDocument();
  });
});
