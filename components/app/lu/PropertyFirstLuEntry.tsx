import React, { useEffect, useRef, useState } from 'react';
import { designTokens } from '@miljobeslut/mps-identity';
import {
  createLocalizationProjectRequest,
  getBootstrapStatus,
  listPropertyProjects,
  retryLocalizationBootstrap,
  type BootstrapStatus,
  type LocalizationProjectListItem,
} from '../../../src/ui/api-client/localizationProjects.client';
import { setActiveProjectId } from '../../../services/coreApiClient';
import { LuWorkspace } from './LuWorkspace';

/**
 * PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase B (UI wiring).
 *
 * The normal LU entry point: property search first, PROJECT (the internal Mimer container) is
 * never something the user picks or sees the id of. Uses only the property-first primitives from
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B (listProjectsForProperty /
 * createLocalizationProject / the durable bootstrap queue) -- never /api/admin/projects or
 * createOrGetAdminProject.
 *
 * This screen deliberately does NOT call /api/property/lookup itself: that route requires a real
 * projectId (it writes a project-scoped PropertyAccessLog audit row), which structurally cannot
 * exist yet at the point a user is searching for a property in order to decide whether to open or
 * create a project. Discovery here uses only listProjectsForProperty (organisation + designation,
 * no project needed). Real geometry/centroid resolution stays exactly where it already was --
 * LuWorkspace's own lookupProperty(), which runs once a real project is active and legitimately
 * has a projectId to audit against.
 *
 * Kept explicitly separate here, per owner instruction:
 *   PROPERTY  = the cadastral property designation the user searched for
 *   PROJECT   = the internal container this screen creates/opens (id + name, never shown as an id)
 *   LOCALIZATION/SITE GEOMETRY = does not exist yet (PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase A
 *     finding 10) -- out of scope for this screen.
 */

const PENDING_BOOTSTRAP_KEY = 'miljobeslut_pending_bootstrap_project';

type Phase =
  | { kind: 'search' }
  | { kind: 'propertyFound'; propertyDesignation: string; projects: LocalizationProjectListItem[] }
  | { kind: 'creating'; propertyDesignation: string }
  | { kind: 'bootstrapping'; propertyDesignation: string; project: LocalizationProjectListItem; status: BootstrapStatus['status'] }
  | { kind: 'bootstrapFailed'; propertyDesignation: string; project: LocalizationProjectListItem; failureCode: string | null; failureDetail: string | null }
  | { kind: 'ready'; propertyDesignation: string };

export const PropertyFirstLuEntry: React.FC = () => {
  const colors = designTokens.colors;
  const [designation, setDesignation] = useState('');
  const [localizationName, setLocalizationName] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'search' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(0,0,0,0.35)',
    border: `1px solid ${colors.coreGraphite.hex}`,
    color: colors.flowLightCyan.hex,
    padding: '0.75rem 1rem',
    borderRadius: 0,
  };

  function stopPolling(): void {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  function beginPolling(propertyDesignation: string, project: LocalizationProjectListItem): void {
    stopPolling();
    localStorage.setItem(PENDING_BOOTSTRAP_KEY, JSON.stringify({ projectId: project.id, propertyDesignation }));
    setPhase({ kind: 'bootstrapping', propertyDesignation, project, status: 'PENDING' });

    const poll = async () => {
      const status = await getBootstrapStatus(project.id).catch(() => null);
      if (!status) return;
      if (status.status === 'COMPLETED') {
        stopPolling();
        localStorage.removeItem(PENDING_BOOTSTRAP_KEY);
        setActiveProjectId(project.id);
        setPhase({ kind: 'ready', propertyDesignation });
        return;
      }
      if (status.status === 'FAILED') {
        stopPolling();
        localStorage.removeItem(PENDING_BOOTSTRAP_KEY);
        setPhase({ kind: 'bootstrapFailed', propertyDesignation, project, failureCode: status.failureCode, failureDetail: status.failureDetail });
        return;
      }
      setPhase({ kind: 'bootstrapping', propertyDesignation, project, status: status.status });
    };

    void poll();
    pollRef.current = setInterval(() => void poll(), 2000);
  }

  // Refresh-recoverable: a bootstrap in progress is durable server-side state (the
  // ProjectContextBootstrapRequest row), not just in-memory UI state. If the page reloads while
  // waiting, resume polling the same project instead of restarting the whole search flow.
  useEffect(() => {
    const raw = localStorage.getItem(PENDING_BOOTSTRAP_KEY);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as { projectId: string; propertyDesignation: string };
      if (!pending.projectId || !pending.propertyDesignation) return;
      const project: LocalizationProjectListItem = {
        id: pending.projectId,
        name: null,
        propertyDesignation: pending.propertyDesignation,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };
      beginPolling(pending.propertyDesignation, project);
    } catch {
      localStorage.removeItem(PENDING_BOOTSTRAP_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchProperty = async () => {
    setSearchError('');
    setSearching(true);
    try {
      const normalized = designation.trim().toUpperCase();
      if (!normalized) throw new Error('Ange en fastighetsbeteckning.');
      const projects = await listPropertyProjects(normalized);
      setPhase({ kind: 'propertyFound', propertyDesignation: normalized, projects });
    } catch (err) {
      setPhase({ kind: 'search' });
      setSearchError(err instanceof Error ? err.message : 'Fastighetssökning misslyckades.');
    } finally {
      setSearching(false);
    }
  };

  const openExisting = (propertyDesignation: string, project: LocalizationProjectListItem) => {
    setActiveProjectId(project.id);
    setPhase({ kind: 'ready', propertyDesignation });
  };

  const createNew = async (propertyDesignation: string) => {
    setPhase({ kind: 'creating', propertyDesignation });
    try {
      const name = localizationName.trim() || `Lokalisering ${new Date().toLocaleDateString('sv-SE')}`;
      const result = await createLocalizationProjectRequest({ propertyDesignation, name });
      beginPolling(propertyDesignation, result.project);
    } catch (err) {
      const projects = await listPropertyProjects(propertyDesignation).catch(() => []);
      setPhase({ kind: 'propertyFound', propertyDesignation, projects });
      setSearchError(err instanceof Error ? err.message : 'Kunde inte skapa lokalisering.');
    }
  };

  const retry = async (propertyDesignation: string, project: LocalizationProjectListItem) => {
    try {
      await retryLocalizationBootstrap(project.id);
      beginPolling(propertyDesignation, project);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Kunde inte försöka igen.');
    }
  };

  if (phase.kind === 'ready') {
    return <LuWorkspace initialDesignation={phase.propertyDesignation} />;
  }

  return (
    <div
      data-testid="lu-property-first-entry"
      className="max-w-3xl px-8 py-10"
      style={{ color: colors.coreTurquoise.hex, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <h1 className="text-3xl font-bold tracking-tight mb-2">Ny lokalisering</h1>
      <p className="text-sm opacity-70 mb-8 leading-relaxed">
        Sök fastighet, öppna en befintlig lokalisering eller skapa en ny.
      </p>

      {(phase.kind === 'search' || phase.kind === 'propertyFound') && (
        <section className="space-y-4 mb-10">
          <label className="block text-xs uppercase tracking-widest opacity-70">
            Fastighetsbeteckning
            <input
              data-testid="pf-designation"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="t.ex. ORSA STACKMORA 3:12"
              className="mt-2"
              style={fieldStyle}
            />
          </label>
          <button
            type="button"
            data-testid="pf-search"
            disabled={!designation.trim() || searching}
            onClick={() => void searchProperty()}
            className="px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: colors.coreTurquoise.hex, color: colors.surfaceDarkStone.hex }}
          >
            {searching ? 'Söker…' : 'Sök fastighet'}
          </button>
          {searchError ? (
            <p data-testid="pf-search-error" className="text-sm" style={{ color: '#F87171' }}>
              {searchError}
            </p>
          ) : null}
        </section>
      )}

      {phase.kind === 'propertyFound' && (
        <section data-testid="pf-property-card" className="border p-6 space-y-6" style={{ borderColor: colors.coreGraphite.hex }}>
          <div>
            <p className="text-xs uppercase tracking-widest opacity-60">Fastighet</p>
            <p data-testid="pf-property-designation" className="text-xl font-bold">
              {phase.propertyDesignation}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-widest opacity-60 mb-2">Befintliga lokaliseringar</p>
            {phase.projects.length === 0 ? (
              <p data-testid="pf-no-existing" className="text-sm opacity-60">
                Inga tidigare lokaliseringar för denna fastighet.
              </p>
            ) : (
              <ul data-testid="pf-existing-list" className="space-y-2">
                {phase.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      {p.name || p.id} <span className="opacity-50">({p.status})</span>
                    </span>
                    <button
                      type="button"
                      data-testid={`pf-open-${p.id}`}
                      onClick={() => openExisting(phase.propertyDesignation, p)}
                      className="px-3 py-1 text-xs font-semibold border"
                      style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
                    >
                      Öppna
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 border-t pt-6" style={{ borderColor: colors.coreGraphite.hex }}>
            <label className="block text-xs uppercase tracking-widest opacity-70">
              Namn på ny lokalisering
              <input
                data-testid="pf-new-name"
                value={localizationName}
                onChange={(e) => setLocalizationName(e.target.value)}
                placeholder="t.ex. Alternativ A"
                className="mt-2"
                style={fieldStyle}
              />
            </label>
            <button
              type="button"
              data-testid="pf-create-new"
              onClick={() => void createNew(phase.propertyDesignation)}
              className="px-4 py-2 text-sm font-semibold border"
              style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
            >
              Skapa ny lokalisering
            </button>
          </div>
        </section>
      )}

      {(phase.kind === 'creating' || phase.kind === 'bootstrapping') && (
        <section data-testid="pf-bootstrapping" className="border p-6 space-y-3" style={{ borderColor: colors.coreGraphite.hex }}>
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10" style={{ borderTopColor: colors.coreTurquoise.hex }} />
            <p className="text-sm font-semibold">Skapar lokalisering…</p>
          </div>
          <ul className="text-xs opacity-70 space-y-1 pl-8">
            <li>Etablerar projekt{phase.kind === 'bootstrapping' ? ' ✓' : '…'}</li>
            <li>
              Verifierar fastighet och etablerar governad projektkontext
              {phase.kind === 'bootstrapping' ? ` (${phase.status.toLowerCase()})` : '…'}
            </li>
          </ul>
        </section>
      )}

      {phase.kind === 'bootstrapFailed' && (
        <section data-testid="pf-bootstrap-failed" className="border p-6 space-y-3" style={{ borderColor: '#F87171' }}>
          <p className="text-sm font-semibold" style={{ color: '#F87171' }}>
            Lokaliseringen kunde inte etableras.
          </p>
          <p className="text-xs opacity-70">
            {phase.failureCode ? `${phase.failureCode}: ` : ''}
            {phase.failureDetail || 'Okänt fel.'}
          </p>
          <p className="text-xs opacity-60">
            Projektet är skapat men har ingen verifierad projektkontext ännu — det kan inte
            användas för bedömning förrän detta lyckas.
          </p>
          <button
            type="button"
            data-testid="pf-retry"
            onClick={() => void retry(phase.propertyDesignation, phase.project)}
            className="px-4 py-2 text-sm font-semibold border"
            style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
          >
            Försök igen
          </button>
        </section>
      )}
    </div>
  );
};

export default PropertyFirstLuEntry;
