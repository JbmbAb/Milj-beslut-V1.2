import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';

const prisma = new PrismaClient();
const app = createApp();

// This test suite requires a real PostgreSQL database.
// Set DATABASE_INTEGRATION=true (and a valid DATABASE_URL) to run it.
const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

describe.skipIf(!hasDatabaseIntegration)('secure API integration', () => {
  let adminToken = '';
  let adminRefreshToken = '';
  let projectId = '';

  beforeAll(async () => {
    await prisma.$connect();

    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({
        username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin-test-password',
      });

    expect(loginRes.status).toBe(200);
    adminToken = String(loginRes.body.accessToken || '');
    adminRefreshToken = String(loginRes.body.refreshToken || '');
    expect(adminToken.length).toBeGreaterThan(20);
    expect(adminRefreshToken.length).toBeGreaterThan(20);

    const createProjectRes = await request(app)
      .post('/api/admin/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ propertyDesignation: 'TEST 1:1' });

    expect(createProjectRes.status).toBe(200);
    projectId = String(createProjectRes.body?.project?.id || '');
    expect(projectId).not.toBe('');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns health status for liveness checks', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      service: 'miljobeslut-secure-backend',
    });
  });

  it('rotates refresh token and returns a new token pair', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: adminRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(typeof res.body?.accessToken).toBe('string');
    expect(typeof res.body?.refreshToken).toBe('string');
    expect(String(res.body?.accessToken || '').length).toBeGreaterThan(20);
    expect(String(res.body?.refreshToken || '').length).toBeGreaterThan(20);
  });

  it('fails BankID init gracefully when mTLS config is missing', async () => {
    const originalPfxPath = process.env.BANKID_PFX_PATH;
    const originalCertPath = process.env.BANKID_CERT_PATH;
    const originalKeyPath = process.env.BANKID_KEY_PATH;
    const originalBaseUrl = process.env.BANKID_BASE_URL;

    delete process.env.BANKID_PFX_PATH;
    delete process.env.BANKID_CERT_PATH;
    delete process.env.BANKID_KEY_PATH;
    process.env.BANKID_BASE_URL = 'https://bankid.invalid';

    try {
      const res = await request(app)
        .post('/api/auth/bankid/init')
        .send({ endUserIp: '127.0.0.1' });

      expect(res.status).toBe(400);
      expect(res.body?.ok).toBe(false);
      expect(String(res.body?.error || '')).toMatch(/BankID mTLS config missing/i);
    } finally {
      if (originalPfxPath == null) delete process.env.BANKID_PFX_PATH;
      else process.env.BANKID_PFX_PATH = originalPfxPath;
      if (originalCertPath == null) delete process.env.BANKID_CERT_PATH;
      else process.env.BANKID_CERT_PATH = originalCertPath;
      if (originalKeyPath == null) delete process.env.BANKID_KEY_PATH;
      else process.env.BANKID_KEY_PATH = originalKeyPath;
      if (originalBaseUrl == null) delete process.env.BANKID_BASE_URL;
      else process.env.BANKID_BASE_URL = originalBaseUrl;
    }
  });

  it('rejects protected route without bearer token', async () => {
    const res = await request(app).get(`/api/projects/${encodeURIComponent(projectId)}/plan`);
    expect(res.status).toBe(401);
  });

  it('requires admin role for admin routes', async () => {
    const consultantToken = createTokenPair({
      id: 'consultant-1',
      organisationId: 'org-1',
      bankidId: 'consultant:test',
      role: 'CONSULTANT',
    }).accessToken;

    const res = await request(app)
      .get('/api/admin/projects')
      .set('Authorization', `Bearer ${consultantToken}`);

    expect(res.status).toBe(403);
  });

  it('returns dispatch provider runtime status for admin', async () => {
    const res = await request(app)
      .get('/api/admin/dispatch/provider')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(['DEMO_FRAKTBORS', 'TIMOCOM', 'TRANS_EU']).toContain(res.body?.dispatch?.requestedProvider);
    expect(['DEMO_FRAKTBORS', 'TIMOCOM', 'TRANS_EU']).toContain(res.body?.dispatch?.activeProvider);
    expect(typeof res.body?.dispatch?.fallbackActive).toBe('boolean');
  });

  it('returns datasources catalog for authenticated users', async () => {
    const res = await request(app)
      .get('/api/datasources/catalog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Array.isArray(res.body?.sources)).toBe(true);
    expect(res.body.sources.length).toBeGreaterThan(0);
  });

  it('syncs open datasources and reports SLU status/ping/queries when external fetch is mocked', async () => {
    const originalFetch = globalThis.fetch;
    const originalSluSpeciesPath = process.env.SLU_SPECIES_OBS_BASE_PATH;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/species') || url.includes('/taxa') || url.includes('/speciesdata') || url.includes('/About/version')) {
        return new Response(JSON.stringify({ ok: true, endpoint: url }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('<ok/>', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.SLU_SPECIES_OBS_BASE_PATH = '/species';

    try {
      const statusRes = await request(app)
        .get('/api/datasources/slu/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body?.ok).toBe(true);
      expect(Array.isArray(statusRes.body?.products)).toBe(true);
      expect(statusRes.body.products.length).toBeGreaterThan(0);

      const pingRes = await request(app)
        .get('/api/datasources/slu/ping/species_observations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(pingRes.status).toBe(200);
      expect(pingRes.body?.ok).toBe(true);
      expect(pingRes.body?.result?.ok).toBe(true);

      const observationsRes = await request(app)
        .post('/api/datasources/slu/observations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId,
          purpose: 'integration-test',
          payload: { query: 'artfakta' },
        });

      expect(observationsRes.status).toBe(200);
      expect(observationsRes.body?.ok).toBe(true);

      const proxyRes = await request(app)
        .post('/api/datasources/slu/proxy')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          product: 'species_observations',
          method: 'POST',
          pathSuffix: '',
          payload: { q: 'sparv' },
          purpose: 'integration-test',
          projectId,
        });

      expect(proxyRes.status).toBe(200);
      expect(proxyRes.body?.ok).toBe(true);

      const openSyncRes = await request(app)
        .post('/api/datasources/open/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(openSyncRes.status).toBe(200);
      expect(openSyncRes.body?.ok).toBe(true);
      expect(Array.isArray(openSyncRes.body?.results)).toBe(true);
      expect(openSyncRes.body.results.length).toBeGreaterThan(0);
      const trafikverketResult = openSyncRes.body.results.find((row: { source?: string }) => row?.source === 'trafikverket');
      expect(trafikverketResult).toBeTruthy();
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalSluSpeciesPath == null) delete process.env.SLU_SPECIES_OBS_BASE_PATH;
      else process.env.SLU_SPECIES_OBS_BASE_PATH = originalSluSpeciesPath;
    }
  });

  it('supports search manifest/query/status/recover/retry with strict evidence and citations', async () => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { organisationId: true },
    });
    expect(project?.organisationId).toBeTruthy();
    const organisationId = String(project?.organisationId || '');

    const seeded = await prisma.documentRecord.create({
      data: {
        projectId,
        organisationId,
        entryId: `entry-${Date.now()}`,
        receivedTime: new Date(),
        subject: 'Kvicksilveranalys kontrollrapport',
        originalName: 'kvicksilver-rapport.txt',
        diskName: `kvicksilver-${Date.now()}.txt`,
        absolutePath: '/tmp/kvicksilver-rapport.txt',
        status: 'TEXT_EXTRACTED',
      },
      select: { id: true },
    });

    await prisma.documentContent.create({
      data: {
        documentId: seeded.id,
        contentCiphertext: 'test-cipher',
        contentIv: 'test-iv',
        contentTag: 'test-tag',
        keyVersion: 1,
        searchText:
          'Kvicksilverhalt verifierad i provpunkt A. Resultatet visar att kvicksilver ligger under riktvarde.',
      },
    });

    const syncValidationRes = await request(app)
      .post('/api/search/sync-manifest')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(syncValidationRes.status).toBe(400);
    expect(syncValidationRes.body?.ok).toBe(false);
    expect(String(syncValidationRes.body?.error || '')).toMatch(/projectId is required/i);

    const queryRes = await request(app)
      .post('/api/search/query')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId,
        query: 'kvicksilver',
        mode: 'lexical',
        topK: 5,
        strictEvidence: true,
      });

    expect(queryRes.status).toBe(200);
    expect(queryRes.body?.ok).toBe(true);
    expect(queryRes.body?.result?.guardrails?.strictEvidence).toBe(true);
    expect(String(queryRes.body?.result?.guardrails?.draftWatermark || '')).toMatch(/UTKAST/i);
    expect(Array.isArray(queryRes.body?.result?.results)).toBe(true);
    expect(queryRes.body.result.results.length).toBeGreaterThan(0);
    expect(Array.isArray(queryRes.body.result.results[0]?.citations)).toBe(true);
    expect(queryRes.body.result.results[0].citations.length).toBeGreaterThan(0);
    expect(String(queryRes.body.result.results[0].citations[0]?.quote || '').toLowerCase()).toContain('kvicksilver');

    const statusByIdRes = await request(app)
      .get(`/api/search/status/${encodeURIComponent(projectId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusByIdRes.status).toBe(200);
    expect(statusByIdRes.body?.ok).toBe(true);
    expect(typeof statusByIdRes.body?.status?.summary?.documentsTotal).toBe('number');

    const statusQueryRes = await request(app)
      .get(`/api/search/status?projectId=${encodeURIComponent(projectId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusQueryRes.status).toBe(200);
    expect(statusQueryRes.body?.ok).toBe(true);

    const consultantToken = createTokenPair({
      id: 'consultant-recover',
      organisationId: 'org-1',
      bankidId: 'consultant:recover',
      role: 'CONSULTANT',
    }).accessToken;

    const recoverRes = await request(app)
      .post('/api/search/recover-stale')
      .set('Authorization', `Bearer ${consultantToken}`)
      .send({});
    expect(recoverRes.status).toBe(400);
    expect(recoverRes.body?.ok).toBe(false);
    expect(String(recoverRes.body?.error || '')).toMatch(/projectId is required/i);

    const retryRes = await request(app)
      .post('/api/search/retry-failed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(retryRes.status).toBe(400);
    expect(retryRes.body?.ok).toBe(false);
    expect(String(retryRes.body?.error || '')).toMatch(/projectId is required/i);
  });

  it('exports audit trail with integrity verification', async () => {
    const evalRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-RISK_REVIEW/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        mapLayerAvailable: ['CADASTRE'],
      });
    expect(evalRes.status).toBe(200);

    const auditRes = await request(app)
      .get('/api/audit/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body?.ok).toBe(true);
    expect(auditRes.body?.integrity?.ok).toBe(true);
    expect(Array.isArray(auditRes.body?.memoryRecords)).toBe(true);
    expect(Array.isArray(auditRes.body?.records)).toBe(true);
  });

  it('returns map layer recommendations for a valid project type', async () => {
    const res = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/map-layers/recommend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectType: 'REMEDIATION' });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Array.isArray(res.body?.recommendation?.enabled)).toBe(true);
    expect(res.body.recommendation.enabled.length).toBeGreaterThan(0);
  });

  it('rejects invalid project type for map layer recommendation', async () => {
    const res = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/map-layers/recommend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectType: 'INVALID_TYPE' });

    expect(res.status).toBe(400);
    expect(String(res.body?.error || '')).toMatch(/Invalid projectType/i);
  });

  it('returns admin exam summary and database dump', async () => {
    const summaryRes = await request(app)
      .get('/api/admin/exam-summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body?.ok).toBe(true);
    expect(summaryRes.body?.summary?.totals?.projects).toBeGreaterThanOrEqual(1);
    expect(summaryRes.body?.summary?.bankRisk?.modelVersion).toBe('bank-risk-v1');
    expect(typeof summaryRes.body?.summary?.bankRisk?.averageReadinessScore).toBe('number');
    expect(typeof summaryRes.body?.summary?.bankRisk?.gatePassRatePct).toBe('number');
    expect(typeof summaryRes.body?.summary?.bankRisk?.verifiedDocCoveragePct).toBe('number');
    expect(typeof summaryRes.body?.summary?.bankRisk?.riskBands?.low).toBe('number');
    expect(typeof summaryRes.body?.summary?.bankRisk?.riskBands?.medium).toBe('number');
    expect(typeof summaryRes.body?.summary?.bankRisk?.riskBands?.high).toBe('number');
    expect(summaryRes.body?.summary?.euTaxonomy?.modelVersion).toBe('eu-taxonomy-screen-v1');
    expect(typeof summaryRes.body?.summary?.euTaxonomy?.eligibleProjects).toBe('number');
    expect(typeof summaryRes.body?.summary?.euTaxonomy?.alignedProjects).toBe('number');
    expect(typeof summaryRes.body?.summary?.euTaxonomy?.alignmentPct).toBe('number');
    expect(summaryRes.body?.summary?.euTaxonomy?.criteria).toEqual({
      carbonReadyRequired: true,
      documentGatePassedRequired: true,
      noBlockedRequiredGates: true,
      minVerifiedDocsRequired: 1,
    });

    const dumpRes = await request(app)
      .get('/api/admin/database-dump?limitPerTable=5&includeSearchText=false&includeChunkText=false')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(dumpRes.status).toBe(200);
    expect(dumpRes.body?.ok).toBe(true);
    expect(typeof dumpRes.body?.dump?.countByTable).toBe('object');
    expect(Object.keys(dumpRes.body.dump.countByTable).length).toBeGreaterThan(0);
  });

  it('supports requirements studio endpoints with strict verify policy and exports', async () => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { organisationId: true },
    });
    expect(project?.organisationId).toBeTruthy();
    const organisationId = String(project?.organisationId || '');
    const now = Date.now();
    const pdfPath = path.join(process.cwd(), '.quarantine', `requirements-test-${now}.pdf`);
    await fs.mkdir(path.dirname(pdfPath), { recursive: true });
    await fs.writeFile(pdfPath, '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

    try {
      const document = await prisma.documentRecord.create({
        data: {
          projectId,
          organisationId,
          entryId: `req-entry-${now}`,
          receivedTime: new Date(),
          subject: 'Requirements integration test',
          originalName: 'requirements-test.pdf',
          diskName: `requirements-test-${now}.pdf`,
          absolutePath: pdfPath,
          mimeType: 'application/pdf',
          status: 'TEXT_EXTRACTED',
        },
      });

      const requirementCase = await prisma.requirementCase.create({
        data: {
          caseKey: `CASE-${now}`,
          projectId,
          documentId: document.id,
          organisationId,
          municipality: 'Testkommun',
          authorityType: 'Kommun',
          authorityName: 'Testmyndighet',
          documentType: 'Beslut',
          sourceFile: document.originalName,
          sourceSubject: document.subject,
          reviewStatus: 'AUTO',
        },
      });

      const requirement = await prisma.requirementRecord.create({
        data: {
          requirementCode: `REQ-${now}`,
          caseId: requirementCase.id,
          documentId: document.id,
          projectId,
          sourceType: 'MANUAL',
          category: 'Ytkonstruktion',
          subcategory: 'Tat yta',
          requirementTextQuote: 'Ytan ska vara tat och hardgjord.',
          interpretedRequirement: 'Hardgjord yta kravs.',
          level: 'SKA',
          codingConfidence: 'HIGH',
        },
      });

      const citation = await prisma.requirementCitation.create({
        data: {
          citationCode: `CIT-${now}`,
          requirementId: requirement.id,
          caseId: requirementCase.id,
          documentId: document.id,
          quoteText: 'Ytan ska vara tat och hardgjord enligt beslut.',
        },
      });

      const consultantToken = createTokenPair({
        id: 'consultant-req-1',
        organisationId,
        bankidId: 'consultant:req-1',
        role: 'CONSULTANT',
      }).accessToken;

      const forbiddenRes = await request(app)
        .get('/api/admin/requirements/rows')
        .set('Authorization', `Bearer ${consultantToken}`);
      expect(forbiddenRes.status).toBe(403);

      const listRes = await request(app)
        .get('/api/admin/requirements/rows?includePreliminary=true&verificationStatus=AUTO')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body?.ok).toBe(true);
      expect(Array.isArray(listRes.body?.items)).toBe(true);
      expect(listRes.body.items.some((item: { requirementCode?: string }) => item.requirementCode === requirement.requirementCode)).toBe(true);

      const verifyRequirementBeforeCitation = await request(app)
        .patch(`/api/admin/requirements/rows/${encodeURIComponent(requirement.requirementCode)}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          verificationStatus: 'VERIFIED',
          verifiedBy: 'Integration Reviewer',
        });
      expect(verifyRequirementBeforeCitation.status).toBe(400);

      const citationVerifyRes = await request(app)
        .patch(`/api/admin/requirements/citations/${encodeURIComponent(citation.citationCode)}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          verificationStatus: 'REVIEWED',
          verifiedBy: 'Integration Reviewer',
          pageNumber: 1,
        });
      expect(citationVerifyRes.status).toBe(200);
      expect(citationVerifyRes.body?.ok).toBe(true);

      const requirementVerifyRes = await request(app)
        .patch(`/api/admin/requirements/rows/${encodeURIComponent(requirement.requirementCode)}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          verificationStatus: 'VERIFIED',
          verifiedBy: 'Integration Reviewer',
          validationComment: 'Verifierad i integrationsscenario.',
        });
      expect(requirementVerifyRes.status).toBe(200);
      expect(requirementVerifyRes.body?.row?.verificationStatus).toBe('VERIFIED');

      const citationsRes = await request(app)
        .get(`/api/admin/requirements/citations?requirementCode=${encodeURIComponent(requirement.requirementCode)}&includePreliminary=true`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(citationsRes.status).toBe(200);
      expect(citationsRes.body?.ok).toBe(true);
      expect(Array.isArray(citationsRes.body?.items)).toBe(true);
      expect(citationsRes.body.items.some((item: { citationCode?: string }) => item.citationCode === citation.citationCode)).toBe(true);

      const viewRes = await request(app)
        .get(`/api/admin/requirements/documents/${encodeURIComponent(document.id)}/view`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(viewRes.status).toBe(200);
      expect(String(viewRes.headers['content-type'] || '')).toMatch(/application\/pdf/i);

      const summaryRes = await request(app)
        .get('/api/admin/requirements/reports/summary')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body?.ok).toBe(true);
      expect(summaryRes.body?.summary?.scope).toBe('VERIFIED_ONLY');
      expect(typeof summaryRes.body?.summary?.totals?.verifiedRequirements).toBe('number');

      const csvRes = await request(app)
        .get('/api/admin/requirements/reports/export.csv')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(csvRes.status).toBe(200);
      expect(String(csvRes.headers['content-type'] || '')).toMatch(/application\/zip/i);

      const docxRes = await request(app)
        .post('/api/admin/requirements/reports/export.docx')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(docxRes.status).toBe(200);
      expect(String(docxRes.headers['content-type'] || '')).toMatch(/application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i);
    } finally {
      await fs.unlink(pdfPath).catch(() => undefined);
    }
  });

  it('validates gemini and figma AI endpoint contracts without external model calls', async () => {
    const geminiUnknownMethodRes = await request(app)
      .post('/api/gemini')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ method: 'unknownMethod', payload: {} });

    expect(geminiUnknownMethodRes.status).toBe(400);
    expect(geminiUnknownMethodRes.body?.ok).toBe(false);
    expect(String(geminiUnknownMethodRes.body?.error || '')).toMatch(/Unknown method/i);

    const figmaMissingPromptRes = await request(app)
      .post('/api/figma/ai')
      .send({ mode: 'text' });

    expect(figmaMissingPromptRes.status).toBe(400);
    expect(figmaMissingPromptRes.body?.ok).toBe(false);
    expect(String(figmaMissingPromptRes.body?.error || '')).toMatch(/prompt is required/i);
  });

  it('supports lantmateriet status and property lookup when external fetch is mocked', async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.LANTMATERIET_BASE_URL;
    const originalApiKey = process.env.LANTMATERIET_API_KEY;
    const originalOpenWms = process.env.LANTMATERIET_OPEN_WMS_URL;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/fastighet')) {
        return new Response(
          JSON.stringify({
            designation: 'TEST 1:1',
            geometry: { type: 'Polygon' },
            boundaries: { source: 'mock' },
            ownership: { ownerType: 'PRIVATE', share: '1/1', ownerName: 'REDACTED' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response('<Capabilities/>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.LANTMATERIET_BASE_URL = 'https://lantmateriet.mock';
    process.env.LANTMATERIET_API_KEY = 'licensed-test-key';
    process.env.LANTMATERIET_OPEN_WMS_URL = 'https://lantmateriet.mock/wms?service=WMTS';

    try {
      const statusRes = await request(app)
        .get('/api/datasources/lantmateriet/open/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body?.ok).toBe(true);
      expect(statusRes.body?.result?.ok).toBe(true);

      const lookupRes = await request(app)
        .post('/api/property/lookup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId,
          propertyDesignation: 'TEST 1:1',
          purpose: 'integration-test',
        });

      expect(lookupRes.status).toBe(200);
      expect(lookupRes.body?.ok).toBe(true);
      expect(lookupRes.body?.result?.designation).toBe('TEST 1:1');
      expect(lookupRes.body?.result?.ownership?.ownerName).toBeUndefined();
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      process.env.LANTMATERIET_BASE_URL = originalBaseUrl;
      process.env.LANTMATERIET_API_KEY = originalApiKey;
      process.env.LANTMATERIET_OPEN_WMS_URL = originalOpenWms;
    }
  });

  it('loads and saves project plan roundtrip', async () => {
    const loadRes = await request(app)
      .get(`/api/projects/${encodeURIComponent(projectId)}/plan`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loadRes.status).toBe(200);
    expect(loadRes.body.ok).toBe(true);

    const plan = (loadRes.body.plan && typeof loadRes.body.plan === 'object')
      ? loadRes.body.plan
      : {};
    const nextName = `Integration-${Date.now()}`;
    const nextPlan = {
      ...plan,
      name: nextName,
    };

    const saveRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/plan/save`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan: nextPlan });

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.plan.name).toBe(nextName);

    const reloadRes = await request(app)
      .get(`/api/projects/${encodeURIComponent(projectId)}/plan`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(reloadRes.status).toBe(200);
    expect(reloadRes.body.plan.name).toBe(nextName);
  });

  it('applies template and evaluates stage gate idempotently', async () => {
    const applyRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/template/apply`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ templateId: 'ENV_PERMIT_CORE' });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.plan.templateId).toBe('ENV_PERMIT_CORE');

    const firstEval = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-PERMIT_REQUIRED/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        permitType: 'Anmalan 9 kap',
        permitSubmitted: false,
      });

    expect(firstEval.status).toBe(200);
    expect(firstEval.body.ok).toBe(true);

    const secondEval = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-PERMIT_REQUIRED/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        permitType: 'Anmalan 9 kap',
        permitSubmitted: false,
      });

    expect(secondEval.status).toBe(200);
    expect(secondEval.body.idempotent).toBe(true);
  });

  it('rejects invalid carbon payload and accepts valid one', async () => {
    const invalidRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/carbon/calculate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        carbonInput: {
          tons: 10,
          transportMode: 'PLANE',
          materialType: 'SOIL',
        },
      });

    expect(invalidRes.status).toBe(400);

    const validRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/carbon/calculate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        carbonInput: {
          tons: 10,
          distanceKm: 20,
          transportMode: 'TRUCK',
          materialType: 'SOIL',
        },
      });

    expect(validRes.status).toBe(200);
    expect(validRes.body.result.totalKgCo2e).toBeGreaterThan(0);

    const reloadRes = await request(app)
      .get(`/api/projects/${encodeURIComponent(projectId)}/plan`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(reloadRes.status).toBe(200);
    expect(reloadRes.body.plan.carbonSummary.lastResult).toBeTruthy();
  });

  it('handles dispatch booking, driver journal signing and LIMS verification flow', async () => {
    const loadRes = await request(app)
      .get(`/api/projects/${encodeURIComponent(projectId)}/plan`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loadRes.status).toBe(200);
    const basePlan = loadRes.body.plan && typeof loadRes.body.plan === 'object'
      ? loadRes.body.plan
      : {};
    const now = new Date().toISOString();
    const seededPlan = {
      ...basePlan,
      documentArchive: [
        ...(Array.isArray(basePlan.documentArchive) ? basePlan.documentArchive : []),
        {
          id: `DOC-INTEGRATION-${Date.now()}`,
          name: 'Integration verified doc',
          module: 'COMPLIANCE_AUDIT',
          category: 'PERMIT',
          status: 'VERIFIED',
          uploadedAt: now,
          storagePath: '/tmp/integration-verified',
          tags: ['integration'],
        },
      ],
      auditTrail: [
        ...(Array.isArray(basePlan.auditTrail) ? basePlan.auditTrail : []),
        {
          id: `AUDIT-INTEGRATION-${Date.now()}`,
          timestamp: now,
          user: 'Integration reviewer',
          action: 'SIGN',
          details: 'Synthetic signature for test',
          immutable: true,
          signatureId: `SIG-INTEGRATION-${Date.now()}`,
        },
      ],
    };

    const seedRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/plan/save`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan: seededPlan });
    expect(seedRes.status).toBe(200);

    const quoteRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/dispatch/quote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiverId: 'R2',
        receiverName: 'Haz Receiver',
        wasteCode: '17 05 03*',
        tons: 8,
        distanceKm: 22,
      });

    expect(quoteRes.status).toBe(200);
    const quoteId = String(quoteRes.body?.quote?.id || '');
    expect(quoteId).not.toBe('');

    const bookRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/dispatch/book`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quoteId });

    expect(bookRes.status).toBe(200);
    const bookingId = String(bookRes.body?.booking?.id || '');
    expect(bookingId).not.toBe('');

    const journalUpsertRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/driver-journals/upsert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        journal: {
          bookingId,
          driverName: 'Test Driver',
          vehicleId: 'TEST-1',
          origin: 'Site A',
          destination: 'Site B',
          wasteCode: '17 05 03*',
          tons: 8,
          startedAt: now,
          endedAt: now,
          odometerStartKm: 1000,
          odometerEndKm: 1022,
        },
      });

    expect(journalUpsertRes.status).toBe(200);
    const journalId = String(journalUpsertRes.body?.journal?.id || '');
    expect(journalId).not.toBe('');

    const signDriverRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/driver-journals/${encodeURIComponent(journalId)}/sign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        signerRole: 'DRIVER',
        signatureId: `SIG-DRIVER-${Date.now()}`,
      });
    expect(signDriverRes.status).toBe(200);

    const signReviewerRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/driver-journals/${encodeURIComponent(journalId)}/sign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        signerRole: 'REVIEWER',
        signatureId: `SIG-REVIEWER-${Date.now()}`,
      });
    expect(signReviewerRes.status).toBe(200);
    expect(signReviewerRes.body?.journal?.status).toBe('VERIFIED');

    const ingestRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/lims/ingest`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        report: {
          bookingId,
          sampleId: `SAMPLE-${Date.now()}`,
          labName: 'ALS',
          source: 'API',
          rawReference: `ALS-REF-${Date.now()}`,
          metrics: [
            {
              key: 'Pb',
              value: 0.7,
              unit: 'mg/kg',
              maxAllowed: 1,
            },
          ],
        },
      });
    expect(ingestRes.status).toBe(200);
    const reportId = String(ingestRes.body?.report?.id || '');
    expect(reportId).not.toBe('');

    const verifyLimsRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/lims/${encodeURIComponent(reportId)}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reviewer: 'QA Reviewer',
        signatureId: `SIG-LIMS-${Date.now()}`,
        approved: true,
      });
    expect(verifyLimsRes.status).toBe(200);
    expect(verifyLimsRes.body?.report?.verifiedByHuman).toBe(true);

    const docGateRes = await request(app)
      .post(`/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-DOCUMENT_CONTROL/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(docGateRes.status).toBe(200);
    expect(docGateRes.body?.gate?.status).toBe('PASSED');
  });
});


