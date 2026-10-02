/**
 * U20CDF4 (owner decision 2026-10-03 (4) point 1; coordinator clarification 1) -- the HTTP boundary
 * rebuilds the 424's `record_integrity` from its whitelist (recordIntegrityDiagnosticWire), whatever
 * object the orchestrator hands it. Pinned because mutation N24 (the route passing the object through
 * unrebuilt) survived the end-to-end suite: there the orchestrator's object already has the whitelist's
 * shape. Here the orchestrator answer is replaced by a hostile one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const HOSTILE = {
  ok: false,
  status: 424,
  error: 'Bedömningen kan inte visas (test).',
  code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR',
  failureClass: 'RECORD_INTEGRITY_ERROR',
  reasonCode: 'UNKNOWN_SEVERITY',
  retryable: false,
  // Fields a valid assessment answer would carry -- never on the wire next to this code.
  findings: [{ explanation: 'rå text' }],
  overallStatement: { risk_level: 'LOW' },
  record_integrity: {
    authoritative: true,
    verified: true,
    note_sv: 'Allt är verifierat <script>',
    assessment_artifact_id: 'assessment-u20cdf4-wire',
    basis_codes: ['UNKNOWN_SEVERITY', 'drop table'],
    risk_level: 'LOW',
    stored_findings_unverified: {
      total: 1,
      highest_level: 'CRITICAL',
      counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 0, malformed: 0, secret: 7 },
      entries: [{ check: 'water', rule: 'LU-WATER-001', stored_level: 'HIGH', well_formed: true, explanation: 'rå text' }],
      findings: [{ explanation: 'rå text' }],
    },
  },
};

vi.mock('../../server/modules/localization/public', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCurrentLuAssessmentSummary: vi.fn(async () => HOSTILE),
}));

import express from 'express';
import request from 'supertest';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';

const app = express();
app.use(express.json());
app.use(localizationRoutes);
const token = createTokenPair({ id: 'user-u20cdf4-wire', organisationId: 'org-u20cdf4', bankidId: 'bankid:u20cdf4-wire', role: 'ADMIN' }).accessToken;

describe('U20CDF4: the 424 diagnostic leaves the server only as its whitelist', () => {
  it('extra fields, free text, a raw level and authority claims from the orchestrator never reach the body', async () => {
    const res = await request(app).get('/api/localization/proj-wire/current-assessment').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(424);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'failureClass', 'ok', 'reasonCode', 'record_integrity', 'retryable']);
    expect(res.body.record_integrity).toEqual({
      authoritative: false,
      verified: false,
      note_sv: 'Diagnostisk uppgift ur den lagrade posten: inte verifierad, inte auktoritativ och ingen bedömning. Fynden får inte läsas som bedömningens resultat.',
      assessment_artifact_id: 'assessment-u20cdf4-wire',
      basis_codes: ['UNKNOWN_SEVERITY'],
      stored_findings_unverified: {
        total: 1,
        highest_level: null,
        counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 0, malformed: 0 },
        entries: [{ check: 'water', rule: 'LU-WATER-001', stored_level: 'HIGH', well_formed: true }],
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/rå text|<script>|drop table|CRITICAL|secret|"LOW"/);
  });
});
