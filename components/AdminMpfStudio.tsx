import React, { useEffect, useState } from 'react';
import type { MpfThreshold, MpfPermitClass } from '../services/mpfEngine';

interface AdminMpfStudioProps {
  token: string;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}

const PERMIT_CLASSES: MpfPermitClass[] = ['A', 'B', 'C', 'U'];

const AdminMpfStudio: React.FC<AdminMpfStudioProps> = ({ token, onError, onInfo }) => {
  const [thresholds, setThresholds] = useState<MpfThreshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/admin/mpf/thresholds', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setThresholds(data.items);
        } else {
          onError(data.error || 'Kunde inte hämta MPF-trösklar');
        }
      } catch {
        if (!cancelled) onError('Nätverksfel vid hämtning av MPF-data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, onError]);

  const handleUpdate = async (rule: MpfThreshold) => {
    setSaving(rule.code);
    try {
      const res = await fetch('/api/admin/mpf/thresholds', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rule),
      });
      const data = await res.json();
      if (data.ok) {
        onInfo(`Regel för ${rule.code} uppdaterad.`);
      } else {
        onError(data.error || 'Kunde inte spara regel');
      }
    } catch (err) {
      onError('Nätverksfel vid sparande');
    } finally {
      setSaving(null);
    }
  };

  const updateLocalRule = (code: string, updates: Partial<MpfThreshold>) => {
    setThresholds((prev) => prev.map((t) => (t.code === code ? { ...t, ...updates } : t)));
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h3 className="text-lg font-black text-slate-900">MPF Regel-Studio</h3>
        <p className="text-xs text-slate-500">Hantera tröskelvärden för Miljöprövningsförordningen.</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Laddar regler...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">
                <th className="pb-2 pr-4">Kod</th>
                <th className="pb-2 pr-4">Beskrivning</th>
                <th className="pb-2 pr-4">Klass</th>
                <th className="pb-2 pr-4">Tröskel (ton)</th>
                <th className="pb-2 pr-4">Känslig Tröskel</th>
                <th className="pb-2 text-right">Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {thresholds.map((rule) => (
                <tr key={rule.code} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 pr-4 font-mono font-bold text-slate-900">{rule.code}</td>
                  <td className="py-3 pr-4 text-xs text-slate-600 max-w-xs truncate">{rule.description}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={rule.permitClass}
                      onChange={(e) =>
                        updateLocalRule(rule.code, { permitClass: e.target.value as MpfPermitClass })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold"
                    >
                      {PERMIT_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    <input
                      type="number"
                      value={rule.thresholdValue}
                      onChange={(e) => updateLocalRule(rule.code, { thresholdValue: Number(e.target.value) })}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs font-mono"
                    />
                  </td>
                  <td className="py-3 pr-4 text-slate-400">
                    <input
                      type="number"
                      placeholder="N/A"
                      value={rule.sensitiveThresholdValue ?? ''}
                      onChange={(e) =>
                        updateLocalRule(rule.code, {
                          sensitiveThresholdValue: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs font-mono"
                    />
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => handleUpdate(rule)}
                      disabled={saving === rule.code}
                      className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-black disabled:opacity-30"
                    >
                      {saving === rule.code ? 'Sparar...' : 'Spara'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminMpfStudio;
