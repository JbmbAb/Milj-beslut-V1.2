import React from 'react';
import type { AdminProjectSummary } from '../../types';

interface AdminAuthPanelProps {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  token: string;
  refreshToken: string;
  projectId: string;
  setProjectId: (v: string) => void;
  newProjectDesignation: string;
  setNewProjectDesignation: (v: string) => void;
  projects: AdminProjectSummary[];
  busy: string;
  login: () => void;
  refresh: () => void;
  logout: () => void;
  loadProjects: () => void;
  createProject: () => void;
  loadMapAndDataStatus: () => void;
  loadExternalHealth: () => void;
  loadExamSummary: () => void;
  loadDatabaseDump: () => void;
}

const AdminAuthPanel: React.FC<AdminAuthPanelProps> = ({
  username,
  setUsername,
  password,
  setPassword,
  token,
  refreshToken,
  projectId,
  setProjectId,
  newProjectDesignation,
  setNewProjectDesignation,
  projects,
  busy,
  login,
  refresh,
  logout,
  loadProjects,
  createProject,
  loadMapAndDataStatus,
  loadExternalHealth,
  loadExamSummary,
  loadDatabaseDump,
}) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
          className="rounded-xl bg-fuchsia-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={Boolean(busy) || !token}
          onClick={loadExternalHealth}
        >
          {busy === 'externalhealth' ? 'Arbetar...' : 'Extern API health'}
        </button>
        <button
          className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={Boolean(busy) || !token}
          onClick={loadExamSummary}
        >
          {busy === 'exam' ? 'Arbetar...' : 'Plattformsrapport'}
        </button>
        <button
          className="rounded-xl bg-sky-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={Boolean(busy) || !token}
          onClick={loadDatabaseDump}
        >
          {busy === 'dbdump' ? 'Arbetar...' : 'Databasdump'}
        </button>
        <button className="rounded-xl bg-slate-700 px-4 py-2 text-xs font-bold text-white" onClick={logout}>
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
              {project.propertyDesignation || project.id} (
              {project.organisation?.name || 'Organisation saknas'})
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
      <p className="mt-2 text-xs text-slate-500">
        Lamna projekt tomt for fri sokning i hela databasen (adminlage).
      </p>
    </section>
  );
};

export default AdminAuthPanel;
