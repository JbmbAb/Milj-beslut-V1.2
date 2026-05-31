/**
 * spatialAuditServiceExtended.test.ts
 *
 * Täcker utvidgade scenarier för spatialAuditService:
 *  - Natura 2000-träffar
 *  - Fler än en skyddad area (gränssnitt text-truncering)
 *  - SGU-tjänst misslyckas men audit fortsätter
 *  - Generellt DB-fel (inte relaterat till saknad tabell)
 *  - Parallella anrop returnerar korrekta isolerade resultat
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditSguRiskAtPoint: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

vi.mock('../../server/services/sguRiskService', () => ({
  auditSguRiskAtPoint: mocks.auditSguRiskAtPoint,
}));

import { runSpatialAudit } from '../../server/services/spatialAuditService';

const defaultSguResult = {
  summary: 'SGU: inga jordskredsrisker identifierade.',
  riskLevel: 'NONE' as const,
  manualReviewRequired: false,
  coverageMode: 'complete',
  groundLayerScale: '1:1M',
  hits: [],
};

describe('spatialAuditService – utvidgade scenarier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.auditSguRiskAtPoint.mockResolvedValue(defaultSguResult);
  });

  it('returnerar Natura 2000-träff från union-frågan', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        nvr_id: 'SE0110001',
        name: 'Tyresta nationalpark',
        protection_type: 'Natura 2000 SCI',
        decision_status: null,
      },
    ]);

    const result = await runSpatialAudit(59.18, 18.26);

    expect(result.isProtected).toBe(true);
    expect(result.protectedAreaHits[0].protection_type).toBe('Natura 2000 SCI');
    expect(result.text).toContain('Tyresta nationalpark');
  });

  it('visar max 3 namn i textsummeringen när fler areas matchar', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { nvr_id: 'r1', name: 'Reservat Alfa', protection_type: 'Naturreservat', decision_status: 'GALLANDE' },
      { nvr_id: 'r2', name: 'Reservat Beta', protection_type: 'Naturreservat', decision_status: 'GALLANDE' },
      { nvr_id: 'r3', name: 'Natura Gamma', protection_type: 'Natura 2000 SAC', decision_status: null },
      { nvr_id: 'r4', name: 'Skogsvård Delta', protection_type: 'Biotopskydd', decision_status: 'GALLANDE' },
    ]);

    const result = await runSpatialAudit(56.0, 14.0);

    expect(result.protectedAreaHits).toHaveLength(4);
    // textsummeringen ska nämna 4 (count) men begränsa namn-listan till 3
    expect(result.text).toContain('4 registrerat');
    expect(result.text).toContain('Reservat Alfa');
    expect(result.text).toContain('Reservat Beta');
    expect(result.text).toContain('Natura Gamma');
    expect(result.text).not.toContain('Skogsvård Delta');
  });

  it('innehåller alltid 3 källreferenser oavsett träffar', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    const result = await runSpatialAudit(65.0, 21.0);
    expect(result.sources).toHaveLength(3);
    const uris = result.sources.map((s) => s.web.uri);
    expect(uris).toContain('https://skyddadnatur.naturvardsverket.se/');
    expect(uris.some((u) => u.includes('sgu.se'))).toBe(true);
  });

  it('hanterar generellt DB-fel med generellt varningsmeddelande', async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const result = await runSpatialAudit(59.0, 18.0);

    expect(result.protectedAreaAvailable).toBe(false);
    expect(result.protectedAreaWarning).toContain('Skyddad natur kunde inte verifieras');
    expect(result.isProtected).toBe(false);
  });

  it('inkluderar SGU-risknivå HIGH i texten när SGU returnerar hög risk', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    mocks.auditSguRiskAtPoint.mockResolvedValue({
      ...defaultSguResult,
      riskLevel: 'HIGH',
      summary: 'SGU: hög risk för jordskred identifierad.',
    });

    const result = await runSpatialAudit(57.7, 12.0);

    expect(result.sgu.riskLevel).toBe('HIGH');
    expect(result.text).toContain('hög risk för jordskred');
  });

  it('slutför audit även när SGU-tjänsten kastar ett fel', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    mocks.auditSguRiskAtPoint.mockRejectedValue(new Error('SGU API timeout'));

    const result = await runSpatialAudit(58.0, 15.0);

    expect(result.sgu.manualReviewRequired).toBe(true);
    expect(result.sgu.flags).toContain('sgu:unavailable');
    expect(result.sgu.summary).toContain('SGU API timeout');
    expect(result.text).toContain('SGU riskkontroll kunde inte köras');
  });

  it('parallella anrop för olika koordinater returnerar isolerade resultat', async () => {
    // Audit 1: skyddad area
    mocks.queryRaw
      .mockResolvedValueOnce([
        {
          nvr_id: 'r-nord',
          name: 'Norra Reservatet',
          protection_type: 'Naturreservat',
          decision_status: 'GALLANDE',
        },
      ])
      // Audit 2: ingen area
      .mockResolvedValueOnce([]);

    const [resultNord, resultSyd] = await Promise.all([
      runSpatialAudit(68.0, 20.0),
      runSpatialAudit(55.6, 13.0),
    ]);

    expect(resultNord.isProtected).toBe(true);
    expect(resultNord.protectedAreaHits[0].name).toBe('Norra Reservatet');
    expect(resultSyd.isProtected).toBe(false);
    expect(resultSyd.protectedAreaHits).toHaveLength(0);
  });

  it('hanterar area med null-namn med fallback "namnlost omrade"', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { nvr_id: 'unnamed-1', name: null, protection_type: 'Naturreservat', decision_status: 'GALLANDE' },
    ]);

    const result = await runSpatialAudit(60.5, 17.5);

    expect(result.isProtected).toBe(true);
    expect(result.text).toContain('namnlost omrade');
  });
});
