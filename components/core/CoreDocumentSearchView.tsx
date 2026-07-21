import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { callCore } from '../../services/coreApiClient';
import type { Project, SearchResult } from './coreDemoModel';
import { Badge, Card } from './coreDemoShared';

type CoreDocumentSearchViewProps = {
  project: Project;
};

const CoreDocumentSearchView: React.FC<CoreDocumentSearchViewProps> = ({ project }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const performSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      const response = await callCore<{ results?: SearchResult[] }>(`/api/v1/projects/${project.id}/search`, {
        method: 'GET',
        query: { q: query, topK: 6 },
      });
      setResults(response.results || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-in slide-in-from-left-4 space-y-6 fade-in duration-400">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-xl font-black text-slate-900">Sök i projektets kunskapsbas</h2>
        <p className="mb-6 text-sm text-slate-500">
          Hybrid-sökning (semantisk + nyckelord) mot RAG-indexerade dokument för {project.propertyDesignation}
          .
        </p>

        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void performSearch();
                }
              }}
              placeholder="Ex: lakvattenrening, tätskikt sporthall, bullerkrav..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <button
            onClick={() => {
              void performSearch();
            }}
            disabled={loading}
            className="rounded-2xl bg-indigo-600 px-6 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Söker...' : 'Sök'}
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {results.map((result) => (
          <Card key={result.id} className="border-l-4 border-l-indigo-500 p-5">
            <div className="mb-2 flex items-start justify-between">
              <h4 className="cursor-pointer font-bold text-slate-900 underline decoration-slate-200 hover:decoration-indigo-400">
                {result.originalName || result.subject}
              </h4>
              <Badge
                label={`${Math.round(result.score * 100)}% Match`}
                color="bg-indigo-50 text-indigo-700"
              />
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge label={result.municipality || 'Okänd Kommun'} />
              <Badge label={result.decisionType || 'Okänd Beslutstyp'} />
            </div>
            <p className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm italic text-slate-600">
              "...{result.snippet}..."
            </p>
          </Card>
        ))}
        {!loading && results.length === 0 && query ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 py-20 text-center">
            <p className="font-medium text-slate-400">Inga träffar på "{query}". Prova en bredare sökning.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CoreDocumentSearchView;
