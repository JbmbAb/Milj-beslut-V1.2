import React from 'react';
import type { DbContentsResponse } from '../../types';

interface DbContentsPanelProps {
  contents: DbContentsResponse;
  activeTable: string;
  onSelectTable: (key: string) => void;
}

export const DbContentsPanel: React.FC<DbContentsPanelProps> = ({ contents, activeTable, onSelectTable }) => {
  type ColDef = { header: string; render: (row: any) => React.ReactNode };
  const tables: Array<{ key: keyof DbContentsResponse; label: string; total: number; cols: ColDef[] }> = [
    {
      key: 'documents',
      label: `Dokument (${contents.documents.total.toLocaleString('sv-SE')})`,
      total: contents.documents.total,
      cols: [
        {
          header: 'Ämne',
          render: (r) => (
            <span className="max-w-[200px] truncate block" title={r.subject}>
              {r.subject}
            </span>
          ),
        },
        {
          header: 'Status',
          render: (r) => (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{r.status}</span>
          ),
        },
        { header: 'Kommun', render: (r) => r.municipality ?? <span className="text-slate-400">–</span> },
        { header: 'Beslutstyp', render: (r) => r.decisionType ?? <span className="text-slate-400">–</span> },
        { header: 'Skapad', render: (r) => new Date(r.createdAt).toLocaleDateString('sv-SE') },
      ],
    },
    {
      key: 'requirements',
      label: `Krav (${contents.requirements.total.toLocaleString('sv-SE')})`,
      total: contents.requirements.total,
      cols: [
        { header: 'Kod', render: (r) => <span className="font-mono text-[10px]">{r.requirementCode}</span> },
        { header: 'Kategori', render: (r) => r.category },
        { header: 'Nivå', render: (r) => r.level },
        {
          header: 'Säkerhet',
          render: (r) => {
            const color =
              r.codingConfidence === 'HIGH'
                ? 'bg-green-100 text-green-800'
                : r.codingConfidence === 'MEDIUM'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-red-100 text-red-800';
            return (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>
                {r.codingConfidence}
              </span>
            );
          },
        },
        { header: 'Skapad', render: (r) => new Date(r.createdAt).toLocaleDateString('sv-SE') },
      ],
    },
    {
      key: 'requirementCases',
      label: `Kravärenden (${contents.requirementCases.total.toLocaleString('sv-SE')})`,
      total: contents.requirementCases.total,
      cols: [
        { header: 'Ärendenyckel', render: (r) => <span className="font-mono text-[10px]">{r.caseKey}</span> },
        { header: 'Kommun', render: (r) => r.municipality ?? <span className="text-slate-400">–</span> },
        {
          header: 'Myndighetstyp',
          render: (r) => r.authorityType ?? <span className="text-slate-400">–</span>,
        },
        { header: 'Krav', render: (r) => r.requirementCount },
        { header: 'Skapad', render: (r) => new Date(r.createdAt).toLocaleDateString('sv-SE') },
      ],
    },
    {
      key: 'organisations',
      label: `Organisationer (${contents.organisations.total.toLocaleString('sv-SE')})`,
      total: contents.organisations.total,
      cols: [
        { header: 'Namn', render: (r) => r.name },
        { header: 'Orgnummer', render: (r) => r.orgNumber },
        { header: 'Användare', render: (r) => r.userCount },
        { header: 'Projekt', render: (r) => r.projectCount },
        { header: 'Skapad', render: (r) => new Date(r.createdAt).toLocaleDateString('sv-SE') },
      ],
    },
    {
      key: 'projects',
      label: `Projekt (${contents.projects.total.toLocaleString('sv-SE')})`,
      total: contents.projects.total,
      cols: [
        { header: 'Fastighet', render: (r) => r.propertyDesignation },
        { header: 'Organisation', render: (r) => r.organisationName },
        {
          header: 'Status',
          render: (r) => (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{r.status}</span>
          ),
        },
        { header: 'Dok.', render: (r) => r.documentCount },
        { header: 'Skapad', render: (r) => new Date(r.createdAt).toLocaleDateString('sv-SE') },
      ],
    },
    {
      key: 'extractedRequirements',
      label: `Utdragna krav (${contents.extractedRequirements.total.toLocaleString('sv-SE')})`,
      total: contents.extractedRequirements.total,
      cols: [
        { header: 'Kommun', render: (r) => r.municipality ?? <span className="text-slate-400">–</span> },
        { header: 'Kategori', render: (r) => r.category },
        { header: 'Nivå', render: (r) => r.requirementLevel },
        {
          header: 'Konfidensgrad',
          render: (r) => {
            const pct = Math.round(r.confidence * 100);
            const color = pct >= 80 ? 'text-green-700' : pct >= 50 ? 'text-yellow-700' : 'text-red-700';
            return <span className={`font-bold ${color}`}>{pct}%</span>;
          },
        },
        { header: 'Tolkad', render: (r) => new Date(r.parsedAt).toLocaleDateString('sv-SE') },
      ],
    },
    {
      key: 'emailMessages',
      label: `E-post (${contents.emailMessages.total.toLocaleString('sv-SE')})`,
      total: contents.emailMessages.total,
      cols: [
        {
          header: 'Avsändare',
          render: (r) => (
            <span className="max-w-[150px] truncate block" title={r.sender ?? ''}>
              {r.sender ?? <span className="text-slate-400">–</span>}
            </span>
          ),
        },
        {
          header: 'Ämne',
          render: (r) => (
            <span className="max-w-[200px] truncate block" title={r.subject ?? ''}>
              {r.subject ?? <span className="text-slate-400">–</span>}
            </span>
          ),
        },
        {
          header: 'Status',
          render: (r) => (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{r.status}</span>
          ),
        },
        { header: 'Bilagor', render: (r) => r.attachmentCount },
        {
          header: 'Mottagen',
          render: (r) =>
            r.createdAt ? (
              new Date(r.createdAt).toLocaleDateString('sv-SE')
            ) : (
              <span className="text-slate-400">–</span>
            ),
        },
      ],
    },
    {
      key: 'pipelineRuns',
      label: `Pipeline-körningar (${contents.pipelineRuns.total.toLocaleString('sv-SE')})`,
      total: contents.pipelineRuns.total,
      cols: [
        {
          header: 'Status',
          render: (r) => {
            const color =
              r.status === 'SUCCESS'
                ? 'bg-green-100 text-green-800'
                : r.status === 'FAILED'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800';
            return (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>{r.status}</span>
            );
          },
        },
        {
          header: 'Ingested',
          render: (r) => r.messagesIngested ?? <span className="text-slate-400">–</span>,
        },
        {
          header: 'Utdragna krav',
          render: (r) => r.requirementsExtracted ?? <span className="text-slate-400">–</span>,
        },
        { header: 'Startad', render: (r) => new Date(r.startedAt).toLocaleDateString('sv-SE') },
        {
          header: 'Klar',
          render: (r) =>
            r.finishedAt ? (
              new Date(r.finishedAt).toLocaleDateString('sv-SE')
            ) : (
              <span className="text-slate-400">–</span>
            ),
        },
      ],
    },
  ];

  const [selectedRow, setSelectedRow] = React.useState<any | null>(null);

  const active = tables.find((t) => t.key === activeTable) ?? tables[0];
  const rows = (contents[active.key] as any).rows as any[];

  return (
    <>
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex h-full max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <h3 className="text-lg font-black text-slate-800">
                Fullständig post ({active.label.split(' ')[0]})
              </h3>
              <button
                onClick={() => setSelectedRow(null)}
                className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              >
                Stäng
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
                {JSON.stringify(selectedRow, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Genererad: {new Date(contents.generatedAt).toLocaleString('sv-SE')} · Visar max {contents.limit}{' '}
        poster per tabell
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {tables.map((t) => (
          <button
            key={String(t.key)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${activeTable === t.key ? 'bg-teal-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-teal-50'}`}
            onClick={() => onSelectTable(String(t.key))}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Inga poster hittades i denna tabell.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                {active.cols.map((col) => (
                  <th key={col.header} className="px-3 py-2 font-black">
                    {col.header}
                  </th>
                ))}
                <th className="px-3 py-2 font-black text-right">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row: any, i: number) => (
                <tr 
                  key={row.id ?? row.messageId ?? i} 
                  className="hover:bg-teal-50/40 cursor-pointer"
                  onClick={() => setSelectedRow(row)}
                >
                  {active.cols.map((col) => (
                    <td key={col.header} className="px-3 py-2 text-slate-700">
                      {col.render(row)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <button 
                      className="text-[10px] font-bold text-teal-600 hover:text-teal-800"
                      onClick={(e) => { e.stopPropagation(); setSelectedRow(row); }}
                    >
                      Visa hela
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && active.total > contents.limit && (
        <p className="mt-2 text-right text-xs text-slate-500">
          Visar {rows.length} av totalt {active.total.toLocaleString('sv-SE')} poster
        </p>
      )}
    </>
  );
};

interface DatabaseContentsSectionProps {
  dbContents: DbContentsResponse | null;
  activeTable: string;
  setActiveTable: (v: string) => void;
  busy: boolean;
  token: string;
  onLoad: () => void;
}

const DatabaseContentsSection: React.FC<DatabaseContentsSectionProps> = ({
  dbContents,
  activeTable,
  setActiveTable,
  busy,
  token,
  onLoad,
}) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
            Faktiskt registerinnehåll
          </p>
          <h3 className="text-lg font-black text-slate-900">Organisationer · Projekt · Senaste poster</h3>
          <p className="mt-1 text-xs text-slate-500">
            En ögonblicksbild av vad som faktiskt ligger i databasens huvudtabeller just nu.
          </p>
        </div>
        <button
          className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={busy || !token}
          onClick={onLoad}
        >
          {busy ? 'Hämtar...' : 'Hämta databasinnehåll'}
        </button>
      </div>

      {dbContents && (
        <DbContentsPanel contents={dbContents} activeTable={activeTable} onSelectTable={setActiveTable} />
      )}
      {!dbContents && (
        <p className="mt-4 text-sm text-slate-500">
          Klicka "Hämta databasinnehåll" för att inspektera tabeller.
        </p>
      )}
    </section>
  );
};

export default DatabaseContentsSection;
