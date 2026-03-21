import React, { useEffect, useState } from 'react';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const PROJECT_KEY = 'miljobeslut_project_id';

interface PropertyLookupResult {
  designation?: string | null;
  geometry?: unknown;
  boundaries?: unknown;
  ownership?: { ownerType?: unknown; share?: unknown } | null;
  _demo?: boolean;
}

interface PropertyRegisterExtractProps {
  propertyId: string;
  projectId?: string;
}

const PropertyRegisterExtract: React.FC<PropertyRegisterExtractProps> = ({ propertyId, projectId }) => {
  const [data, setData] = useState<PropertyLookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = typeof window !== 'undefined' ? (localStorage.getItem(TOKEN_KEY) || '') : '';
        const pid = projectId || (typeof window !== 'undefined' ? (localStorage.getItem(PROJECT_KEY) || '') : '');
        const response = await fetch('/api/property/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            projectId: pid,
            propertyDesignation: propertyId,
            purpose: 'REGISTERUTDRAG',
          }),
        });
        const json = await response.json() as { ok: boolean; result?: PropertyLookupResult; error?: string };
        if (!json.ok) {
          setError(json.error ?? 'Fastighetsuppslag misslyckades');
          setData(null);
        } else {
          setData(json.result ?? null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Okänt nätverksfel';
        setError(msg);
        console.error('PropertyRegisterExtract: fetch failed', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [propertyId, projectId]);

  if (loading) {
    return (
      <div className="p-8 animate-pulse bg-white border border-slate-200">
        <div className="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-slate-200 rounded w-1/2 mb-6"></div>
        <div className="space-y-3">
          <div className="h-4 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
        <p className="font-black mb-1">Fastighetsuppslag misslyckades</p>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const designation = String(data.designation ?? propertyId);
  const municipality = designation.split(' ')[0] ?? '';
  const hasOwnership = data.ownership && (data.ownership.ownerType || data.ownership.share);

  return (
    <div className="bg-white border-2 border-slate-900 p-8 shadow-sm font-serif max-w-4xl mx-auto my-6 text-slate-900 overflow-hidden relative">
      {/* Demo-badge */}
      {data._demo && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-300 rounded text-amber-700 text-xs font-semibold flex items-center gap-2">
          <span>⚠️</span>
          <span>Demo-data — Lantmäteriet-API ej konfigurerat. Sätt <code className="font-mono">LANTMATERIET_CONSUMER_KEY</code> + <code className="font-mono">LANTMATERIET_CONSUMER_SECRET</code> (eller <code className="font-mono">LANTMATERIET_ACCESS_TOKEN</code>) för riktiga registerdata.</span>
        </div>
      )}
      {/* Vattenstämpel */}
      <div className="absolute top-4 right-8 opacity-10 pointer-events-none uppercase text-4xl font-black rotate-[-15deg] border-4 border-slate-900 p-2">
        Registerutdrag
      </div>

      <header className="border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">Fastighetsutdrag</h1>
            <p className="text-sm italic text-slate-600">Källa: Lantmäteriet — Fastighetsindelning</p>
          </div>
          <div className="text-right text-xs">
            <p>Utskriftsdatum: {new Date().toLocaleDateString('sv-SE')}</p>
            <p>Referens: LM-{designation.replace(/\s+/g, '-')}</p>
          </div>
        </div>
      </header>

      <section className="grid md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Registerbeteckning</h2>
          <p className="text-xl font-bold mb-6">{designation}</p>

          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Kommun</h2>
          <p className="font-semibold mb-6">{municipality || '—'}</p>

          {hasOwnership && (
            <>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Ägarförhållanden</h2>
              <p className="font-semibold mb-6">{String(data.ownership?.ownerType ?? '—')}</p>
            </>
          )}
        </div>

        <div className="bg-slate-50 p-4 border border-slate-200">
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Geometridata</h2>
          {data.geometry ? (
            <p className="text-sm text-slate-600">
              Geometri hämtad ({String((data.geometry as { type?: string } | null)?.type ?? 'okänd typ')}) — visas i kartvy.
            </p>
          ) : (
            <p className="text-sm italic text-slate-400">Ingen geometri tillgänglig</p>
          )}
        </div>
      </section>

      <footer className="mt-12 pt-4 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between">
        <p>Data hämtad: {new Date().toLocaleString('sv-SE')}</p>
        <p>Handlingens giltighet bör styrkas mot Lantmäteriets huvudregister.</p>
      </footer>
    </div>
  );
};

export default PropertyRegisterExtract;

