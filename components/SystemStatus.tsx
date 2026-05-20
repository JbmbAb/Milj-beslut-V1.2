import React, { useEffect, useState } from 'react';

type SystemCheckResponse = {
  ok: boolean;
  version?: string;
  message: string;
  details?: string;
};

export const SystemStatus: React.FC = () => {
  const [data, setData] = useState<SystemCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/system/postgis');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setData({
          ok: false,
          message: 'Kunde inte nå API-endpoint.',
          details: String(e),
        });
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-slate-200 rounded-lg"></div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-slate-200 rounded"></div>
            <div className="h-2 w-32 bg-slate-100 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isOk = data.ok;
  const containerClass = isOk ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100';

  const textClass = isOk ? 'text-emerald-800' : 'text-rose-800';
  const iconClass = isOk ? 'text-emerald-600' : 'text-rose-600';
  const icon = isOk ? 'fa-database' : 'fa-triangle-exclamation';

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${containerClass}`}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center ${iconClass} shadow-sm`}
        >
          <i className={`fas ${icon} text-lg`}></i>
        </div>
        <div>
          <h4 className={`text-xs font-black uppercase tracking-widest ${textClass}`}>PostGIS Motor</h4>
          <span className={`text-[10px] font-bold ${isOk ? 'text-emerald-600' : 'text-rose-600'}`}>
            {isOk ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      <p className={`text-xs font-medium mb-3 ${textClass}`}>{data.message}</p>

      {data.version && (
        <div className="bg-white/60 rounded-lg px-3 py-2 border border-emerald-100/50">
          <code className="text-[9px] text-slate-600 font-mono break-all leading-tight block">
            {data.version}
          </code>
        </div>
      )}

      {data.details && (
        <div className="mt-2 bg-white/60 rounded-lg px-3 py-2 border border-rose-200">
          <code className="text-[9px] text-rose-600 font-mono break-all leading-tight block">
            {data.details}
          </code>
        </div>
      )}
    </div>
  );
};
