import React, { useEffect, useMemo, useState } from 'react';
import type {
  AdminAuthLoginResponse,
  AdminDatabaseDumpResponse,
  AdminExamSummary,
  AdminProjectSummary,
  DbAnalysisResponse,
  DbStatsResponse,
  SearchFilters,
  SearchInfoResponse,
  SearchMode,
  SearchQueryResponse,
  SearchStatusResponse,
} from '../types';
import AdminRequirementsStudio from './AdminRequirementsStudio';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_KEY = 'miljobeslut_admin_refresh';
const PROJECT_KEY = 'miljobeslut_admin_project';
const USER_KEY = 'miljobeslut_admin_user';

interface AdminSearchConsoleProps {
  panel?: 'search' | 'insight';
}

const AdminSearchConsole: React.FC<AdminSearchConsoleProps> = ({ panel = 'search' }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [newProjectDesignation, setNewProjectDesignation] = useState('');
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [topK, setTopK] = useState(30);
  const [minScore, setMinScore] = useState(0.25);
  const [strictEvidence, setStrictEvidence] = useState(true);
  const [filters, setFilters] = useState<SearchFilters>({});

  const [searchData, setSearchData] = useState<SearchQueryResponse | null>(null);
  const [statusData, setStatusData] = useState<SearchStatusResponse | null>(null);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [lantStatus, setLantStatus] = useState('');
  const [sluCount, setSluCount] = useState<number | null>(null);
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [openSyncCount, setOpenSyncCount] = useState<number | null>(null);
  const [examSummary, setExamSummary] = useState<AdminExamSummary | null>(null);
  const [databaseDump, setDatabaseDump] = useState<AdminDatabaseDumpResponse | null>(null);
  const [showDumpJson, setShowDumpJson] = useState(false);
  const [searchInfo, setSearchInfo] = useState<SearchInfoResponse['info'] | null>(null);
  const [showSearchInfo, setShowSearchInfo] = useState(false);
  const [dbStats, setDbStats] = useState<DbStatsResponse | null>(null);
  const [dbAnalysis, setDbAnalysis] = useState<DbAnalysisResponse | null>(null);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) || '');
    setRefreshToken(localStorage.getItem(REFRESH_KEY) || '');
    setProjectId(localStorage.getItem(PROJECT_KEY) || '');
    setUsername(localStorage.getItem(USER_KEY) || 'admin');
  }, []);

  useEffect(() => {
    localStorage.setItem(TOKEN_KEY, token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }, [refreshToken]);

  useEffect(() => {
    localStorage.setItem(PROJECT_KEY, projectId);
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(USER_KEY, username);
  }, [username]);

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

  const rows = useMemo(() => {
    return (searchData?.results || []).filter((result) => result.score >= minScore);
  }, [searchData, minScore]);

  const avgScore = useMemo(() => {
    if (rows.length === 0) return 0;
    return rows.reduce((sum, result) => sum + result.score, 0) / rows.length;
  }, [rows]);

  const qualifiedHits = useMemo(() => rows.filter((result) => result.score >= 0.55).length, [rows]);

  const activeFilterChips = useMemo(() => {
    return Object.entries(cleanFilters).map(([key, value]) => `${key}: ${String(value)}`);
  }, [cleanFilters]);

  const topMunicipalityOpportunities = useMemo(() => {
    const buckets = new Map<string, { count: number; scoreSum: number }>();
    for (const result of rows) {
      const key = result.metadata.municipality || 'Okand';
      const current = buckets.get(key) || { count: 0, scoreSum: 0 };
      current.count += 1;
      current.scoreSum += result.score;
      buckets.set(key, current);
    }
    return Array.from(buckets.entries())
      .map(([municipality, data]) => ({
        municipality,
        count: data.count,
        avgScore: data.scoreSum / data.count,
      }))
      .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)
      .slice(0, 5);
  }, [rows]);

  const secure = async <T,>(path: string, method: 'GET' | 'POST', payload?: Record<string, unknown>) => {
    if (!token) throw new Error('Ingen admin-token');
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
    return json as T;
  };

  const login = async () => {
    setError('');
    setBusy('login');
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = (await response.json()) as ({ ok: true } & AdminAuthLoginResponse) | { ok: false; error: string };
      if (!response.ok || !json.ok) throw new Error((json as { error?: string }).error || 'Inloggning misslyckades');
      setToken(json.accessToken);
      setRefreshToken(json.refreshToken);
      setPassword('');
      setInfo('Admin inloggad.');
      await loadProjects(json.accessToken);
      await loadCatalog(json.accessToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Inloggning misslyckades');
    } finally {
      setBusy('');
    }
  };

  const refresh = async () => {
    setError('');
    setBusy('refresh');
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Sessionsförnyelse misslyckades');
      setToken(String(json.accessToken || ''));
      setRefreshToken(String(json.refreshToken || ''));
      setInfo('Session uppdaterad.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sessionsförnyelse misslyckades');
    } finally {
      setBusy('');
    }
  };

  const logout = () => {
    setToken('');
    setRefreshToken('');
    setSearchData(null);
    setStatusData(null);
    setInfo('Utloggad.');
  };

  const loadProjects = async (overrideToken?: string) => {
    setBusy('projects');
    try {
      const response = await fetch('/api/admin/projects', {
        headers: { Authorization: `Bearer ${overrideToken || token}` },
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Project list failed');
      const list = (json.projects || []) as AdminProjectSummary[];
      setProjects(list);
      if (!projectId && list.length > 0) setProjectId(list[0].id);
      setInfo(`Projektlista laddad (${list.length}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Project list failed');
    } finally {
      setBusy('');
    }
  };

  const createProject = async () => {
    setError('');
    setBusy('project-create');
    try {
      const response = await fetch('/api/admin/projects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          propertyDesignation: newProjectDesignation.trim() || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Create project failed');
      const project = json.project as AdminProjectSummary;
      setProjectId(project.id);
      if (!newProjectDesignation.trim()) {
        setNewProjectDesignation(project.propertyDesignation);
      }
      await loadProjects();
      setInfo(json.created ? `Projekt skapat (${project.propertyDesignation}).` : `Projekt finns redan (${project.propertyDesignation}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create project failed');
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
      setInfo(
        data.result.scope === 'global'
          ? `Fri sokning klar (${data.result.results.length} traffar).`
          : `Sokning klar (${data.result.results.length} traffar).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy('');
    }
  };

  const runSync = async () => {
    if (!projectId) {
      setError('Ange projectId');
      return;
    }
    setBusy('sync');
    try {
      await secure('/api/search/sync-manifest', 'POST', { projectId });
      setInfo('Sync jobb skickat.');
      await runStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy('');
    }
  };

  const runStatus = async () => {
    if (!projectId) {
      setError('Ange projectId');
      return;
    }
    setBusy('status');
    try {
      const data = await secure<{ ok: true; status: SearchStatusResponse }>(
        `/api/search/status/${encodeURIComponent(projectId)}`,
        'GET'
      );
      setStatusData(data.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status failed');
    } finally {
      setBusy('');
    }
  };

  const runRetry = async () => {
    if (!projectId) {
      setError('Ange projectId');
      return;
    }
    setBusy('retry');
    try {
      await secure('/api/search/retry-failed', 'POST', { projectId, limit: 200 });
      setInfo('Retry klart.');
      await runStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setBusy('');
    }
  };

  const runRecoverStale = async () => {
    setError('');
    if (!projectId) {
      setError('Ange projectId');
      return;
    }
    setBusy('recover');
    try {
      const data = await secure<{ ok: true; recovered: number; processedImmediately: number }>(
        '/api/search/recover-stale',
        'POST',
        { projectId, maxAgeMinutes: 30, limit: 200 }
      );
      setInfo(`Recovered stale jobb: ${data.recovered}. Processade direkt: ${data.processedImmediately}.`);
      await runStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recover stale failed');
    } finally {
      setBusy('');
    }
  };

  const loadCatalog = async (overrideToken?: string) => {
    try {
      const response = await fetch('/api/datasources/catalog', {
        headers: { Authorization: `Bearer ${overrideToken || token}` },
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Catalog failed');
      setCatalogCount(Array.isArray(json.sources) ? json.sources.length : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Catalog failed');
    }
  };

  const loadSearchInfo = async () => {
    setBusy('search-info');
    try {
      const data = await secure<SearchInfoResponse>('/api/search/info', 'GET');
      setSearchInfo(data.info);
      setShowSearchInfo(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte hämta sökinfo');
    } finally {
      setBusy('');
    }
  };

  const loadMapAndDataStatus = async () => {
    setBusy('datasources');
    try {
      const lant = await secure<{ ok: true; result: { ok: boolean; status: number } }>(
        '/api/datasources/lantmateriet/open/status',
        'GET'
      );
      const slu = await secure<{ ok: true; products: unknown[] }>('/api/datasources/slu/status', 'GET');
      const openSync = await secure<{ ok: true; results: unknown[] }>('/api/datasources/open/sync', 'POST', {});
      const audit = await secure<{ ok: true; records: unknown[] }>('/api/audit/export', 'GET');
      setLantStatus(`${lant.result.ok ? 'OK' : 'FAIL'} (${lant.result.status})`);
      setSluCount(Array.isArray(slu.products) ? slu.products.length : 0);
      setOpenSyncCount(Array.isArray(openSync.results) ? openSync.results.length : 0);
      setAuditCount(Array.isArray(audit.records) ? audit.records.length : 0);
      setInfo('Kartlager och datakallor uppdaterade.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Datasource check failed');
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
      setInfo('Examenssammanstallning laddad.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Exam summary failed');
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
      setInfo('Databasstatistik laddad.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Databasstatistik misslyckades');
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
      setInfo('Databasanalys laddad.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Databasanalys misslyckades');
    } finally {
      setBusy('');
    }
  };

  const loadDatabaseDump = async () => {
    setError('');
    setBusy('dbdump');
    try {
      const data = await secure<{ ok: true; dump: AdminDatabaseDumpResponse }>(
        '/api/admin/database-dump?includeSearchText=true&includeChunkText=true',
        'GET'
      );
      setDatabaseDump(data.dump);
      const totalRows = Object.values(data.dump.countByTable).reduce((sum, count) => sum + Number(count || 0), 0);
      setInfo(`Databasdump laddad (${totalRows} rader).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Database dump failed');
    } finally {
      setBusy('');
    }
  };

  const downloadDatabaseDump = () => {
    if (!databaseDump) return;
    const payload = JSON.stringify(databaseDump, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `miljobeslut-database-dump-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K] | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters({});
    setQuery('');
    setMode('hybrid');
    setMinScore(0.25);
    setTopK(30);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-in fade-in duration-500">
      <section className="rounded-3xl border border-slate-800 bg-slate-950 p-6 text-white">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-black">Admin shell</p>
            <h2 className="mt-1 text-2xl font-black md:text-3xl">Admin Console med full access</h2>
            <p className="mt-2 text-sm text-slate-300">
              {panel === 'insight'
                ? 'Analyspanel for sokkvalitet, status och prioriteringsstod.'
                : 'Egen inloggning, utokad sokning, kartlagerkontroll och operativ uppfoljning.'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300">
            Aktivt projekt: {projectId || 'Alla projekt (fri sokning)'}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Traffar (filtrerade)" value={String(rows.length)} />
          <KpiCard label="Snittscore" value={`${(avgScore * 100).toFixed(1)}%`} />
          <KpiCard label="Kvalificerade traffar" value={String(qualifiedHits)} />
          <KpiCard label="Aktiva filter" value={String(activeFilterChips.length)} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-900">Admin inloggning och session</h3>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              data-testid="admin-username-input"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Användarnamn"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              data-testid="admin-password-input"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Lösenord"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              data-testid="admin-login-button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
              disabled={Boolean(busy)}
              onClick={login}
            >
              {busy === 'login' ? 'Arbetar...' : 'Logga in'}
            </button>
            <button
              data-testid="admin-refresh-button"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !refreshToken}
              onClick={refresh}
            >
              {busy === 'refresh' ? 'Arbetar...' : 'Refresh token'}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={() => loadProjects()}
            >
              {busy === 'projects' ? 'Arbetar...' : 'Ladda projekt'}
            </button>
            <button
              data-testid="admin-create-project-button"
              className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={createProject}
            >
              {busy === 'project-create' ? 'Arbetar...' : 'Skapa projekt'}
            </button>
            <button
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={loadMapAndDataStatus}
            >
              {busy === 'datasources' ? 'Arbetar...' : 'Kartlager/data status'}
            </button>
            <button
              className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={loadExamSummary}
            >
              {busy === 'exam' ? 'Arbetar...' : 'Examensrapport'}
            </button>
            <button
              className="rounded-xl bg-sky-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={loadDatabaseDump}
            >
              {busy === 'dbdump' ? 'Arbetar...' : 'Databasdump'}
            </button>
            <button
              className="rounded-xl bg-slate-700 px-4 py-2 text-xs font-bold text-white"
              onClick={logout}
            >
              Logga ut
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <select
              data-testid="admin-project-select"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Valj projekt</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.propertyDesignation} ({project.organisation.name})
                </option>
              ))}
            </select>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="ProjectId manuellt"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Nytt projektnamn (valfritt)"
              value={newProjectDesignation}
              onChange={(event) => setNewProjectDesignation(event.target.value)}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">Lamna projekt tomt for fri sokning i hela databasen (adminlage).</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Operativ oversikt</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Kvalificerade traffar</span>
                <span className="font-black">{qualifiedHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Aktiva filter</span>
                <span className="font-black">{activeFilterChips.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Snittscore</span>
                <span className="font-black">{(avgScore * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="text-slate-600">Kandidater</span>
                <span className="font-black text-slate-900">{searchData?.totalCandidates ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Kartlager och datakallor</p>
            <div className="mt-3 space-y-1 text-xs text-slate-700">
              <p>Katalogkallor: <span className="font-black">{catalogCount ?? '-'}</span></p>
              <p>Lantmateriet: <span className="font-black">{lantStatus || '-'}</span></p>
              <p>SLU produkter: <span className="font-black">{sluCount ?? '-'}</span></p>
              <p>Open sync resultat: <span className="font-black">{openSyncCount ?? '-'}</span></p>
              <p>Auditrader: <span className="font-black">{auditCount ?? '-'}</span></p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Databasinnehåll</p>
            <h3 className="text-lg font-black text-slate-900">Kravrader · Kommuner · Dokument</h3>
            <p className="mt-1 text-xs text-slate-500">Antal kravrader, kommuner och dokument i databasen – totalt och per kommun.</p>
          </div>
          <button
            data-testid="admin-load-db-stats-button"
            className="rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
            disabled={Boolean(busy) || !token}
            onClick={loadDbStats}
          >
            {busy === 'dbstats' ? 'Hämtar...' : 'Hämta statistik'}
          </button>
        </div>

        {!dbStats && (
          <p className="mt-4 text-sm text-slate-500">Klicka "Hämta statistik" för att se antal kravrader, kommuner och dokument.</p>
        )}

        {dbStats && (
          <>
            <p className="mt-3 text-xs text-slate-500">Genererad: {new Date(dbStats.generatedAt).toLocaleString('sv-SE')}</p>

            {/* ── Threshold warning banner ── */}
            {!dbStats.thresholds.allOk && (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
                <span className="mt-0.5 text-lg leading-none">⚠️</span>
                <div>
                  <p className="text-sm font-black text-red-800">Datakvalitetsgräns ej uppnådd</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-red-700 space-y-0.5">
                    {!dbStats.thresholds.requirementsOk && (
                      <li>Kravrader: {dbStats.totals.requirements.toLocaleString('sv-SE')} av {dbStats.thresholds.minRequirements.toLocaleString('sv-SE')} krävda</li>
                    )}
                    {!dbStats.thresholds.municipalitiesOk && (
                      <li>Kommuner: {dbStats.totals.municipalities.toLocaleString('sv-SE')} av {dbStats.thresholds.minMunicipalities.toLocaleString('sv-SE')} krävda</li>
                    )}
                    {!dbStats.thresholds.documentsOk && (
                      <li>Dokument: {dbStats.totals.documents.toLocaleString('sv-SE')} av {dbStats.thresholds.minDocuments.toLocaleString('sv-SE')} krävda</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
            {dbStats.thresholds.allOk && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
                <span className="text-base leading-none">✅</span>
                <p className="text-sm font-bold text-green-800">Alla datakvalitetsgränser uppnådda</p>
              </div>
            )}

            {/* ── Summary cards ── */}
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className={`rounded-2xl border p-4 text-center ${dbStats.thresholds.documentsOk ? 'border-teal-200 bg-teal-50' : 'border-red-200 bg-red-50'}`}>
                <p className={`text-[11px] font-black uppercase tracking-widest ${dbStats.thresholds.documentsOk ? 'text-teal-700' : 'text-red-700'}`}>
                  Dokument {dbStats.thresholds.documentsOk ? '✓' : '✗'}
                </p>
                <p className={`mt-1 text-3xl font-black ${dbStats.thresholds.documentsOk ? 'text-teal-900' : 'text-red-900'}`}>
                  {dbStats.totals.documents.toLocaleString('sv-SE')}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">min {dbStats.thresholds.minDocuments.toLocaleString('sv-SE')}</p>
              </div>
              <div className={`rounded-2xl border p-4 text-center ${dbStats.thresholds.requirementsOk ? 'border-indigo-200 bg-indigo-50' : 'border-red-200 bg-red-50'}`}>
                <p className={`text-[11px] font-black uppercase tracking-widest ${dbStats.thresholds.requirementsOk ? 'text-indigo-700' : 'text-red-700'}`}>
                  Kravrader {dbStats.thresholds.requirementsOk ? '✓' : '✗'}
                </p>
                <p className={`mt-1 text-3xl font-black ${dbStats.thresholds.requirementsOk ? 'text-indigo-900' : 'text-red-900'}`}>
                  {dbStats.totals.requirements.toLocaleString('sv-SE')}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">min {dbStats.thresholds.minRequirements.toLocaleString('sv-SE')}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  <span aria-label="Kravrader från ärendesystemet">{dbStats.totals.requirementsFromCases.toLocaleString('sv-SE')} ärenden</span>
                  {' + '}
                  <span aria-label="Kravrader från e-postutdrag">{dbStats.totals.requirementsExtracted.toLocaleString('sv-SE')} utdrag</span>
                </p>
              </div>
              <div className={`rounded-2xl border p-4 text-center ${dbStats.thresholds.municipalitiesOk ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
                <p className={`text-[11px] font-black uppercase tracking-widest ${dbStats.thresholds.municipalitiesOk ? 'text-amber-700' : 'text-red-700'}`}>
                  Kommuner {dbStats.thresholds.municipalitiesOk ? '✓' : '✗'}
                </p>
                <p className={`mt-1 text-3xl font-black ${dbStats.thresholds.municipalitiesOk ? 'text-amber-900' : 'text-red-900'}`}>
                  {dbStats.totals.municipalities.toLocaleString('sv-SE')}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">min {dbStats.thresholds.minMunicipalities.toLocaleString('sv-SE')}</p>
              </div>
            </div>

            {dbStats.perMunicipality.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Per kommun</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Kommun</th>
                        <th className="px-4 py-2 text-right">Dokument</th>
                        <th className="px-4 py-2 text-right">Kravrader</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dbStats.perMunicipality.map((row) => (
                        <tr key={row.municipality} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-medium text-slate-800">{row.municipality}</td>
                          <td className="px-4 py-2 text-right font-semibold text-teal-700">{row.documents.toLocaleString('sv-SE')}</td>
                          <td className="px-4 py-2 text-right font-semibold text-indigo-700">{row.requirements.toLocaleString('sv-SE')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════
          DATABASANALYS – djupanalys av krav, dokument, täckning
      ══════════════════════════════════════════════════════════ */}
      <section data-testid="db-analysis-section" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Databasanalys</p>
            <h3 className="text-lg font-black text-slate-900">Kategorier · Kvalitet · Täckning · Gap</h3>
            <p className="mt-1 text-xs text-slate-500">
              Djupanalys av kravkategorier, kodningskvalitet, dokumenttäckning och kommunala datalgap.
            </p>
          </div>
          <button
            data-testid="admin-load-db-analysis-button"
            className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
            disabled={Boolean(busy) || !token}
            onClick={loadDbAnalysis}
          >
            {busy === 'dbanalysis' ? 'Analyserar...' : 'Kör analys'}
          </button>
        </div>

        {!dbAnalysis && (
          <p className="mt-4 text-sm text-slate-500">
            Klicka "Kör analys" för att se en djupanalys av databasens innehåll.
          </p>
        )}

        {dbAnalysis && (
          <>
            <p className="mt-3 text-xs text-slate-500">Genererad: {new Date(dbAnalysis.generatedAt).toLocaleString('sv-SE')}</p>

            {/* ── Täckning ──────────────────────────────────────────────────── */}
            <div className="mt-5">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Dokumenttäckning</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Med krav</p>
                  <p className="mt-1 text-2xl font-black text-indigo-900">{dbAnalysis.coverage.documentsWithRequirements.toLocaleString('sv-SE')}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Utan krav</p>
                  <p className="mt-1 text-2xl font-black text-slate-700">{dbAnalysis.coverage.documentsWithoutRequirements.toLocaleString('sv-SE')}</p>
                </div>
                <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-teal-600">Täckningsgrad</p>
                  <p className="mt-1 text-2xl font-black text-teal-900">{dbAnalysis.coverage.coverageRatioPct} %</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Krav/dok (snitt)</p>
                  <p className="mt-1 text-2xl font-black text-amber-900">{dbAnalysis.coverage.avgRequirementsPerCoveredDocument}</p>
                </div>
              </div>

              {/* Municipality confidence buckets */}
              <div className="mt-4">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">Kommunnamnskvalitet (confidence-buckets)</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Hög ≥0.8', val: dbAnalysis.documents.municipalityConfidenceBuckets.high, color: 'bg-green-500' },
                    { label: 'Medel 0.5–0.8', val: dbAnalysis.documents.municipalityConfidenceBuckets.medium, color: 'bg-yellow-400' },
                    { label: 'Låg <0.5', val: dbAnalysis.documents.municipalityConfidenceBuckets.low, color: 'bg-red-400' },
                    { label: 'Saknas', val: dbAnalysis.documents.municipalityConfidenceBuckets.missing, color: 'bg-slate-300' },
                  ].map((b) => (
                    <div key={b.label} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${b.color}`} />
                      <span className="font-medium text-slate-700">{b.label}</span>
                      <span className="font-black text-slate-900">{b.val.toLocaleString('sv-SE')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Gap-analys ─────────────────────────────────────────────────── */}
            {(dbAnalysis.coverage.municipalitiesDocumentsOnly.length > 0 || dbAnalysis.coverage.municipalitiesRequirementsOnly.length > 0) && (
              <div className="mt-5">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Gap-analys: kommuner</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Kommuner med båda ({dbAnalysis.coverage.municipalitiesWithBoth})
                    </p>
                    <p className="text-xs text-slate-500">Har både dokument och kravrader.</p>
                  </div>
                  {dbAnalysis.coverage.municipalitiesDocumentsOnly.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1">
                        Dokument utan krav ({dbAnalysis.coverage.municipalitiesDocumentsOnly.length})
                      </p>
                      <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                        {dbAnalysis.coverage.municipalitiesDocumentsOnly.map((m) => (
                          <li key={m} className="text-xs text-amber-800">{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {dbAnalysis.coverage.municipalitiesRequirementsOnly.length > 0 && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">
                        Krav utan dokument ({dbAnalysis.coverage.municipalitiesRequirementsOnly.length})
                      </p>
                      <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                        {dbAnalysis.coverage.municipalitiesRequirementsOnly.map((m) => (
                          <li key={m} className="text-xs text-red-800">{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Kravkategorier ─────────────────────────────────────────────── */}
            {dbAnalysis.requirements.byCategory.length > 0 && (
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Krav per kategori</p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Kategori</th>
                          <th className="px-3 py-2 text-right">Antal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {dbAnalysis.requirements.byCategory.map((r) => (
                          <tr key={r.category} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-medium text-slate-700">{r.category}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-indigo-700">{r.count.toLocaleString('sv-SE')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {/* Coding confidence */}
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Kodningskvalitet (codingConfidence)</p>
                    <div className="flex flex-col gap-1.5">
                      {dbAnalysis.requirements.byCodingConfidence.map((r) => {
                        const total = dbAnalysis.requirements.byCodingConfidence.reduce((s, x) => s + x.count, 0);
                        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
                        const barColor = r.confidence === 'HIGH' ? 'bg-green-500' : r.confidence === 'MEDIUM' ? 'bg-yellow-400' : 'bg-red-400';
                        return (
                          <div key={r.confidence}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-slate-600">{r.confidence}</span>
                              <span className="text-xs font-black text-slate-800">{r.count.toLocaleString('sv-SE')} ({pct}%)</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-100">
                              <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Status in notification */}
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status i underrättelse</p>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2 text-right">Antal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dbAnalysis.requirements.byStatus.map((r) => (
                            <tr key={r.status} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 font-medium text-slate-700">{r.status}</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{r.count.toLocaleString('sv-SE')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Citations + flags ──────────────────────────────────────────── */}
            <div className="mt-4 flex flex-wrap gap-3">
              {[
                { label: 'Krav med citeringar', val: dbAnalysis.requirements.withCitationsCount },
                { label: 'Totalt citeringar', val: dbAnalysis.requirements.citationsTotal },
                { label: 'Kommunspecifika krav', val: dbAnalysis.requirements.municipalitySpecificCount },
                { label: 'Minimikrav', val: dbAnalysis.requirements.minimumRequirementCount },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{item.label}</p>
                  <p className="mt-0.5 text-lg font-black text-slate-900">{item.val.toLocaleString('sv-SE')}</p>
                </div>
              ))}
            </div>

            {/* ── Utdragna krav (ExtractedRequirement) ──────────────────────── */}
            {dbAnalysis.extractedRequirements.byCategory.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">
                  Utdragna krav (e-post/Outlook-pipeline)
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Kategori</th>
                          <th className="px-3 py-2 text-right">Antal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {dbAnalysis.extractedRequirements.byCategory.map((r) => (
                          <tr key={r.category} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-medium text-slate-700">{r.category}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-violet-700">{r.count.toLocaleString('sv-SE')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500 mb-2">Confidence-buckets</p>
                    <div className="flex flex-col gap-1.5">
                      {[
                        { label: 'Hög ≥0.8', val: dbAnalysis.extractedRequirements.confidenceBuckets.high, color: 'bg-green-500' },
                        { label: 'Medel 0.5–0.8', val: dbAnalysis.extractedRequirements.confidenceBuckets.medium, color: 'bg-yellow-400' },
                        { label: 'Låg <0.5', val: dbAnalysis.extractedRequirements.confidenceBuckets.low, color: 'bg-red-400' },
                      ].map((b) => {
                        const total = dbAnalysis.extractedRequirements.confidenceBuckets.high +
                          dbAnalysis.extractedRequirements.confidenceBuckets.medium +
                          dbAnalysis.extractedRequirements.confidenceBuckets.low;
                        const pct = total > 0 ? Math.round((b.val / total) * 100) : 0;
                        return (
                          <div key={b.label}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-medium text-slate-600">{b.label}</span>
                              <span className="text-xs font-black text-slate-800">{b.val.toLocaleString('sv-SE')} ({pct}%)</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-100">
                              <div className={`h-2 rounded-full ${b.color}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Examensarbete</p>
            <h3 className="text-lg font-black text-slate-900">Databasbaserad sammanstallning</h3>
          </div>
          <button
            className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
            disabled={Boolean(busy) || !token}
            onClick={loadExamSummary}
          >
            {busy === 'exam' ? 'Arbetar...' : 'Uppdatera sammanstallning'}
          </button>
        </div>

        {!examSummary && <p className="mt-4 text-sm text-slate-500">Ingen sammanstallning hamtad an.</p>}

        {examSummary && (
          <>
            <p className="mt-4 text-xs text-slate-500">Genererad: {new Date(examSummary.generatedAt).toLocaleString('sv-SE')}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase text-slate-500">Projekt</p>
                <p className="text-lg font-black text-slate-900">{examSummary.totals.projects}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase text-slate-500">Dokument</p>
                <p className="text-lg font-black text-slate-900">{examSummary.totals.documents}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase text-slate-500">Sokningar</p>
                <p className="text-lg font-black text-slate-900">{examSummary.totals.searches}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase text-slate-500">Planstates</p>
                <p className="text-lg font-black text-slate-900">{examSummary.totals.planStates}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase text-slate-500">Carbon ready</p>
                <p className="text-lg font-black text-slate-900">{examSummary.planning.carbonReadyProjects}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-[10px] uppercase text-slate-500">Gate-status</p>
                <p className="mt-1 text-xs text-slate-700">Required: <span className="font-bold">{examSummary.planning.gatesRequired}</span></p>
                <p className="text-xs text-slate-700">Passed: <span className="font-bold">{examSummary.planning.gatesPassed}</span></p>
                <p className="text-xs text-slate-700">Blocked: <span className="font-bold">{examSummary.planning.gatesBlocked}</span></p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-[10px] uppercase text-slate-500">Sokprestanda</p>
                <p className="mt-1 text-xs text-slate-700">Avg ms: <span className="font-bold">{examSummary.searchPerformance.avgElapsedMs.toFixed(1)}</span></p>
                <p className="text-xs text-slate-700">Avg resultat: <span className="font-bold">{examSummary.searchPerformance.avgResults.toFixed(1)}</span></p>
                <p className="text-xs text-slate-700">
                  Senaste: <span className="font-bold">{examSummary.searchPerformance.latestQueryAt ? new Date(examSummary.searchPerformance.latestQueryAt).toLocaleString('sv-SE') : '-'}</span>
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-[10px] uppercase text-slate-500">Mallanvandning</p>
                {examSummary.templateUsage.slice(0, 4).map((item) => (
                  <p key={item.templateId} className="mt-1 text-xs text-slate-700">
                    {item.templateId}: <span className="font-bold">{item.count}</span>
                  </p>
                ))}
                {examSummary.templateUsage.length === 0 && <p className="mt-1 text-xs text-slate-500">Ingen mallstatistik.</p>}
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-[10px] uppercase text-slate-500">Bankrisk (v1)</p>
                <p className="mt-1 text-xs text-slate-700">Snittscore: <span className="font-bold">{examSummary.bankRisk.averageReadinessScore.toFixed(1)}</span></p>
                <p className="text-xs text-slate-700">Gate pass: <span className="font-bold">{examSummary.bankRisk.gatePassRatePct.toFixed(1)}%</span></p>
                <p className="text-xs text-slate-700">Verifierade docs: <span className="font-bold">{examSummary.bankRisk.verifiedDocCoveragePct.toFixed(1)}%</span></p>
                <p className="text-xs text-slate-700">Band L/M/H: <span className="font-bold">{examSummary.bankRisk.riskBands.low}/{examSummary.bankRisk.riskBands.medium}/{examSummary.bankRisk.riskBands.high}</span></p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-[10px] uppercase text-slate-500">EU-taxonomi (v1)</p>
                <p className="mt-1 text-xs text-slate-700">Eligible: <span className="font-bold">{examSummary.euTaxonomy.eligibleProjects}</span></p>
                <p className="text-xs text-slate-700">Aligned: <span className="font-bold">{examSummary.euTaxonomy.alignedProjects}</span></p>
                <p className="text-xs text-slate-700">Alignment: <span className="font-bold">{examSummary.euTaxonomy.alignmentPct.toFixed(1)}%</span></p>
                <p className="text-xs text-slate-700">Kriterier: <span className="font-bold">Carbon + Document gate + no blocked + 1 verified doc</span></p>
              </div>
            </div>
          </>
        )}
      </section>

      <AdminRequirementsStudio token={token} onError={setError} onInfo={setInfo} />

      {databaseDump && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Databasaccess</p>
              <h3 className="text-lg font-black text-slate-900">Komplett databasdump (admin)</h3>
              <p className="mt-1 text-xs text-slate-500">
                Genererad: {new Date(databaseDump.generatedAt).toLocaleString('sv-SE')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                onClick={() => setShowDumpJson((prev) => !prev)}
              >
                {showDumpJson ? 'Dolj JSON' : 'Visa JSON'}
              </button>
              <button
                className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white"
                onClick={downloadDatabaseDump}
              >
                Ladda ner JSON
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {Object.entries(databaseDump.countByTable)
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([tableName, rowCount]) => (
                <div key={tableName} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] uppercase text-slate-500">{tableName}</p>
                  <p className="text-base font-black text-slate-900">{rowCount}</p>
                </div>
              ))}
          </div>

          {showDumpJson && (
            <div className="mt-4 max-h-[480px] overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-3">
              <pre className="text-[11px] leading-relaxed text-slate-200">
                {JSON.stringify(databaseDump.tables, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-900">
          {panel === 'insight' ? 'Sokning for analys och prioritering' : 'Utokad sokning och filtrering'}
        </h3>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6">
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
            placeholder="Soktext"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={mode}
            onChange={(event) => setMode(event.target.value as SearchMode)}
          >
            <option value="hybrid">Hybrid</option>
            <option value="semantic">Semantic</option>
            <option value="lexical">Lexical</option>
          </select>
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            type="number"
            min={1}
            max={100}
            value={topK}
            onChange={(event) => setTopK(Number(event.target.value || 20))}
          />
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value || 0.2))}
          />
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Kommun"
            value={filters.municipality || ''}
            onChange={(event) => updateFilter('municipality', event.target.value || undefined)}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-7">
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Avfallstyp"
            value={filters.wasteType || ''}
            onChange={(event) => updateFilter('wasteType', event.target.value || undefined)}
          />
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={filters.decisionType || ''}
            onChange={(event) => updateFilter('decisionType', event.target.value || undefined)}
          >
            <option value="">Beslutstyp (alla)</option>
            <option value="BIFALL">Bifall</option>
            <option value="AVSLAG">Avslag</option>
          </select>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={filters.status || ''}
            onChange={(event) => updateFilter('status', event.target.value || undefined)}
          >
            <option value="">Status (alla)</option>
            <option value="DRAFT">Draft</option>
            <option value="VERIFIED">Verifierad</option>
            <option value="WARNING">Warning</option>
            <option value="BLOCKED">Blocked</option>
          </select>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={filters.legalStatus || ''}
            onChange={(event) => updateFilter('legalStatus', event.target.value || undefined)}
          >
            <option value="">Legal status (alla)</option>
            <option value="UTKAST">Utkast</option>
            <option value="VERIFIERAD">Verifierad</option>
            <option value="KRAVER_MANUELL">Krav manuell kontroll</option>
          </select>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={typeof filters.hazardousFlag === 'boolean' ? String(filters.hazardousFlag) : ''}
            onChange={(event) => {
              if (!event.target.value) {
                updateFilter('hazardousFlag', undefined);
                return;
              }
              updateFilter('hazardousFlag', event.target.value === 'true');
            }}
          >
            <option value="">Farlighet (alla)</option>
            <option value="true">Farligt avfall</option>
            <option value="false">Ej farligt</option>
          </select>
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            type="date"
            value={filters.dateFrom || ''}
            onChange={(event) => updateFilter('dateFrom', event.target.value || undefined)}
          />
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            type="date"
            value={filters.dateTo || ''}
            onChange={(event) => updateFilter('dateTo', event.target.value || undefined)}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              data-testid="admin-run-search-button"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={runSearch}
          >
            {busy === 'search' ? 'Arbetar...' : 'Kor sokning'}
          </button>
          <div className="flex gap-2">
            <button
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={runSync}
            >
              {busy === 'sync' ? '...' : 'Sync'}
            </button>
            <button
              className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={runStatus}
            >
              {busy === 'status' ? '...' : 'Status'}
            </button>
            <button
              className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={runRetry}
            >
              {busy === 'retry' ? '...' : 'Retry'}
            </button>
            <button
              className="rounded-xl bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={runRecoverStale}
            >
              {busy === 'recover' ? '...' : 'Recover'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              checked={strictEvidence}
              onChange={(event) => setStrictEvidence(event.target.checked)}
            />
            Strict RAG: krav pa kallcitat
          </label>
          <span className="text-[11px] text-slate-500">
            AI-svar markeras som utkast och ska alltid granskas manuellt.
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600"
            onClick={resetFilters}
          >
            Nollstall filter
          </button>
          {activeFilterChips.map((chip) => (
            <span
              key={chip}
              className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700"
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
            disabled={Boolean(busy) || !token}
            onClick={loadSearchInfo}
          >
            {busy === 'search-info' ? 'Hämtar...' : '? Vad är sökbart i databasen?'}
          </button>
          {showSearchInfo && (
            <button
              type="button"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-100"
              onClick={() => setShowSearchInfo(false)}
            >
              Dölj
            </button>
          )}
        </div>

        {showSearchInfo && searchInfo && (
          <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 space-y-4">
            <p className="text-sm font-black text-indigo-900">{searchInfo.description}</p>

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-700 mb-2">Söklägen</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {searchInfo.modes.map((m) => (
                  <div key={m.id} className="rounded-xl border border-indigo-200 bg-white p-3">
                    <p className="text-xs font-black text-indigo-800">{m.label}</p>
                    <p className="text-[11px] text-slate-600 mt-1">{m.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-700 mb-2">Fulltextfält (semantisk & lexikal sökning)</p>
              <div className="space-y-1">
                {searchInfo.fullTextFields.map((f) => (
                  <div key={f.field} className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-white px-3 py-2">
                    <code className="text-[11px] font-bold text-indigo-700 shrink-0">{f.field}</code>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{f.label}</p>
                      {f.source && <p className="text-[11px] text-slate-500">{f.source}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-700 mb-2">Metadatafilter (filters-objekt)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-indigo-100 text-[10px] uppercase text-indigo-600">
                    <tr>
                      <th className="px-3 py-2">Fält</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Typ</th>
                      <th className="px-3 py-2">Exempel</th>
                      <th className="px-3 py-2">Beskrivning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-50">
                    {searchInfo.metadataFilterFields.map((f) => (
                      <tr key={f.field} className="bg-white">
                        <td className="px-3 py-2"><code className="font-bold text-indigo-700">{f.field}</code></td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{f.label}</td>
                        <td className="px-3 py-2 text-slate-600">{f.type}{f.values ? `: [${f.values.join(', ')}]` : ''}</td>
                        <td className="px-3 py-2 text-slate-600">{String(f.example ?? '')}</td>
                        <td className="px-3 py-2 text-slate-500">{f.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-700 mb-2">Lexikal matchning (nyckelord)</p>
              <div className="space-y-1">
                {searchInfo.lexicalMatchFields.map((f) => (
                  <div key={f.field} className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-white px-3 py-2">
                    <code className="text-[11px] font-bold text-indigo-700 shrink-0">{f.field}</code>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{f.label}</p>
                      {f.description && <p className="text-[11px] text-slate-500">{f.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-700 mb-2">Frågeparametrar (/api/search/query)</p>
              <div className="space-y-1">
                {Object.entries(searchInfo.queryParameters).map(([key, desc]) => (
                  <div key={key} className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-white px-3 py-2">
                    <code className="text-[11px] font-bold text-indigo-700 shrink-0">{key}</code>
                    <p className="text-[11px] text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {panel === 'insight' && (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-500">Kommunpotential (top 5)</p>
            <div className="mt-3 space-y-2">
              {topMunicipalityOpportunities.length === 0 && (
                <p className="text-sm text-slate-500">Kor en sokning for att fa prioriterad kommunlista.</p>
              )}
              {topMunicipalityOpportunities.map((item) => (
                <div key={item.municipality} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.municipality}</p>
                    <p className="text-xs text-slate-500">Traffar: {item.count}</p>
                  </div>
                  <p className="text-sm font-black text-slate-900">{(item.avgScore * 100).toFixed(1)}%</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-500">Operativ tolkning</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>Hog score och verifierad status bor prioriteras i handlaggning.</li>
              <li>Filtrera pa kommun, avfallstyp och legal status for snabb triagering.</li>
              <li>Anvand resultatlistan for kontroll av sparbarhet och uppfoljning.</li>
            </ul>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-1 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-slate-900">Sokresultat</p>
              <p className="text-xs text-slate-500">
                Scope: {searchData?.scope === 'global' ? 'Global' : 'Projekt'} | Kandidater: {searchData?.totalCandidates ?? 0} | Tid: {searchData?.elapsedMs ?? 0} ms
              </p>
            </div>
            <p className="text-[11px] font-semibold text-slate-600">
              Guardrail: {searchData?.guardrails?.draftWatermark || 'UTKAST - MANUELL GRANSKNING KRAVS'} | Citat-tackning:{' '}
              {searchData?.guardrails?.citationCoveragePct ?? 0}% | Filtrerade utan evidens: {searchData?.guardrails?.evidenceFilteredOut ?? 0} |
              Semantisk motor: {searchData?.guardrails?.semanticEngine ?? 'disabled'}
            </p>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Dokument</th>
                  <th className="px-3 py-2">Projekt</th>
                  <th className="px-3 py-2">Kommun</th>
                  <th className="px-3 py-2">Beslut</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Matchning</th>
                  <th className="px-3 py-2">Snippet</th>
                  <th className="px-3 py-2">Kallcitat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((result) => (
                  <tr key={result.documentId} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">
                      {result.metadata.subject || result.metadata.originalName}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {result.metadata.projectName || result.metadata.projectId || '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">{result.metadata.municipality || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">{result.metadata.decisionType || '-'}</td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">{(result.score * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{result.whyMatched || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{result.snippet || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {result.citations?.[0] ? (
                        <span title={result.citations[0].quote} className="cursor-help rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                          {result.citations[0].sourceLabel}: {result.citations[0].quote.slice(0, 90)}
                          {result.citations[0].quote.length > 90 ? '...' : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Inga resultat.</div>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-500">Indexstatus</p>
            <div className="mt-2 space-y-1 text-xs text-slate-700">
              {(statusData?.documents || []).map((item) => (
                <p key={`doc-${item.status}`}>
                  Dokument {item.status}: <span className="font-bold">{item.count}</span>
                </p>
              ))}
              {(statusData?.jobs || []).map((item) => (
                <p key={`job-${item.status}`}>
                  Jobb {item.status}: <span className="font-bold">{item.count}</span>
                </p>
              ))}
              {statusData?.summary && (
                <>
                  <p>
                    Dokument totalt: <span className="font-bold">{statusData.summary.documentsTotal}</span>
                  </p>
                  <p>
                    Embedding-tackning: <span className="font-bold">{statusData.summary.chunkEmbeddingCoveragePct}%</span>
                  </p>
                  <p>
                    Stale RUNNING-jobb: <span className="font-bold">{statusData.summary.staleRunningJobs}</span>
                  </p>
                </>
              )}
              {!statusData && <p className="text-slate-500">Ingen status hamtad.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-500">Driftnotering</p>
            <p className="mt-2 text-xs text-slate-600">
              Prioritera dokument med hog score och verifierad legal status for snabbast operativt utfall.
            </p>
          </div>
        </div>
      </section>

      {(error || info) && (
        <section data-testid="admin-status-banner" className="rounded-2xl border border-slate-200 bg-white p-3 text-xs">
          {error && (
            <p data-testid="admin-status-error" className="font-bold text-rose-600">
              {error}
            </p>
          )}
          {info && (
            <p data-testid="admin-status-info" className="text-slate-600">
              {info}
            </p>
          )}
        </section>
      )}
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-base font-black">{value}</p>
    </div>
  );
};

export default AdminSearchConsole;
