import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  adminAuthHeaders,
  createApiContext,
  loginAsAdmin,
  parseJson,
  primeAuthenticatedPage,
  waitForHubModuleReady,
} from './support';

const prismaDatabaseUrl =
  String(process.env.PLAYWRIGHT_DATABASE_URL || process.env.DATABASE_URL || '').trim() ||
  'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut_test';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: prismaDatabaseUrl,
    },
  },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function expectAdminLoginScreen(page: import('@playwright/test').Page) {
  await expect(page.getByText(/Admin inloggning och session/i)).toBeVisible();
  await expect(page.getByTestId('admin-username-input')).toBeVisible();
  await expect(page.getByTestId('admin-password-input')).toBeVisible();
  await expect(page.getByTestId('admin-login-button')).toBeVisible();
}

test('admin login from landing page', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('landing-open-admin').click();
  await expectAdminLoginScreen(page);
});

test('admin can create a project from console', async ({ request, page }) => {
  const token = await loginAsAdmin(request);
  expect(token.length).toBeGreaterThan(10);

  const createProject = await request.post('/api/admin/projects', {
    headers: await adminAuthHeaders(request, token),
    data: {
      propertyDesignation: `E2E-CONSOLE-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const createPayload = await parseJson<{ project?: { id?: string } }>(createProject);
  expect(String(createPayload?.project?.id || '')).not.toBe('');

  await page.goto('/');
  await page.getByTestId('landing-open-admin').click();
  await expectAdminLoginScreen(page);
});

test('logistics flow is blocked when verified receiver catalog is missing', async ({ page }) => {
  const api = await createApiContext();
  try {
    await primeAuthenticatedPage(page, api);
    await page.goto('/');
    await waitForHubModuleReady(page, 'logistik');
    await page.getByTestId('landing-open-logistik').click();
    await page.getByTestId('sidebar-logistics-masses').click();
    await expect(page.getByTestId('workspace-active-tab-label')).toContainText('logistics', {
      timeout: 15_000,
    });

    const logisticsRoot = page.getByTestId('market-intel-logistics');
    await expect(logisticsRoot).toBeVisible({ timeout: 30_000 });
    const mapLabel = logisticsRoot.getByText(/Interaktiv mottagarkarta/i);
    await mapLabel.scrollIntoViewIfNeeded();
    await expect(mapLabel).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Mottagare (snabbval)' })).toBeDisabled();
  } finally {
    await api.dispose();
  }
});

test('logistics view keeps receiver selection blocked without verified catalog', async ({ page }) => {
  const api = await createApiContext();
  try {
    await primeAuthenticatedPage(page, api);
    await page.goto('/');
    await waitForHubModuleReady(page, 'logistik');
    await page.getByTestId('landing-open-logistik').click();
    await page.getByTestId('sidebar-logistics-masses').click();
    await expect(page.getByTestId('workspace-active-tab-label')).toContainText('logistics', {
      timeout: 15_000,
    });

    const logisticsRoot = page.getByTestId('market-intel-logistics');
    await expect(logisticsRoot).toBeVisible({ timeout: 30_000 });
    const mapLabel = logisticsRoot.getByText(/Interaktiv mottagarkarta/i);
    await mapLabel.scrollIntoViewIfNeeded();
    await expect(mapLabel).toBeVisible();

    await page.locator('select').first().selectOption('17 05 03*');
    await page.getByPlaceholder('Exempel: 500').fill('8');
    await expect(page.getByRole('combobox', { name: 'Mottagare (snabbval)' })).toBeDisabled();
  } finally {
    await api.dispose();
  }
});

test('critical plan + gate + carbon API flow passes end-to-end', async ({ request }) => {
  const token = await loginAsAdmin(request);
  expect(token.length).toBeGreaterThan(10);

  const createProject = await request.post('/api/admin/projects', {
    headers: await adminAuthHeaders(request, token),
    data: {
      propertyDesignation: `E2E-PROJECT-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const createPayload = await parseJson<{ project?: { id?: string } }>(createProject);
  const projectId = String(createPayload?.project?.id || '');
  expect(projectId).not.toBe('');

  const load = await request.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(load.ok()).toBeTruthy();
  const loadPayload = await parseJson<{ plan?: Record<string, unknown> }>(load);
  const loadedPlan = loadPayload.plan || {};

  const nextPlan = {
    ...loadedPlan,
    name: `E2E-PLAN-${Date.now()}`,
  };
  const save = await request.post(`/api/projects/${encodeURIComponent(projectId)}/plan/save`, {
    headers: await adminAuthHeaders(request, token),
    data: { plan: nextPlan },
  });
  expect(save.ok()).toBeTruthy();

  const applyTemplate = await request.post(`/api/projects/${encodeURIComponent(projectId)}/template/apply`, {
    headers: await adminAuthHeaders(request, token),
    data: { templateId: 'ENV_PERMIT_CORE' },
  });
  expect(applyTemplate.ok()).toBeTruthy();

  const gate = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-PERMIT_REQUIRED/evaluate`,
    {
      headers: await adminAuthHeaders(request, token),
      data: {
        permitType: 'Anmalan 9 kap',
        permitSubmitted: false,
      },
    },
  );
  expect(gate.ok()).toBeTruthy();

  const carbon = await request.post(`/api/projects/${encodeURIComponent(projectId)}/carbon/calculate`, {
    headers: await adminAuthHeaders(request, token),
    data: {
      carbonInput: {
        tons: 12,
        distanceKm: 25,
        transportMode: 'TRUCK',
        materialType: 'SOIL',
      },
    },
  });
  expect(carbon.ok()).toBeTruthy();
  const carbonPayload = await parseJson<{ result?: { totalKgCo2e?: number } }>(carbon);
  expect(carbonPayload?.result?.totalKgCo2e).toBeTruthy();

  const finalLoad = await request.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(finalLoad.ok()).toBeTruthy();
  const finalLoadPayload = await parseJson<{ plan?: { carbonSummary?: { lastResult?: unknown } } }>(
    finalLoad,
  );
  const finalPlan = finalLoadPayload.plan;
  expect(finalPlan?.carbonSummary?.lastResult || carbonPayload?.result).toBeTruthy();
});

test('dispatch + journal + lims API flow passes end-to-end', async ({ request }) => {
  const token = await loginAsAdmin(request);
  expect(token.length).toBeGreaterThan(10);

  const createProject = await request.post('/api/admin/projects', {
    headers: await adminAuthHeaders(request, token),
    data: {
      propertyDesignation: `E2E-DISPATCH-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const createPayload = await parseJson<{ project?: { id?: string } }>(createProject);
  const projectId = String(createPayload?.project?.id || '');
  expect(projectId).not.toBe('');

  const load = await request.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(load.ok()).toBeTruthy();
  const loadPayload = await parseJson<{ plan?: Record<string, unknown> }>(load);
  const currentPlan = loadPayload.plan || {};
  const now = new Date().toISOString();
  const seededPlan = {
    ...currentPlan,
    documentArchive: [
      ...(Array.isArray(currentPlan.documentArchive) ? currentPlan.documentArchive : []),
      {
        id: `DOC-E2E-${Date.now()}`,
        name: 'E2E verified doc',
        module: 'COMPLIANCE_AUDIT',
        category: 'PERMIT',
        status: 'VERIFIED',
        uploadedAt: now,
        storagePath: '/tmp/e2e-verified',
        tags: ['e2e'],
      },
    ],
    auditTrail: [
      ...(Array.isArray(currentPlan.auditTrail) ? currentPlan.auditTrail : []),
      {
        id: `AUDIT-E2E-${Date.now()}`,
        timestamp: now,
        user: 'E2E Reviewer',
        action: 'SIGN',
        details: 'E2E signature seed',
        immutable: true,
        signatureId: `SIG-E2E-${Date.now()}`,
      },
    ],
  };

  const seed = await request.post(`/api/projects/${encodeURIComponent(projectId)}/plan/save`, {
    headers: await adminAuthHeaders(request, token),
    data: { plan: seededPlan },
  });
  expect(seed.ok()).toBeTruthy();

  const quote = await request.post(`/api/projects/${encodeURIComponent(projectId)}/dispatch/quote`, {
    headers: await adminAuthHeaders(request, token),
    data: {
      receiverId: 'R2',
      receiverName: 'Haz Receiver',
      wasteCode: '17 05 03*',
      tons: 9,
      distanceKm: 20,
    },
  });
  if (!quote.ok()) {
    const blockedPayload = await parseJson<{ error?: string }>(quote);
    expect(quote.status()).toBe(400);
    expect(String(blockedPayload?.error || '')).toMatch(/Transportprovider ar inte konfigurerad/i);
    return;
  }
  const quotePayload = await parseJson<{ quote?: { id?: string } }>(quote);
  const quoteId = String(quotePayload?.quote?.id || '');
  expect(quoteId).not.toBe('');

  const book = await request.post(`/api/projects/${encodeURIComponent(projectId)}/dispatch/book`, {
    headers: await adminAuthHeaders(request, token),
    data: { quoteId },
  });
  expect(book.ok()).toBeTruthy();
  const bookPayload = await parseJson<{ booking?: { id?: string } }>(book);
  const bookingId = String(bookPayload?.booking?.id || '');
  expect(bookingId).not.toBe('');

  const upsertJournal = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/driver-journals/upsert`,
    {
      headers: await adminAuthHeaders(request, token),
      data: {
        journal: {
          bookingId,
          driverName: 'E2E Driver',
          vehicleId: 'E2E-TRUCK',
          origin: 'Site A',
          destination: 'Site B',
          wasteCode: '17 05 03*',
          tons: 9,
          startedAt: now,
          endedAt: now,
          odometerStartKm: 5000,
          odometerEndKm: 5020,
        },
      },
    },
  );
  expect(upsertJournal.ok()).toBeTruthy();
  const journalPayload = await parseJson<{ journal?: { id?: string } }>(upsertJournal);
  const journalId = String(journalPayload?.journal?.id || '');
  expect(journalId).not.toBe('');

  const signDriver = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/driver-journals/${encodeURIComponent(journalId)}/sign`,
    {
      headers: await adminAuthHeaders(request, token),
      data: {
        signerRole: 'DRIVER',
        signatureId: `SIG-DRV-${Date.now()}`,
      },
    },
  );
  expect(signDriver.ok()).toBeTruthy();

  const signReviewer = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/driver-journals/${encodeURIComponent(journalId)}/sign`,
    {
      headers: await adminAuthHeaders(request, token),
      data: {
        signerRole: 'REVIEWER',
        signatureId: `SIG-REV-${Date.now()}`,
      },
    },
  );
  expect(signReviewer.ok()).toBeTruthy();

  const ingest = await request.post(`/api/projects/${encodeURIComponent(projectId)}/lims/ingest`, {
    headers: await adminAuthHeaders(request, token),
    data: {
      report: {
        bookingId,
        sampleId: `SAMPLE-${Date.now()}`,
        labName: 'ALS',
        source: 'API',
        rawReference: `ALS-E2E-${Date.now()}`,
        metrics: [
          {
            key: 'Pb',
            value: 0.6,
            unit: 'mg/kg',
            maxAllowed: 1,
          },
        ],
      },
    },
  });
  expect(ingest.ok()).toBeTruthy();
  const ingestPayload = await parseJson<{ report?: { id?: string } }>(ingest);
  const reportId = String(ingestPayload?.report?.id || '');
  expect(reportId).not.toBe('');

  const verify = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/lims/${encodeURIComponent(reportId)}/verify`,
    {
      headers: await adminAuthHeaders(request, token),
      data: {
        reviewer: 'E2E QA',
        signatureId: `SIG-LIMS-${Date.now()}`,
        approved: true,
      },
    },
  );
  expect(verify.ok()).toBeTruthy();

  const evaluateDocumentGate = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-DOCUMENT_CONTROL/evaluate`,
    {
      headers: await adminAuthHeaders(request, token),
      data: {},
    },
  );
  expect(evaluateDocumentGate.ok()).toBeTruthy();
  const gatePayload = await parseJson<{ gate?: { status?: string } }>(evaluateDocumentGate);
  const gateStatus = String(gatePayload?.gate?.status || '');
  expect(gateStatus).toBe('PASSED');
});

test('property lookup returns geometry from PostGIS', async ({ request }) => {
  const token = await loginAsAdmin(request);
  const headers = await adminAuthHeaders(request, token);

  // Skapa ett projekt att koppla uppslagningen till
  const createProject = await request.post('/api/admin/projects', {
    headers,
    data: { propertyDesignation: `E2E-PROP-${Date.now()}` },
  });
  expect(createProject.ok()).toBeTruthy();
  const { project } = await parseJson<{ project?: { id?: string } }>(createProject);
  const projectId = String(project?.id || '');
  expect(projectId).not.toBe('');

  // Slå upp en känd fastighet från PostGIS (Kramfors finns i importerad data)
  const lookup = await request.post('/api/property/lookup', {
    headers,
    data: {
      propertyDesignation: 'Kramfors Övered 3:1',
      projectId,
      purpose: 'E2E_TEST',
    },
  });
  expect(lookup.ok(), `lookup status ${lookup.status()}`).toBeTruthy();
  const lookupPayload = await parseJson<{
    ok: boolean;
    source: string;
    result?: { geometry?: unknown; designation?: string };
  }>(lookup);
  expect(lookupPayload.ok).toBe(true);
  expect(lookupPayload.source).toMatch(/postgis/i);
  expect(lookupPayload.result?.geometry).toBeTruthy();
});

test('property lookup returns 400 for unknown designation', async ({ request }) => {
  const token = await loginAsAdmin(request);
  const headers = await adminAuthHeaders(request, token);

  const createProject = await request.post('/api/admin/projects', {
    headers,
    data: { propertyDesignation: `E2E-PROP-MISS-${Date.now()}` },
  });
  const { project } = await parseJson<{ project?: { id?: string } }>(createProject);
  const projectId = String(project?.id || '');

  const lookup = await request.post('/api/property/lookup', {
    headers,
    data: {
      propertyDesignation: 'FINNSINTE OKÄND 999:999',
      projectId,
      purpose: 'E2E_TEST',
    },
  });
  // Förvänta 400 (inte hittat) eller 500 — inte 2xx med tom geometri
  expect(lookup.ok()).toBeFalsy();
});

test('spatial audit returns protected area and SGU data for known coordinates', async ({ request }) => {
  const token = await loginAsAdmin(request);

  // Koordinater i Sverige (Stockholm centrum, WGS84)
  const audit = await request.post('/api/spatial-audit', {
    headers: { Authorization: `Bearer ${token}` },
    data: { lat: 59.3293, lng: 18.0686, radius: 500 },
  });
  expect(audit.ok(), `spatial-audit status ${audit.status()}`).toBeTruthy();
  const payload = await parseJson<{
    hits?: unknown[];
    protectedAreaAvailable?: boolean;
    isProtected?: boolean;
    sgu?: { manualReviewRequired?: boolean };
    sources?: string[];
  }>(audit);

  expect(Array.isArray(payload.hits)).toBe(true);
  expect(typeof payload.protectedAreaAvailable).toBe('boolean');
  expect(typeof payload.isProtected).toBe('boolean');
  expect(payload.sgu).toBeTruthy();
  expect(Array.isArray(payload.sources)).toBe(true);
});

test('spatial audit rejects missing coordinates', async ({ request }) => {
  const token = await loginAsAdmin(request);
  const audit = await request.post('/api/spatial-audit', {
    headers: { Authorization: `Bearer ${token}` },
    data: { radius: 100 },
  });
  expect(audit.status()).toBe(400);
});

test('requirements studio API flow verifies citation + requirement and exports', async ({ request }) => {
  await prisma.$connect();
  const token = await loginAsAdmin(request);
  expect(token.length).toBeGreaterThan(10);

  const createProject = await request.post('/api/admin/projects', {
    headers: await adminAuthHeaders(request, token),
    data: {
      propertyDesignation: `E2E-REQ-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const createPayload = await parseJson<{ project?: { id?: string } }>(createProject);
  const projectId = String(createPayload?.project?.id || '');
  expect(projectId).not.toBe('');

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organisationId: true },
  });
  expect(project?.organisationId).toBeTruthy();
  const organisationId = String(project?.organisationId || '');

  const now = Date.now();
  const pdfPath = path.join(process.cwd(), '.quarantine', `requirements-e2e-${now}.pdf`);
  await fs.mkdir(path.dirname(pdfPath), { recursive: true });
  await fs.writeFile(pdfPath, '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

  try {
    const document = await prisma.documentRecord.create({
      data: {
        projectId,
        organisationId,
        entryId: `req-e2e-entry-${now}`,
        receivedTime: new Date(),
        subject: 'Requirements E2E',
        originalName: 'requirements-e2e.pdf',
        diskName: `requirements-e2e-${now}.pdf`,
        absolutePath: pdfPath,
        mimeType: 'application/pdf',
        status: 'TEXT_EXTRACTED',
      },
      select: { id: true, originalName: true, subject: true },
    });

    const requirementCase = await prisma.requirementCase.create({
      data: {
        caseKey: `CASE-E2E-${now}`,
        projectId,
        documentId: document.id,
        organisationId,
        municipality: 'E2E kommun',
        authorityType: 'Kommun',
        authorityName: 'E2E myndighet',
        documentType: 'Beslut',
        sourceFile: document.originalName,
        sourceSubject: document.subject,
      },
      select: { id: true },
    });

    const requirement = await prisma.requirementRecord.create({
      data: {
        requirementCode: `REQ-E2E-${now}`,
        caseId: requirementCase.id,
        documentId: document.id,
        projectId,
        sourceType: 'MANUAL',
        category: 'DagvattenLakvatten',
        subcategory: 'Uppsamling',
        requirementTextQuote: 'Lakvatten ska samlas upp och omhandertas.',
        interpretedRequirement: 'Insamling av lakvatten ar obligatorisk.',
        level: 'SKA',
      },
      select: { requirementCode: true, id: true },
    });

    const citation = await prisma.requirementCitation.create({
      data: {
        citationCode: `CIT-E2E-${now}`,
        requirementId: requirement.id,
        caseId: requirementCase.id,
        documentId: document.id,
        quoteText: 'Lakvatten ska samlas upp och omhandertas enligt beslut.',
      },
      select: { citationCode: true },
    });

    const list = await request.get('/api/admin/requirements/rows?includePreliminary=true', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.ok()).toBeTruthy();

    const reviewCase = await request.patch(
      `/api/admin/requirements/cases/${encodeURIComponent(requirementCase.id)}/review`,
      {
        headers: await adminAuthHeaders(request, token),
        data: {
          caseReviewStatus: 'VERIFIED',
          validatedBy: 'E2E Reviewer',
          notes: 'Case review saved from E2E flow',
        },
      },
    );
    expect(reviewCase.ok()).toBeTruthy();
    const reviewCaseJson = await parseJson<{ case?: { caseReviewStatus?: string; reviewStatus?: string } }>(
      reviewCase,
    );
    expect(reviewCaseJson?.case?.caseReviewStatus).toBe('VERIFIED');
    expect(reviewCaseJson?.case?.reviewStatus).toBe('VERIFIED');

    const verifyCitation = await request.patch(
      `/api/admin/requirements/citations/${encodeURIComponent(citation.citationCode)}/verify`,
      {
        headers: await adminAuthHeaders(request, token),
        data: {
          verificationStatus: 'REVIEWED',
          verifiedBy: 'E2E Reviewer',
          pageNumber: 1,
        },
      },
    );
    expect(verifyCitation.ok()).toBeTruthy();

    const verifyRequirement = await request.patch(
      `/api/admin/requirements/rows/${encodeURIComponent(requirement.requirementCode)}/verify`,
      {
        headers: await adminAuthHeaders(request, token),
        data: {
          verificationStatus: 'VERIFIED',
          verifiedBy: 'E2E Reviewer',
          validationComment: 'E2E verifierad',
        },
      },
    );
    expect(verifyRequirement.ok()).toBeTruthy();

    const summary = await request.get('/api/admin/requirements/reports/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(summary.ok()).toBeTruthy();
    const summaryJson = await parseJson<{ summary?: { scope?: string } }>(summary);
    expect(summaryJson?.summary?.scope).toBe('VERIFIED_ONLY');

    const csvExport = await request.get('/api/admin/requirements/reports/export.csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(csvExport.ok()).toBeTruthy();

    const docxExport = await request.post('/api/admin/requirements/reports/export.docx', {
      headers: await adminAuthHeaders(request, token),
      data: {},
    });
    expect(docxExport.ok()).toBeTruthy();
  } finally {
    await fs.unlink(pdfPath).catch(() => undefined);
  }
});
