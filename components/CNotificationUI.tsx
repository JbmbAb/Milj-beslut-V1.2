import React, { useCallback, useEffect, useState } from 'react';
import {
  createCNotificationChemical,
  deleteCNotificationChemical,
  listCNotificationChemicals,
  type CNotificationChemicalDto,
} from '../services/cnotificationChemicalApi';

type Props = {
  /** Valfritt: begränsa listan till ett projekt (query ?projectId= stöds också). */
  projectId?: string;
};

function statusBadge(row: CNotificationChemicalDto) {
  if (row.requiresSafetyDataSheet || (row.hazardCode && /H3/i.test(row.hazardCode))) {
    return (
      <span className="bg-[#ffdcc3] text-[#c76c00] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
        Kräver skyddsåtgärd
      </span>
    );
  }
  if (row.reviewStatus === 'APPROVED') {
    return (
      <span className="bg-[#85f8c4] text-[#006c4a] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
        Godkänd
      </span>
    );
  }
  return (
    <span className="bg-[#e8ecf8] text-[#565e74] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
      Utkast
    </span>
  );
}

export const CNotificationUI: React.FC<Props> = ({ projectId: projectIdProp }) => {
  const [projectId, setProjectId] = useState(projectIdProp ?? '');
  const [rows, setRows] = useState<CNotificationChemicalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draftName, setDraftName] = useState('');
  const [draftAnnual, setDraftAnnual] = useState('');
  const [draftStorage, setDraftStorage] = useState('');
  const [draftHazard, setDraftHazard] = useState('');
  const [draftSds, setDraftSds] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCNotificationChemicals(projectId.trim() || undefined);
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte läsa kemikalier.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('projectId') : null;
    if (!projectIdProp && q) setProjectId(q);
  }, [projectIdProp]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async () => {
    const name = draftName.trim();
    if (!name) {
      setError('Ange namn på kemikalien.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createCNotificationChemical({
        name,
        annualConsumption: draftAnnual.trim() || undefined,
        storageNote: draftStorage.trim() || undefined,
        hazardCode: draftHazard.trim() || undefined,
        requiresSafetyDataSheet: draftSds,
        projectId: projectId.trim() || undefined,
      });
      setDraftName('');
      setDraftAnnual('');
      setDraftStorage('');
      setDraftHazard('');
      setDraftSds(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sparning misslyckades.');
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (id: string) => {
    if (!window.confirm('Ta bort denna kemikalie från förteckningen?')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteCNotificationChemical(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Borttagning misslyckades.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#111c2d] font-sans py-12 px-8 flex justify-center">
      <main className="w-full max-w-4xl">
        <header className="mb-12">
          <h1 className="text-4xl font-extrabold tracking-tight mb-8">Anmälan om C-verksamhet</h1>
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-[#cfdaf2] -z-10" />

            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-[#006c4a] text-white flex items-center justify-center font-bold ring-4 ring-[#f9f9ff]">
                ✓
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#006c4a]">Företag</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-[#131b2e] text-white flex items-center justify-center font-bold ring-4 ring-[#f9f9ff]">
                2
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#131b2e]">Kemikalier</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-[#ffffff] border-2 border-[#cfdaf2] text-[#cfdaf2] flex items-center justify-center font-bold ring-4 ring-[#f9f9ff]">
                3
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#565e74] opacity-50">Utsläpp</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-[#ffffff] border-2 border-[#cfdaf2] text-[#cfdaf2] flex items-center justify-center font-bold ring-4 ring-[#f9f9ff]">
                4
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#565e74] opacity-50">Granskning</span>
            </div>
          </div>
        </header>

        <section className="bg-[#ffffff] rounded-xl shadow-[0_12px_32px_rgba(17,28,45,0.04)] border border-[#cfdaf2]/50 overflow-hidden mb-6">
          <div className="p-8 border-b border-[#cfdaf2]">
            <h2 className="text-2xl font-bold mb-2">Kemikalieförteckning</h2>
            <p className="text-[#565e74] text-sm">
              Registrera kemiska produkter som hanteras i verksamheten. Uppgifterna sparas i databasen per organisation
              (valfritt filtrerat på projekt-ID).
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
              <label className="text-xs font-bold text-[#565e74] shrink-0">Projekt-ID (valfritt)</label>
              <input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="flex-1 border border-[#cfdaf2] rounded px-3 py-2 text-sm font-mono"
                placeholder="cuid…"
              />
              <button
                type="button"
                onClick={() => void load()}
                className="text-sm font-bold text-[#131b2e] underline underline-offset-4"
              >
                Ladda om
              </button>
            </div>
          </div>

          {error ? (
            <div className="mx-8 mt-4 rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          <div className="p-8 space-y-6">
            {loading ? <p className="text-sm text-[#565e74]">Laddar…</p> : null}

            {!loading && rows.length === 0 ? (
              <p className="text-sm text-[#565e74]">Inga kemikalier än — lägg till nedan.</p>
            ) : null}

            {rows.map((row) => (
              <div
                key={row.id}
                className={`p-6 rounded-lg border flex justify-between items-center gap-4 ${
                  row.requiresSafetyDataSheet ? 'bg-[#ffffff] border-2 border-[#c76c00]' : 'bg-[#f0f3ff] border-[#cfdaf2]/50'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h4 className="font-bold text-lg">{row.name}</h4>
                    {statusBadge(row)}
                  </div>
                  <p className="text-sm text-[#565e74]">
                    {row.annualConsumption ? `Årlig förbrukning: ${row.annualConsumption}` : 'Årlig förbrukning: —'}
                    {row.storageNote ? ` • ${row.storageNote}` : ''}
                    {row.hazardCode ? ` • ${row.hazardCode}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onRemove(row.id)}
                  disabled={saving}
                  className="text-sm font-bold text-rose-700 shrink-0 underline underline-offset-4 disabled:opacity-50"
                >
                  Ta bort
                </button>
              </div>
            ))}

            <div className="p-6 rounded-lg border border-dashed border-[#cfdaf2] space-y-3 bg-[#fafbff]">
              <h3 className="font-bold text-sm">Lägg till kemikalie</h3>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full border border-[#cfdaf2] rounded px-3 py-2 text-sm"
                placeholder="Produktnamn"
              />
              <input
                value={draftAnnual}
                onChange={(e) => setDraftAnnual(e.target.value)}
                className="w-full border border-[#cfdaf2] rounded px-3 py-2 text-sm"
                placeholder="Årlig förbrukning (t.ex. 150 liter)"
              />
              <input
                value={draftStorage}
                onChange={(e) => setDraftStorage(e.target.value)}
                className="w-full border border-[#cfdaf2] rounded px-3 py-2 text-sm"
                placeholder="Lagring (t.ex. invallad cistern)"
              />
              <input
                value={draftHazard}
                onChange={(e) => setDraftHazard(e.target.value)}
                className="w-full border border-[#cfdaf2] rounded px-3 py-2 text-sm"
                placeholder="Faroangivelse (t.ex. H314)"
              />
              <label className="flex items-center gap-2 text-sm text-[#565e74]">
                <input type="checkbox" checked={draftSds} onChange={(e) => setDraftSds(e.target.checked)} />
                Kräver säkerhetsdatablad / skyddsåtgärd
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onAdd()}
                className="w-full py-3 bg-[#131b2e] text-white rounded text-sm font-bold disabled:opacity-50"
              >
                + Spara kemikalie
              </button>
            </div>
          </div>

          <div className="p-8 bg-[#f9f9ff] border-t border-[#cfdaf2] flex justify-between items-center flex-wrap gap-4">
            <button
              type="button"
              className="text-[#565e74] font-bold text-sm px-6 py-3 hover:bg-[#cfdaf2]/50 rounded transition-colors"
            >
              Avbryt
            </button>
            <button
              type="button"
              className="bg-[#131b2e] text-white px-8 py-3 rounded text-sm font-bold shadow-lg hover:bg-[#0f172a] transition-all"
            >
              Fortsätt till utsläpp
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
