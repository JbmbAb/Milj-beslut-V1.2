import React, { useEffect, useState } from 'react';
import { getActiveProjectId } from '../services/coreApiClient';

type Stakeholder = {
  id: string;
  name: string;
  type: 'Authority' | 'Public' | 'Neighbor' | 'Internal';
  impact: 'Low' | 'Medium' | 'High';
  interest: 'Low' | 'Medium' | 'High';
  strategy: string;
};

const StakeholderAnalysis: React.FC = () => {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hämta riktig data från databasen
  useEffect(() => {
    const projectId = getActiveProjectId();
    if (!projectId) {
      setStakeholders([]);
      setError('Inget aktivt projekt är valt. Öppna ett projekt för att läsa intressenter.');
      setLoading(false);
      return;
    }

    fetch(`/api/projects/${projectId}/stakeholders`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.stakeholders)) {
          setStakeholders(data.stakeholders);
          setError(null);
        } else {
          setStakeholders([]);
          setError('Intressenter kunde inte verifieras från projektets datakälla.');
        }
      })
      .catch((err) => {
        console.error('Failed to load stakeholders', err);
        setStakeholders([]);
        setError('Intressenter kunde inte hämtas. Ingen ersättningslista visas.');
      })
      .finally(() => setLoading(false));
  }, []);

  const saveStakeholders = async (newList: Stakeholder[]) => {
    const projectId = getActiveProjectId();
    if (!projectId) {
      setError('Inget aktivt projekt är valt. Intressenter sparades inte.');
      return;
    }
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/stakeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stakeholders: newList }),
      });
      setError(null);
    } catch (e) {
      console.error('Save failed', e);
      setError('Kunde inte spara intressenter.');
    } finally {
      setSaving(false);
    }
  };

  const addStakeholder = () => {
    const newS: Stakeholder = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'Ny intressent',
      type: 'Public',
      impact: 'Low',
      interest: 'Low',
      strategy: 'Ej fastställd',
    };
    const updated = [...stakeholders, newS];
    setStakeholders(updated);
    saveStakeholders(updated);
  };

  const getImpactColor = (val: string) => {
    if (val === 'High') return 'bg-rose-100 text-rose-700';
    if (val === 'Medium') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };

  const highPriorityCount = stakeholders.filter(
    (stakeholder) => stakeholder.impact === 'High' && stakeholder.interest === 'High',
  ).length;
  const consultationPercent =
    stakeholders.length === 0 ? 0 : Math.round((highPriorityCount / stakeholders.length) * 100);

  if (loading)
    return (
      <div className="p-20 text-center animate-pulse text-slate-400 font-bold uppercase tracking-widest">
        Laddar intressentanalys...
      </div>
    );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h3 className="text-2xl font-black text-slate-900">Intressentanalys</h3>
          <p className="text-slate-500 mt-1">
            Hantera och analysera projektets intressenter för ett framgångsrikt samråd.
          </p>
        </div>
        {saving && (
          <span className="text-[10px] font-black uppercase text-emerald-600 animate-pulse">Sparar...</span>
        )}
      </header>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-bottom border-slate-100">
              <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                Intressent
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                Typ
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">
                Påverkan
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">
                Intresse
              </th>
              <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                Strategi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stakeholders.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-8 py-6">
                  <p className="text-sm font-bold text-slate-800">{s.name}</p>
                </td>
                <td className="px-6 py-6">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {s.type}
                  </span>
                </td>
                <td className="px-6 py-6 text-center">
                  <span
                    className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${getImpactColor(s.impact)}`}
                  >
                    {s.impact}
                  </span>
                </td>
                <td className="px-6 py-6 text-center">
                  <span
                    className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${getImpactColor(s.interest)}`}
                  >
                    {s.interest}
                  </span>
                </td>
                <td className="px-8 py-6">
                  <p className="text-xs text-slate-600 leading-relaxed">{s.strategy}</p>
                </td>
              </tr>
            ))}
            {stakeholders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-8 py-12 text-center text-slate-400 italic text-sm">
                  Inga intressenter tillagda än. Klicka på knappen nedan för att starta din analys.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Totalt {stakeholders.length} aktiva intressenter
          </p>
          <button
            onClick={addStakeholder}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
          >
            + Lägg till intressent
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-emerald-50 border border-emerald-100 rounded-[2rem] p-8">
          <h4 className="text-sm font-black uppercase tracking-widest text-emerald-800 mb-4">
            Analys: Prioritering
          </h4>
          <p className="text-sm text-emerald-900 leading-relaxed">
            {stakeholders.length === 0
              ? 'Ingen verifierad intressentdata finns ännu. Lägg till projektets faktiska parter innan samrådsprioritering görs.'
              : `${highPriorityCount} intressent${highPriorityCount === 1 ? '' : 'er'} har hög påverkan och högt intresse och bör prioriteras i samrådsprocessen.`}
          </p>
        </div>
        <div className="bg-slate-900 rounded-[2rem] p-8 text-white shadow-xl shadow-slate-200">
          <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Samrådsstatus</h4>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${consultationPercent}%` }} />
            </div>
            <span className="text-xl font-black italic">{consultationPercent}%</span>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-4">
            Nästkommande milstolpe: ej planerad i verifierad projektdata
          </p>
        </div>
      </div>
    </div>
  );
};

export default StakeholderAnalysis;
