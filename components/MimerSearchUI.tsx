import React, { useState } from 'react';
import { Search, Sparkles, Sliders, MapPin, Database, Filter, ArrowRight, HelpCircle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { callApi } from '../services/coreApiClient';
import { useTheme } from './context/ThemeContext';

interface SearchChunkResult {
  id: string;
  chunkText: string;
  documentId: string;
  documentTitle: string;
  ftsRank?: number;
  vectorDistance?: number;
  rrfScore?: number;
  finalScore?: number;
  category?: string;
  documentReference?: string;
}

export const MimerSearchUI: React.FC = () => {
  const { isDark } = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [useSpatial, setUseSpatial] = useState(false);
  const [rerank, setRerank] = useState(true);
  
  // Advanced Config params
  const [rrfK, setRrfK] = useState(60);
  const [ftsLimit, setFtsLimit] = useState(50);
  const [vectorLimit, setVectorLimit] = useState(50);
  const [topK, setTopK] = useState(10);
  const [showConfig, setShowConfig] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<SearchChunkResult[]>([]);
  const [searched, setShowResults] = useState(false);

  // Default coordinate boundaries for Gävle Brynäs [minLng, minLat, maxLng, maxLat]
  const GAVLE_BBOX = '17.13,60.66,17.20,60.69';

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setShowResults(true);

    try {
      // Build query string params
      const queryParams: Record<string, string> = {
        query: query.trim(),
        rerank: rerank ? 'true' : 'false',
        rrf_k: String(rrfK),
        fts_limit: String(ftsLimit),
        vector_limit: String(vectorLimit),
        top_k: String(topK),
      };

      if (category) {
        queryParams.category = category;
      }

      if (useSpatial) {
        queryParams.bbox = GAVLE_BBOX;
      }

      // Execute GET search request via coreApiClient
      const response = await callApi<{ ok: boolean; results: SearchChunkResult[] }>('/api/search', {
        method: 'GET',
        query: queryParams,
      });

      if (response && response.results) {
        setResults(response.results);
      } else {
        setResults([]);
      }
    } catch (err: any) {
      console.error('Search error:', err);
      setError(err.message || 'Ett oväntat fel uppstod under sökningen.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-full p-4 md:p-8 transition-colors duration-200 ${
      isDark ? 'bg-[#060607] text-slate-100' : 'bg-slate-50 text-slate-900'
    }`}>
      <div className="mx-auto max-w-6xl space-y-8">
        
        {/* Header Section */}
        <header className={`relative overflow-hidden rounded-[24px] border p-6 md:p-8 transition-all duration-300 ${
          isDark 
            ? 'border-slate-800/80 bg-slate-900/30 backdrop-blur-xl shadow-2xl' 
            : 'border-slate-200 bg-white shadow-sm'
        }`}>
          {isDark && (
            <div className="absolute -top-24 -right-24 w-80 h-80 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />
          )}

          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-2">
              <span className={`text-[10px] font-black uppercase tracking-[0.22em] ${
                isDark ? 'text-cyan-400' : 'text-slate-400'
              }`}>
                Mimers Brunn (Offline-First Engine)
              </span>
              <h1 className={`text-2xl md:text-3xl font-black tracking-tight ${
                isDark ? 'text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400' : 'text-slate-950'
              }`}>
                Alphaevolve Hybrid AI-Sökning
              </h1>
              <p className={`max-w-2xl text-xs md:text-sm leading-relaxed ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}>
                Kör juridisk-semantisk sökning (RAG) mot dina lokalt harvade förordningar, domstolsbeslut och SGU-miljödata.
                Sökningen kombinerar Full-text (FTS) och pgvector-vektorsökning med Reciprocal Rank Fusion (RRF).
              </p>
            </div>
            
            <div className="flex items-center gap-2 self-start md:self-center">
              <div className={`h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse`} />
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Lokal Suveränitet: Aktiv
              </span>
            </div>
          </div>
        </header>

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} className="space-y-4">
          <div className={`relative flex items-center rounded-2xl border p-1 transition-all duration-300 ${
            isDark 
              ? 'border-slate-800 bg-slate-900/40 focus-within:border-cyan-500/50 focus-within:ring-2 focus-within:ring-cyan-500/10' 
              : 'border-slate-200 bg-white focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/10'
          }`}>
            <div className="pl-4 text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Skriv din juridiska eller geografiska fråga (t.ex. 'stabilitetszon eller skredrisk vid schaktmassor'...)"
              className="w-full bg-transparent px-3 py-3.5 text-sm md:text-base outline-none border-none placeholder-slate-500 text-slate-200"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className={`flex items-center gap-2 rounded-xl px-5 py-3 text-xs font-black uppercase tracking-wider text-white transition-all duration-150 ${
                isDark 
                  ? 'bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 shadow-[0_0_15px_rgba(6,182,212,0.2)]' 
                  : 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200'
              }`}
            >
              Sök
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className={`w-3.5 h-3.5 ${isDark ? 'text-cyan-400' : 'text-indigo-600'}`} />
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Kategori:</span>
            </div>
            {['', 'Miljöbalken', 'Myndighetsbeslut', 'Vägledningar', 'Lantmäteriet'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                  category === cat
                    ? isDark 
                      ? 'border-cyan-500/30 bg-cyan-950/40 text-cyan-400' 
                      : 'border-indigo-600 bg-indigo-50 text-indigo-600'
                    : isDark
                      ? 'border-slate-800 bg-slate-900/20 text-slate-400 hover:bg-slate-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat || 'Alla kategorier'}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setUseSpatial(!useSpatial)}
              className={`ml-auto flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                useSpatial
                  ? isDark 
                    ? 'border-cyan-500/30 bg-cyan-950/40 text-cyan-400' 
                    : 'border-indigo-600 bg-indigo-50 text-indigo-600'
                  : isDark
                    ? 'border-slate-800 bg-slate-900/20 text-slate-400 hover:bg-slate-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Gävle Brynäs BBox</span>
            </button>

            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                showConfig
                  ? isDark 
                    ? 'border-cyan-500/30 bg-cyan-950/40 text-cyan-400' 
                    : 'border-indigo-600 bg-indigo-50 text-indigo-600'
                  : isDark
                    ? 'border-slate-800 bg-slate-900/20 text-slate-400 hover:bg-slate-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Parametrar</span>
            </button>
          </div>

          {/* Config Accordion */}
          {showConfig && (
            <div className={`p-6 rounded-2xl border transition-all duration-300 ${
              isDark ? 'border-slate-800 bg-slate-900/20' : 'border-slate-200 bg-white shadow-sm'
            }`}>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">
                  Sökmotorns finjusteringar
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                    RRF_K Parameter: {rrfK}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={rrfK}
                    onChange={(e) => setRrfK(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Styr fusionsvikten mellan FTS och vektorplaceringar.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                    FTS Limit: {ftsLimit}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    value={ftsLimit}
                    onChange={(e) => setFtsLimit(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Antal sökordsträffar att ta med i RRF-analysen.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                    Vector Limit: {vectorLimit}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    value={vectorLimit}
                    onChange={(e) => setVectorLimit(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Antal semantiska pgvector-träffar för fusion.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                    Top K (Resultat): {topK}
                  </label>
                  <input
                    type="range"
                    min="3"
                    max="30"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Maximalt antal slutgiltiga dokumentchunkar att visa.</p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-300">Cross-Encoder Reranking (Feature flag)</p>
                  <p className="text-[10px] text-slate-500">Skicka kandidaterna till cross-encoder modellen efter fusion för optimal ordning.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRerank(!rerank)}
                  className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                    rerank 
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' 
                      : 'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}
                >
                  {rerank ? 'AKTIV' : 'AVSTÄNGD'}
                </button>
              </div>
            </div>
          )}
        </form>

        {/* Results Area */}
        {searched && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">
                Sökresultat ({results.length} träffar)
              </h2>
              {loading && <span className="text-xs text-cyan-400 animate-pulse">Beräknar och fuserar...</span>}
            </div>

            {error && (
              <div className="rounded-xl bg-red-950/20 border border-red-800/40 p-4 text-red-400 text-xs flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Ett fel uppstod vid RAG-sökning</p>
                  <p className="mt-1 opacity-80">{error}</p>
                </div>
              </div>
            )}

            {!loading && !error && results.length === 0 && (
              <div className="text-center py-12 rounded-2xl border border-dashed border-slate-800">
                <HelpCircle className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-xs font-bold text-slate-400">Hittade inga relevanta lagrum eller beslut.</p>
                <p className="text-[10px] text-slate-500 mt-1">Testa att bredda din sökning eller justera filterparametrar.</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              {results.map((result, idx) => (
                <div
                  key={result.id || idx}
                  className={`group relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 ${
                    isDark 
                      ? 'border-slate-800 bg-slate-900/10 hover:border-slate-700/80 hover:bg-slate-900/20 hover:shadow-xl' 
                      : 'border-slate-200 bg-white hover:border-indigo-200'
                  }`}
                >
                  {/* Score badge top-right */}
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${
                      isDark 
                        ? 'border-slate-800 bg-slate-950 text-slate-400' 
                        : 'border-slate-100 bg-slate-100 text-slate-500'
                    }`}>
                      RRF Rank: #{idx + 1}
                    </span>
                    {result.finalScore !== undefined && (
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-cyan-950/40 text-cyan-400 border border-cyan-800/30">
                        Score: {result.finalScore.toFixed(4)}
                      </span>
                    )}
                  </div>

                  {/* Category and Doc info */}
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      {result.category || 'Mimer-Corpus'}
                    </span>
                    {result.documentReference && (
                      <>
                        <span className="text-slate-700">•</span>
                        <span className="text-[10px] font-bold text-slate-400">
                          {result.documentReference}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Document Title */}
                  <h3 className={`text-sm font-black tracking-tight leading-snug pr-32 mb-3 ${
                    isDark ? 'text-white' : 'text-slate-950'
                  }`}>
                    {result.documentTitle}
                  </h3>

                  {/* Excerpt text */}
                  <p className={`text-xs leading-relaxed ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    {result.chunkText}
                  </p>

                  {/* Chunk footer with retrieval breakdown */}
                  <div className="mt-4 pt-3 border-t border-slate-800/50 flex flex-wrap gap-4 text-[9px] text-slate-500">
                    {result.ftsRank !== undefined && (
                      <span>FTS Rank: {result.ftsRank.toFixed(4)}</span>
                    )}
                    {result.vectorDistance !== undefined && (
                      <span>Vector Dist: {result.vectorDistance.toFixed(4)}</span>
                    )}
                    {result.rrfScore !== undefined && (
                      <span>RRF Baseline: {result.rrfScore.toFixed(4)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
