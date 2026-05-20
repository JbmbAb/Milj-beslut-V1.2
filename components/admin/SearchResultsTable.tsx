import React from 'react';
import type { SearchQueryResponse } from '../../types';

interface SearchResultsTableProps {
  searchResults: SearchQueryResponse | null;
}

const SearchResultsTable: React.FC<SearchResultsTableProps> = ({ searchResults }) => {
  if (!searchResults) return null;

  return (
    <section
      data-testid="admin-search-results"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black text-slate-900">Sökresultat</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
          {searchResults.results.length} träffar ({searchResults.elapsedMs}ms)
        </span>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3 font-black">Matchning / Dokument</th>
              <th className="px-4 py-3 font-black">Snippet / Bevis</th>
              <th className="px-4 py-3 font-black">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {searchResults.results.map((res) => (
              <tr key={res.documentId} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg px-2 py-1 text-[10px] font-black ${res.score > 0.8 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
                    >
                      {Math.round(res.score * 100)}%
                    </span>
                    <p className="font-bold text-slate-900">{res.metadata.subject}</p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">ID: {res.documentId}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">Matchorsak: {res.whyMatched}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-md rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-600 italic">
                    {res.snippet}
                  </div>
                  {res.citations && res.citations.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {res.citations.map((cit, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-indigo-100 bg-indigo-50/50 p-1.5 text-[10px]"
                        >
                          <span className="font-bold text-indigo-700">
                            Citat ({Math.round(cit.confidence * 100)}%):
                          </span>{' '}
                          {cit.quote}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1 text-[10px]">
                    <p>
                      <span className="font-bold">Kommun:</span> {res.metadata.municipality || '-'}
                    </p>
                    <p>
                      <span className="font-bold">Typ:</span> {res.metadata.wasteType || '-'}
                    </p>
                    <p>
                      <span className="font-bold">Beslut:</span> {res.metadata.decisionType || '-'}
                    </p>
                    <p>
                      <span className="font-bold">Organisation:</span> {res.metadata.organisationName || '-'}
                    </p>
                    <p>
                      <span className="font-bold">Datum:</span>{' '}
                      {res.metadata.receivedTime
                        ? new Date(res.metadata.receivedTime).toLocaleDateString('sv-SE')
                        : '-'}
                    </p>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default SearchResultsTable;
