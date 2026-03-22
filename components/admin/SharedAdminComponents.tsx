import React from 'react';

export const KpiCard: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-base font-black text-white">{value}</p>
    </div>
  );
};

export const StatusBanner: React.FC<{ error?: string; info?: string }> = ({ error, info }) => {
  if (!error && !info) return null;
  return (
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
  );
};
