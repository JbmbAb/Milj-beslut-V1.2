import React from 'react';
import type { AdminDatabaseDumpResponse } from '../../types';

interface DatabaseDumpSectionProps {
  dbDump: AdminDatabaseDumpResponse | null;
  busy: boolean;
  token: string;
  onLoad: () => void;
}

const DatabaseDumpSection: React.FC<DatabaseDumpSectionProps> = ({ dbDump, busy, token, onLoad }) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
            Databasinspektion
          </p>
          <h3 className="text-lg font-black text-slate-900">Rådata-dump från nyckeltabeller</h3>
          <p className="mt-1 text-xs text-slate-500">
            Dumpa innehållet direkt från Prisma-lagret för att inspektera rådata.
          </p>
        </div>
        <button
          className="rounded-xl bg-sky-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={busy || !token}
          onClick={onLoad}
        >
          {busy ? 'Dumpar...' : 'Dumpar nu'}
        </button>
      </div>

      {!dbDump && (
        <p className="mt-4 text-sm text-slate-500">Klicka "Dumpar nu" för att hämta rådata från databasen.</p>
      )}

      {dbDump && (
        <div className="mt-5 space-y-4">
          <p className="text-xs text-slate-500">
            Genererad: {new Date(dbDump.generatedAt).toLocaleString('sv-SE')}
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            {Object.entries(dbDump.countByTable).map(([table, count]) => (
              <div key={table} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-black uppercase text-slate-400">{table}</p>
                <p className="text-sm font-black text-slate-900">{count}</p>
              </div>
            ))}
          </div>

          <p className="text-xs font-black uppercase tracking-widest text-slate-500 mt-6">
            Tabellinnehåll (Provurval)
          </p>
          <div className="max-h-[600px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-[10px] text-emerald-400">
            <pre>{JSON.stringify(dbDump.tables, null, 2)}</pre>
          </div>
        </div>
      )}
    </section>
  );
};

export default DatabaseDumpSection;
