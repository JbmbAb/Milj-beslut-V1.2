import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminDatabaseDumpResponse,
  AdminExamSummary,
  AdminProjectSummary,
  AppCompletionResponse,
  AppStatusResponse,
  DbAnalysisResponse,
  DbContentsResponse,
  DbStatsResponse,
  ExternalHealthReport,
  SearchFilters,
  SearchMode,
  SearchQueryResponse,
  SearchStatusResponse,
} from '../../types';
import AppStatusIndicator from './AppStatusIndicator';
import CompletionTracker from './CompletionTracker';
import AdminAuthPanel from './AdminAuthPanel';
import { StatusBanner } from './SharedAdminComponents';

const AdminSearchPanelView = lazy(() => import('./AdminSearchPanelView'));
const AdminInsightPanelView = lazy(() => import('./AdminInsightPanelView'));
const AdminInvitationsPanelView = lazy(() => import('./AdminInvitationsPanelView'));

const PROJECT_KEY = 'miljobeslut_admin_project';

interface AdminSessionConsoleProps {
  panel?: 'search' | 'insight' | 'invitations';
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  token: string;
  refreshToken: string;
  organisationId: string;
  onLogin: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}

const PanelFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <div className="flex items-center gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Admin</p>
        <p className="text-sm font-bold text-slate-700">{label}</p>
      </div>
    </div>
  </div>
);

const AdminSessionConsole: React.FC<AdminSessionConsoleProps> = ({
  panel = 'search',
  username,
  setUsername,
  password,
  setPassword,
  token,
  refreshToken,
  organisationId,
  onLogin,
  onRefresh,
  onLogout,
}) => {
  const [projectId, setProjectId] = useState(() => localStorage.getItem(PROJECT_KEY) || '');
  const [newProjectDesignation, setNewProjectDesignation] = useState('');
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [topK, setTopK] = useState(30);
  const [strictEvidence, setStrictEvidence] = useState(true);
  const [filters, setFilters] = useState<SearchFilters>({});

  const [searchData, setSearchData] = useState<SearchQueryResponse | null>(null);
  const [statusData, setStatusData] = useState<SearchStatusResponse | null>(null);
  const [examSummary, setExamSummary] = useState<AdminExamSummary | null>(null);
  const [databaseDump, setDatabaseDump] = useState<AdminDatabaseDumpResponse | null>(null);
  const [dbStats, setDbStats] = useState<DbStatsResponse | null>(null);
  const [dbAnalysis, setDbAnalysis] = useState<DbAnalysisResponse | null>(null);
  const [dbContents, setDbContents] = useState<DbContentsResponse | null>(null);
  const [dbContentsTable, setDbContentsTable] = useState<string>('documents');
  const [appStatus, setAppStatus] = useState<AppStatusResponse | null>(null);
  const [appCompletion, setAppCompletion] = useState<AppCompletionResponse | null>(null);
  const [externalHealth, setExternalHealth] = useState<ExternalHealthReport | null>(null);

  const appStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    localStorage.setItem(PROJECT_KEY, projectId);
  }, [projectId]);

  const cleanFilters = useMemo(() => {
    const normalized: SearchFilters = {};
    if (filters.municipality?.trim()) normalized.municipality = filters.municipality.trim();
    if (filters.decisionType?.trim()) normalized.decisionType = filters.decisionType.trim();
    if (filters.wasteType?.trim()) normalized.wasteType = filters.wasteType.trim();
    if (filters.status?.trim()) normalized.status = filters.status.trim();
    if (filters.legalStatus?.trim()) normalized.legalStatus = filters.legalStatus.trim();
    if (typeof filters.hazardousFlag === 'boolean') normalized.hazardousFlag = filters.hazardousFlag;
    if (filters.dateFrom?.trim()) normalized.dateFrom = filters.dateFrom.trim();
    if (filters.dateTo?.trim()) normalized.dateTo = filters.dateTo.trim();
    return normalized;
  }, [filters]);

  const secure = async <T,>(path: string, method: 'GET' | 'POST', payload?: Record<string, unknown>) => {
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
    });
    const json = await response.json();
    if (
      response.status === 401 ||
      /bearer token|invalid token|access token/i.test(String(json?.error || ''))
    ) {
      throw new Error('Adminsessionen har gatt ut. Logga in igen.');
    }
    if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
    return json as T;
  };

  const loadProjects = useCallback(async () => {
    setBusy('projects');
    try {
      const response = await fetch('/api/admin/projects', { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Project list failed');
      const list = json.projects as AdminProjectSummary[];
      setProjects(list);
      if (list.length > 0) {
        setProjectId((current) => current || list[0].id);
      }
      setInfo(`Projektlista laddad (${list.length}).`);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Project list failed');
    } finally {
      setBusy('');
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (appStatusPollRef.current) {
      clearInterval(appStatusPollRef.current);
      appStatusPollRef.current = null;
    }

    const poll = async () => {
      try {
        const [appStatusRes, completionRes] = await Promise.all([
          fetch('/api/admin/app-status', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/completion', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const statusJson = await appStatusRes.json();
        const completionJson = await completionRes.json();
        if (appStatusRes.ok && statusJson?.ok) setAppStatus(statusJson.status);
        if (completionRes.ok && completionJson?.ok) setAppCompletion(completionJson.completion);
      } catch {
        // Best effort only.
      }
    };

    void poll();
    appStatusPollRef.current = setInterval(() => void poll(), 30_000);
    return () => {
      if (appStatusPollRef.current) clearInterval(appStatusPollRef.current);
    };
  }, [token]);

  useEffect(() => {
    if (searchStatusPollRef.current) {
      clearInterval(searchStatusPollRef.current);
      searchStatusPollRef.current = null;
    }

    const poll = async () => {
      try {
        const queryString = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        const response = await fetch(`/api/search/status${queryString}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await response.json();
        if (response.ok && json?.ok) {
          setStatusData(json.status);
          return;
        }
        setStatusData(null);
      } catch {
        setStatusData(null);
      }
    };

    void poll();
    searchStatusPollRef.current = setInterval(() => void poll(), 30_000);
    return () => {
      if (searchStatusPollRef.current) clearInterval(searchStatusPollRef.current);
    };
  }, [token, projectId]);

  const login = async () => {
    setError('');
    setBusy('login');
    try {
      await onLogin();
      setInfo('Admin inloggad.');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Inloggning misslyckades');
    } finally {
      setBusy('');
    }
  };

  const refresh = async () => {
    setError('');
    setBusy('refresh');
    try {
      await onRefresh();
      setInfo('Session uppdaterad.');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Sessionsfornyelse misslyckades');
    } finally {
      setBusy('');
    }
  };

  const logout = () => {
    setSearchData(null);
    setStatusData(null);
    setInfo('Utloggad.');
    onLogout();
  };

  const createProject = async () => {
    setError('');
    setBusy('project-create');
    try {
      const data = await secure<{ ok: true; project: AdminProjectSummary; created: boolean }>(
        '/api/admin/projects',
        'POST',
        { propertyDesignation: newProjectDesignation.trim() || undefined },
      );
      setProjectId(data.project.id);
      if (!newProjectDesignation.trim()) setNewProjectDesignation(data.project.propertyDesignation);
      await loadProjects();
      setInfo(
        data.created
          ? `Projekt skapat (${data.project.propertyDesignation}).`
          : `Projekt finns redan (${data.project.propertyDesignation}).`,
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Create project failed');
    } finally {
      setBusy('');
    }
  };

  const runSearch = async () => {
    setError('');
    setBusy('search');
    try {
      const data = await secure<{ ok: true; result: SearchQueryResponse }>('/api/search/query', 'POST', {
        ...(projectId ? { projectId } : {}),
        query,
        mode,
        topK,
        strictEvidence,
        filters: cleanFilters,
      });
      setSearchData(data.result);
      setInfo(`Sokning klar (${data.result.results.length} traffar).`);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed');
    } finally {
      setBusy('');
    }
  };

  const syncRegistry = async () => {
    setError('');
    setBusy('sync');
    try {
      if (!projectId) throw new Error('Valj eller skapa ett adminprojekt fore synkronisering.');
      await secure('/api/search/sync-manifest', 'POST', { projectId });
      setInfo('Synkroniseringsjobb startat.');
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Sync failed');
    } finally {
      setBusy('');
    }
  };

  const loadDbStats = async () => {
    setError('');
    setBusy('dbstats');
    try {
      const data = await secure<{ ok: true; stats: DbStatsResponse }>('/api/admin/db-stats', 'GET');
      setDbStats(data.stats);
    } catch (statsError) {
      setError(statsError instanceof Error ? statsError.message : 'Statistik misslyckades');
    } finally {
      setBusy('');
    }
  };

  const loadExternalHealth = async () => {
    setError('');
    setBusy('externalhealth');
    try {
      const data = await secure<{ ok: true; report: ExternalHealthReport }>(
        '/api/admin/external-health',
        'GET',
      );
      setExternalHealth(data.report);
    } catch (healthError) {
      setError(healthError instanceof Error ? healthError.message : 'Health check failed');
    } finally {
      setBusy('');
    }
  };

  const loadDbAnalysis = async () => {
    setError('');
    setBusy('dbanalysis');
    try {
      const data = await secure<{ ok: true; analysis: DbAnalysisResponse }>('/api/admin/db-analysis', 'GET');
      setDbAnalysis(data.analysis);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Analys misslyckades');
    } finally {
      setBusy('');
    }
  };

  const loadDbContents = async () => {
    setError('');
    setBusy('dbcontents');
    try {
      const data = await secure<{ ok: true; contents: DbContentsResponse }>(
        '/api/admin/db-contents?limit=10',
        'GET',
      );
      setDbContents(data.contents);
    } catch (contentsError) {
      setError(contentsError instanceof Error ? contentsError.message : 'Innehall misslyckades');
    } finally {
      setBusy('');
    }
  };

  const loadExamSummary = async () => {
    setError('');
    setBusy('exam');
    try {
      const data = await secure<{ ok: true; summary: AdminExamSummary }>('/api/admin/exam-summary', 'GET');
      setExamSummary(data.summary);
    } catch (examError) {
      setError(examError instanceof Error ? examError.message : 'Exam failed');
    } finally {
      setBusy('');
    }
  };

  const loadDatabaseDump = async () => {
    setError('');
    setBusy('dbdump');
    try {
      const data = await secure<{ ok: true; dump: AdminDatabaseDumpResponse }>(
        '/api/admin/database-dump',
        'GET',
      );
      setDatabaseDump(data.dump);
    } catch (dumpError) {
      setError(dumpError instanceof Error ? dumpError.message : 'Dump failed');
    } finally {
      setBusy('');
    }
  };

  const showSearchPanel = panel === 'search';
  const showInsightPanel = panel === 'insight';
  const showInvitationsPanel = panel === 'invitations';

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-900 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-10">
        <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-slate-900 px-3 py-1 text-[10px] font-black text-white uppercase tracking-widest">
                Admin Control
              </span>
              <span className="text-xs font-bold text-slate-400">v1.2.0-STABLE</span>
            </div>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900 lg:text-5xl">
              Operativ Konsol
            </h1>
            <p className="mt-3 text-sm font-medium text-slate-500 max-w-xl">
              Centraliserad kontrollpanel for miljo-beslut.se-portalens ekosystem. Hantera projekt, overvaka
              systemhalsa och utfor avancerad databasanalys.
            </p>
          </div>
          <AppStatusIndicator appStatus={appStatus} hasActiveSession={Boolean(token)} />
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <AdminAuthPanel
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              token={token}
              refreshToken={refreshToken}
              projectId={projectId}
              setProjectId={setProjectId}
              projects={projects}
              newProjectDesignation={newProjectDesignation}
              setNewProjectDesignation={setNewProjectDesignation}
              busy={busy}
              login={login}
              refresh={refresh}
              logout={logout}
              loadProjects={loadProjects}
              createProject={createProject}
              loadMapAndDataStatus={loadDbStats}
              loadExternalHealth={loadExternalHealth}
              loadExamSummary={loadExamSummary}
              loadDatabaseDump={loadDatabaseDump}
            />
          </div>
          <div className="lg:col-span-4">
            <CompletionTracker appCompletion={appCompletion} hasActiveSession={Boolean(token)} />
          </div>
        </div>

        <StatusBanner error={error} info={info} />

        {showSearchPanel && (
          <Suspense fallback={<PanelFallback label="Laddar adminsok..." />}>
            <AdminSearchPanelView
              query={query}
              setQuery={setQuery}
              searchMode={mode}
              setSearchMode={setMode}
              topK={topK}
              setTopK={setTopK}
              strictEvidence={strictEvidence}
              setStrictEvidence={setStrictEvidence}
              filters={filters}
              setFilters={setFilters}
              projectId={projectId}
              busy={busy}
              token={token}
              runSearch={runSearch}
              syncRegistry={syncRegistry}
              searchStatus={statusData}
              searchData={searchData}
            />
          </Suspense>
        )}

        {showInsightPanel && (
          <Suspense fallback={<PanelFallback label="Laddar admininsikter..." />}>
            <AdminInsightPanelView
              dbStats={dbStats}
              externalHealth={externalHealth}
              dbAnalysis={dbAnalysis}
              dbContents={dbContents}
              dbContentsTable={dbContentsTable}
              setDbContentsTable={setDbContentsTable}
              examSummary={examSummary}
              databaseDump={databaseDump}
              busy={busy}
              token={token}
              projectId={projectId}
              organisationId={organisationId}
              secure={secure}
              onLoadDbStats={loadDbStats}
              onLoadExternalHealth={loadExternalHealth}
              onLoadDbAnalysis={loadDbAnalysis}
              onLoadDbContents={loadDbContents}
              onLoadExamSummary={loadExamSummary}
              onLoadDatabaseDump={loadDatabaseDump}
              onError={setError}
              onInfo={setInfo}
            />
          </Suspense>
        )}

        {showInvitationsPanel && (
          <Suspense fallback={<PanelFallback label="Laddar organisationsinbjudningar..." />}>
            <AdminInvitationsPanelView organisationId={organisationId} secure={secure} />
          </Suspense>
        )}

        <footer className="pt-10 border-t border-slate-200">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Miljöbeslut Admin Dashboard
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Data isolerad per organisation. Administratorsatkomst loggas i audit-trail.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm max-w-sm">
              <p className="text-xs font-black uppercase text-slate-500">Driftnotering</p>
              <p className="mt-2 text-xs text-slate-600">
                Prioritera dokument med hog score och verifierad legal status for snabbast operativt utfall.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default AdminSessionConsole;
