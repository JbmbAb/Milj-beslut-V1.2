import React, { useState } from 'react';
import { SpeciesObservation } from '../types';

interface SluExpertProps {
  projectId?: string;
}

const SluExpert: React.FC<SluExpertProps> = ({ projectId }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ summary: string; observations: SpeciesObservation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!projectId) {
      setError(
        'Ingen projekt-ID. Koppla komponenten till ett aktivt projekt för att kunna köra SLU-inventering.',
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/datasources/slu/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId, purpose: 'Ekologisk inventering för miljöbeslut', payload: {} }),
      });
      if (!res.ok) {
        throw new Error(`SLU-anropet fallerade: HTTP ${res.status}`);
      }
      const json = await res.json();
      setData({
        summary: json.result?.summary ?? 'Ingen sammanfattning tillgänglig från SLU.',
        observations: json.result?.observations ?? [],
      });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Okänt fel vid SLU-anrop');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-3xl shadow-inner border border-emerald-100">
            <i className="fas fa-bugs"></i>
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tighter italic">
              SLU Artdatabanken Scan
            </h3>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">
              Kontroll mot rödlistade arter & biotopskydd
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <div className="px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
              Kräver verifierad SLU-källa
            </span>
          </div>
          {!data && !loading && (
            <button
              onClick={handleScan}
              className="px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-xl"
            >
              Starta Inventering
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="py-20 text-center space-y-4">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">
            Söker i Artportalen & Natura 2000-register...
          </p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4">
          <div className="lg:col-span-2 space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              AI-Sammanfattning
            </h4>
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 italic text-sm text-slate-700 leading-relaxed">
              {data.summary}
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Närliggande Fynd
            </h4>
            <div className="space-y-2">
              {data.observations.map((obs, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm"
                >
                  <div>
                    <p className="text-sm font-black text-slate-800">{obs.name}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">
                      {obs.distance}m från projektcentrum
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-[8px] font-black uppercase ${
                      obs.status === 'Rödlistad'
                        ? 'bg-rose-100 text-rose-700'
                        : obs.status === 'Fridlyst'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {obs.status}
                  </span>
                </div>
              ))}
              {data.observations.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs font-semibold text-slate-500">
                  Inga verifierade artfynd är inlästa.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SluExpert;
