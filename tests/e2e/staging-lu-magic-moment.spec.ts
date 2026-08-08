import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  createApiContext,
  getE2EApiBaseUrl,
  isExternalE2E,
  loginAsAdmin,
  loginAsAdminWithRefresh,
  parseJson,
} from './support';

function envString(name: string, fallback: string): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

const p3PropertyDesignation = envString('E2E_PROPERTY_DESIGNATION', 'NACKA BOO 1:1');
const resolvedApiBaseUrl = getE2EApiBaseUrl();
const isLocalTarget = /127\.0\.0\.1|localhost/i.test(resolvedApiBaseUrl);
const isExternalTarget = isExternalE2E() && !isLocalTarget;

test.describe('LU Magic Moment (PostGIS -> UI)', () => {
  let projectId = '';
  let accessToken = '';

  async function ensureProject(): Promise<{ accessToken: string; projectId: string }> {
    if (accessToken && projectId) return { accessToken, projectId };

    const api = await createApiContext();
    try {
      accessToken = await loginAsAdmin(api);
      const created = await api.post('/api/admin/projects', {
        headers: await adminAuthHeaders(api, accessToken),
        data: { propertyDesignation: p3PropertyDesignation },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const body = await parseJson<{ project?: { id?: string } }>(created);
      projectId = String(body.project?.id || '');
      expect(projectId.length).toBeGreaterThan(5);
      return { accessToken, projectId };
    } finally {
      await api.dispose();
    }
  }

  test('E2E Magic Moment: Frontend -> CoreWorkflowView -> LuWorkspace -> Backend -> PostGIS -> ExecutionKernel', async ({ page }) => {
    // 1. Skapa projekt för att kunna navigera in
    const state = await ensureProject();
    const api = await createApiContext();
    const session = await loginAsAdminWithRefresh(api);

    await page.addInitScript(() => {
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()));
      }
    });
    
    // Vi lägger in activeProject i local storage, men `CoreWorkflowView` kanske ignorerar det om den förlitar sig på intern state (vilket den verkar göra då activeProject i den är React state). 
    await page.addInitScript((input: any) => {
      window.localStorage.setItem('miljobeslut_admin_bearer', input.accessToken);
      window.localStorage.setItem('miljobeslut_admin_refresh', input.refreshToken);
      window.localStorage.setItem('miljobeslut_admin_project', input.activeProjectId);
    }, { ...session, activeProjectId: state.projectId });

    await page.goto('/v2'); // eller var nu CoreWorkflowView lever
    
    // Vänta tills vi ser sidan
    await expect(page).toHaveTitle(/Milj.*beslut/i);

    // Klicka på "Lokaliseringsutredning" knappen (måste först ha valt ett projekt, så vi måste ev klicka på ett kort i dashboard)
    const dashboardTitle = page.getByText('Projekt', { exact: true }).first();
    await expect(dashboardTitle).toBeVisible({ timeout: 60_000 });

    // Hitta projektkortet och klicka på det (ProjectDashboard renderar projektkort)
    const projectCard = page.getByText(p3PropertyDesignation).first();
    await expect(projectCard).toBeVisible({ timeout: 15_000 });
    await projectCard.click();

    // Nu har vi navigerat in i projektet och LU-knappen blir aktiverad
    const luTab = page.getByRole('button', { name: /Lokaliseringsutredning/i });
    await expect(luTab).toBeEnabled({ timeout: 15_000 });
    await luTab.click();

    // 2. Verifiera att vi är i LU Workspace
    const luWorkspace = page.getByTestId('lu-workspace');
    await expect(luWorkspace).toBeVisible({ timeout: 15_000 });

    // 3. Fyll i fastighet och slå upp
    const designationInput = page.getByTestId('lu-designation');
    await expect(designationInput).toBeVisible();
    await designationInput.fill('GÄVLE BRYNÄS 1:1'); // Some property with coordinates
    
    const lookupBtn = page.getByTestId('lu-lookup');
    await expect(lookupBtn).toBeEnabled();
    await lookupBtn.click();

    // 4. Invänta site ready
    const siteReady = page.getByTestId('lu-site-ready');
    await expect(siteReady).toBeVisible({ timeout: 30_000 });

    // 5. Kör Bedömning (Här händer hela magic moment-kedjan!)
    const runBtn = page.getByTestId('lu-run');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // 6. Invänta resultat och verifiera motor meta
    const results = page.getByTestId('lu-results');
    await expect(results).toBeVisible({ timeout: 90_000 });
    
    // Det här bekräftar att PostGIS -> ExecutionKernel har använts och svarat
    const motorMeta = page.getByTestId('lu-motor-meta');
    await expect(motorMeta).toBeVisible();
    await expect(motorMeta).toContainText('ExecutionKernel:');

    // Kolla riskresultat
    const riskEl = page.getByTestId('lu-risk');
    await expect(riskEl).toBeVisible();
    await expect(riskEl).not.toContainText('—');

    await api.dispose();
  });
});
