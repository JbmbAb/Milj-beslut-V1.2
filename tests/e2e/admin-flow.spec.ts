import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function expectAdminLoginStatus(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('admin-status-info')).toContainText(/inloggad|projektlista laddad|katalog laddad/i);
}

test('admin login from landing page', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('landing-open-admin').click();

  await page.getByTestId('admin-username-input').fill('admin');
  await page.getByTestId('admin-password-input').fill('admin-test-password');
  await page.getByTestId('admin-login-button').click();

  await expectAdminLoginStatus(page);
});

test('admin can create a project from console', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('landing-open-admin').click();

  await page.getByTestId('admin-username-input').fill('admin');
  await page.getByTestId('admin-password-input').fill('admin-test-password');
  await page.getByTestId('admin-login-button').click();
  await expectAdminLoginStatus(page);

  await page.locator('input[placeholder="Nytt projektnamn (valfritt)"]').fill(`E2E-${Date.now()}`);
  await page.getByTestId('admin-create-project-button').click();

  await expect(page.getByText(/Projekt skapat|Projekt finns redan/)).toBeVisible();
});

test('logistics one-click flow works in local preliminary mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Planera logistik' }).first().click();
  await page.getByRole('button', { name: 'Logistik och massor' }).first().click();

  await page.locator('select').first().selectOption('17 05 04');
  await page.getByPlaceholder('Exempel: 500').fill('12');
  await page.getByRole('combobox', { name: 'Mottagare (snabbval)' }).selectOption('R1');

  await page.getByPlaceholder('Namn pa forare').fill('E2E Forare');
  await page.getByPlaceholder('Registreringsnummer').fill('E2E-123');
  await page.getByPlaceholder('Namn pa ansvarig granskare').fill('E2E Granskare');

  await page.getByRole('button', { name: 'Boka transport' }).click();

  await expect(page.getByText(/Transportkedja skapad/)).toBeVisible();
  await expect(page.getByText(/Transportdokument: Transportdokument-/)).toBeVisible();
  await expect(page.getByText(/Vagkort: Vagkort-/)).toBeVisible();
  await expect(page.getByText(/Preliminart lage: data, signaturer och LIMS-spor/)).toBeVisible();
});

test('logistics blocks booking when receiver does not support selected waste code', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Planera logistik' }).first().click();
  await page.getByRole('button', { name: 'Logistik och massor' }).first().click();

  await expect(page.getByText('Interaktiv mottagarkarta')).toBeVisible();

  await page.locator('select').first().selectOption('17 05 03*');
  await page.getByPlaceholder('Exempel: 500').fill('8');
  await page.getByRole('combobox', { name: 'Mottagare (snabbval)' }).selectOption('R1');

  await expect(page.getByText('Ej tillatet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Boka transport' })).toHaveCount(0);
});

test('critical plan + gate + carbon API flow passes end-to-end', async ({ request }) => {
  const login = await request.post('/api/admin/auth/login', {
    data: {
      username: 'admin',
      password: 'admin-test-password',
    },
  });
  expect(login.ok()).toBeTruthy();
  const loginJson = await login.json();
  const token = String(loginJson.accessToken || '');
  expect(token.length).toBeGreaterThan(20);

  const createProject = await request.post('/api/admin/projects', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      propertyDesignation: `E2E-PROJECT-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const projectId = String((await createProject.json())?.project?.id || '');
  expect(projectId).not.toBe('');

  const load = await request.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(load.ok()).toBeTruthy();
  const loadedPlanRaw = (await load.json()).plan;
  const loadedPlan = loadedPlanRaw && typeof loadedPlanRaw === 'object' ? loadedPlanRaw : {};

  const nextPlan = {
    ...loadedPlan,
    name: `E2E-PLAN-${Date.now()}`,
  };
  const save = await request.post(`/api/projects/${encodeURIComponent(projectId)}/plan/save`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { plan: nextPlan },
  });
  expect(save.ok()).toBeTruthy();

  const applyTemplate = await request.post(`/api/projects/${encodeURIComponent(projectId)}/template/apply`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { templateId: 'ENV_PERMIT_CORE' },
  });
  expect(applyTemplate.ok()).toBeTruthy();

  const gate = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-PERMIT_REQUIRED/evaluate`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        permitType: 'Anmalan 9 kap',
        permitSubmitted: false,
      },
    },
  );
  expect(gate.ok()).toBeTruthy();

  const carbon = await request.post(`/api/projects/${encodeURIComponent(projectId)}/carbon/calculate`, {
    headers: { Authorization: `Bearer ${token}` },
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

  const finalLoad = await request.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(finalLoad.ok()).toBeTruthy();
  const finalPlan = (await finalLoad.json()).plan;
  expect(finalPlan.carbonSummary.lastResult).toBeTruthy();
});

test('dispatch + journal + lims API flow passes end-to-end', async ({ request }) => {
  const login = await request.post('/api/admin/auth/login', {
    data: {
      username: 'admin',
      password: 'admin-test-password',
    },
  });
  expect(login.ok()).toBeTruthy();
  const token = String((await login.json()).accessToken || '');
  expect(token.length).toBeGreaterThan(20);

  const createProject = await request.post('/api/admin/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      propertyDesignation: `E2E-DISPATCH-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const projectId = String((await createProject.json())?.project?.id || '');
  expect(projectId).not.toBe('');

  const load = await request.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(load.ok()).toBeTruthy();
  const currentPlanRaw = (await load.json()).plan;
  const currentPlan = currentPlanRaw && typeof currentPlanRaw === 'object' ? currentPlanRaw : {};
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
    headers: { Authorization: `Bearer ${token}` },
    data: { plan: seededPlan },
  });
  expect(seed.ok()).toBeTruthy();

  const quote = await request.post(`/api/projects/${encodeURIComponent(projectId)}/dispatch/quote`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      receiverId: 'R2',
      receiverName: 'Haz Receiver',
      wasteCode: '17 05 03*',
      tons: 9,
      distanceKm: 20,
    },
  });
  expect(quote.ok()).toBeTruthy();
  const quoteId = String((await quote.json())?.quote?.id || '');
  expect(quoteId).not.toBe('');

  const book = await request.post(`/api/projects/${encodeURIComponent(projectId)}/dispatch/book`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { quoteId },
  });
  expect(book.ok()).toBeTruthy();
  const bookingId = String((await book.json())?.booking?.id || '');
  expect(bookingId).not.toBe('');

  const upsertJournal = await request.post(`/api/projects/${encodeURIComponent(projectId)}/driver-journals/upsert`, {
    headers: { Authorization: `Bearer ${token}` },
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
  });
  expect(upsertJournal.ok()).toBeTruthy();
  const journalId = String((await upsertJournal.json())?.journal?.id || '');
  expect(journalId).not.toBe('');

  const signDriver = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/driver-journals/${encodeURIComponent(journalId)}/sign`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        signerRole: 'DRIVER',
        signatureId: `SIG-DRV-${Date.now()}`,
      },
    }
  );
  expect(signDriver.ok()).toBeTruthy();

  const signReviewer = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/driver-journals/${encodeURIComponent(journalId)}/sign`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        signerRole: 'REVIEWER',
        signatureId: `SIG-REV-${Date.now()}`,
      },
    }
  );
  expect(signReviewer.ok()).toBeTruthy();

  const ingest = await request.post(`/api/projects/${encodeURIComponent(projectId)}/lims/ingest`, {
    headers: { Authorization: `Bearer ${token}` },
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
  const reportId = String((await ingest.json())?.report?.id || '');
  expect(reportId).not.toBe('');

  const verify = await request.post(`/api/projects/${encodeURIComponent(projectId)}/lims/${encodeURIComponent(reportId)}/verify`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      reviewer: 'E2E QA',
      signatureId: `SIG-LIMS-${Date.now()}`,
      approved: true,
    },
  });
  expect(verify.ok()).toBeTruthy();

  const evaluateDocumentGate = await request.post(
    `/api/projects/${encodeURIComponent(projectId)}/stage-gates/gate-DOCUMENT_CONTROL/evaluate`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    }
  );
  expect(evaluateDocumentGate.ok()).toBeTruthy();
  const gateStatus = String((await evaluateDocumentGate.json())?.gate?.status || '');
  expect(gateStatus).toBe('PASSED');
});

test('requirements studio API flow verifies citation + requirement and exports', async ({ request }) => {
  await prisma.$connect();

  const login = await request.post('/api/admin/auth/login', {
    data: {
      username: 'admin',
      password: 'admin-test-password',
    },
  });
  expect(login.ok()).toBeTruthy();
  const token = String((await login.json())?.accessToken || '');
  expect(token.length).toBeGreaterThan(20);

  const createProject = await request.post('/api/admin/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      propertyDesignation: `E2E-REQ-${Date.now()}`,
    },
  });
  expect(createProject.ok()).toBeTruthy();
  const projectId = String((await createProject.json())?.project?.id || '');
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

    const verifyCitation = await request.patch(
      `/api/admin/requirements/citations/${encodeURIComponent(citation.citationCode)}/verify`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          verificationStatus: 'REVIEWED',
          verifiedBy: 'E2E Reviewer',
          pageNumber: 1,
        },
      }
    );
    expect(verifyCitation.ok()).toBeTruthy();

    const verifyRequirement = await request.patch(
      `/api/admin/requirements/rows/${encodeURIComponent(requirement.requirementCode)}/verify`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          verificationStatus: 'VERIFIED',
          verifiedBy: 'E2E Reviewer',
          validationComment: 'E2E verifierad',
        },
      }
    );
    expect(verifyRequirement.ok()).toBeTruthy();

    const summary = await request.get('/api/admin/requirements/reports/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(summary.ok()).toBeTruthy();
    const summaryJson = await summary.json();
    expect(summaryJson?.summary?.scope).toBe('VERIFIED_ONLY');

    const csvExport = await request.get('/api/admin/requirements/reports/export.csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(csvExport.ok()).toBeTruthy();

    const docxExport = await request.post('/api/admin/requirements/reports/export.docx', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(docxExport.ok()).toBeTruthy();
  } finally {
    await fs.unlink(pdfPath).catch(() => undefined);
  }
});
