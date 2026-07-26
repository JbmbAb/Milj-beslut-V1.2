import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  BookOpen,
  Cpu,
  FileText,
  Terminal,
  Sparkles,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  BarChart4,
  Clock,
  Layers,
  Search,
} from 'lucide-react';
import { callMvp } from '../../services/mvpApiClient';
import { Badge, Card } from './mvpDemoShared';

// Typer för geodata checklist
type GeodataItem = {
  id: string;
  name: string;
  source: string;
  count: number;
  status: 'active' | 'harvesting' | 'queued';
  harvestDate: string;
  table: string;
  coverage: string;
};

// Exempeltexter för chunking-playground
const CHUNKING_TEMPLATES = {
  miljobalken: `2 kap. 3 § SFS 1998:808
Alla som bedriver eller avser att bedriva en verksamhet eller vidta en åtgärd skall utföra de skyddsåtgärder, iaktta de begränsningar och vidta de försiktighetsmått i övrigt som behövs för att förebygga, hindra eller motverka att verksamheten eller åtgärden medför skada eller olägenhet för människors hälsa eller miljön.

I samma syfte skall vid yrkesmässig verksamhet användas bästa möjliga teknik.

Dessa försiktighetsmått skall vidtas så snart det finns skäl att anta att en verksamhet eller åtgärd kan medföra skada eller olägenhet för människors hälsa eller miljön.`,

  mmdDom: `NACKA TINGSRÄTT — Mark- och miljödomstolen
DOMSLUT — Mål nr M 4321-25
Mark- och miljödomstolen avslår överklagandet av Miljö- och hälsoskyddsnämndens i Värmdö kommun beslut 2025-04-12, dnr MH-2025-456, om föreläggande att vidta försiktighetsmått för enskilt avlopp på fastigheten ÄLVSBY 1:12.

SKÄL FÖR BESLUTET
Utredningen i målet visar att den befintliga avloppsanläggningen är äldre än 25 år och saknar efterföljande rening efter slamavskiljaren. Nämnden har därför haft fog för sitt beslut att belägga anläggningen med användningsförbud samt kräva inrättande av ny godkänd anläggning. Särskild hänsyn har tagits till att fastigheten ligger inom skyddszon för vattentäkt.`,

  skordningslogg: `BIBBI SKÖRDNINGSLOGG — 2026-07-26
- Startade harvesting av naturvardsregistret...
- Hittade 22 filer i https://geodata.naturvardsverket.se/nedladdning/naturvardsregistret/
- Laddade ner DVO.zip (2.7 MB) — SHA-256 verifierad.
- Laddade ner NR.zip (12.3 MB) — SHA-256 verifierad.
- Laddade ner NVO.zip (2.4 MB) — SHA-256 verifierad.
- Ingestion av env.wetland slutförd: 114 934 rader aktiverade i PostGIS!`,
};

type ParserType = 'sfs' | 'mmd' | 'standard';

type ChunkNode = {
  id: string;
  header: string;
  text: string;
  tokens: number;
  tags: string[];
  overlap: boolean;
};

type LegalSearchMeta = {
  exactMs?: number;
  ftsMs?: number;
  vectorMs?: number;
  rrfMs?: number;
  rerankMs?: number;
  totalMs?: number;
  rerankerStatus?: string;
  rerankerEngine?: string;
  shadowChangedTop1?: boolean;
  shadowChangedTop5?: boolean;
  shadowScoreDelta?: number;
  kendallTau?: number;
  ndcg5?: number;
  mrr?: number;
  recall10?: number;
};

type ShadowMetricsView = {
  retrievalMs: number;
  rerankMs: number;
  totalMs: number;
  returnedCount: number;
  rerankedCount: number;
  shadowChangedTop1Label: string;
  shadowChangedTop5Label: string;
  shadowScoreDelta: number;
  ndcgAt5: number;
  mrr: number;
  recallAt10: number;
  rerankerStatus: string;
  loaded: boolean;
  error: string | null;
  probedAt: string | null;
};

const EMPTY_SHADOW: ShadowMetricsView = {
  retrievalMs: 0,
  rerankMs: 0,
  totalMs: 0,
  returnedCount: 0,
  rerankedCount: 0,
  shadowChangedTop1Label: '—',
  shadowChangedTop5Label: '—',
  shadowScoreDelta: 0,
  ndcgAt5: 0,
  mrr: 0,
  recallAt10: 0,
  rerankerStatus: 'idle',
  loaded: false,
  error: null,
  probedAt: null,
};

function metaToShadowView(meta: LegalSearchMeta, resultCount: number): ShadowMetricsView {
  const retrievalMs = (meta.exactMs || 0) + (meta.ftsMs || 0) + (meta.vectorMs || 0);
  return {
    retrievalMs: Math.round(retrievalMs * 10) / 10,
    rerankMs: Math.round((meta.rerankMs || 0) * 10) / 10,
    totalMs: Math.round((meta.totalMs || 0) * 10) / 10,
    returnedCount: resultCount,
    rerankedCount: meta.rerankerStatus === 'applied' ? resultCount : 0,
    shadowChangedTop1Label: meta.shadowChangedTop1 ? 'Ja' : 'Nej',
    shadowChangedTop5Label: meta.shadowChangedTop5 ? 'Ja' : 'Nej',
    shadowScoreDelta: meta.shadowScoreDelta ?? 0,
    ndcgAt5: meta.ndcg5 ?? 0,
    mrr: meta.mrr ?? 0,
    recallAt10: meta.recall10 ?? 0,
    rerankerStatus: meta.rerankerStatus || 'unknown',
    loaded: true,
    error: null,
    probedAt: new Date().toLocaleTimeString('sv-SE'),
  };
}

export const MvpLibrarianView: React.FC = () => {
  const [geodata, setGeodata] = useState<GeodataItem[]>([
    {
      id: 'wetland',
      name: 'Våtmarker (Naturvårdsverket)',
      source: 'Naturvårdsverket',
      count: 114934,
      status: 'active',
      harvestDate: '2026-07-26',
      table: 'env.wetland',
      coverage: '100% Rikstäckande',
    },
    {
      id: 'wells',
      name: 'Enskilda brunnar (SGU)',
      source: 'Sveriges Geologiska Undersökning',
      count: 832535,
      status: 'active',
      harvestDate: '2026-07-24',
      table: 'env.sgu_well',
      coverage: '832k brunnar',
    },
    {
      id: 'viss',
      name: 'Vattenförekomster (VISS)',
      source: 'Vatteninformationssystem Sverige',
      count: 23804,
      status: 'active',
      harvestDate: '2026-07-20',
      table: 'viss.vattenforekomster_ytvatten',
      coverage: '23.8k sjöar/vattendrag',
    },
    {
      id: 'roads',
      name: 'Vägkartan (Topo10)',
      source: 'Lantmäteriet',
      count: 3023801,
      status: 'active',
      harvestDate: '2026-07-22',
      table: 'topo10.vag',
      coverage: '3.02M vägsegment',
    },
    {
      id: 'ebh',
      name: 'Förorenade områden (EBH)',
      source: 'Länsstyrelserna',
      count: 85429,
      status: 'active',
      harvestDate: '2026-07-18',
      table: 'lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc',
      coverage: '85.4k riskobjekt',
    },
    {
      id: 'nvr',
      name: 'Naturvårdsregistret (Skyddade områden)',
      source: 'Naturvårdsverket',
      count: 6572,
      status: 'active',
      harvestDate: '2026-07-26',
      table: 'env.water_protection_area & env.nv_naturreservat',
      coverage: '22 filer skördade nyss!',
    },
    {
      id: 'friluftsliv',
      name: 'Friluftslivsanläggningar',
      source: 'Naturvårdsverket',
      count: 0,
      status: 'harvesting',
      harvestDate: 'Skördar just nu...',
      table: 'env.friluftsliv (Staging)',
      coverage: '9 filer skördas (0.21 GB)',
    },
  ]);

  const [loadingStats, setLoadingStats] = useState(false);
  const [chunkText, setChunkText] = useState(CHUNKING_TEMPLATES.miljobalken);
  const [parserMode, setParserType] = useState<ParserType>('sfs');
  const [chunks, setChunks] = useState<ChunkNode[]>([]);
  const [isChunking, setIsChunking] = useState(false);
  const [probeQuery, setProbeQuery] = useState('miljöbalken avlopp');
  const [probeLoading, setProbeLoading] = useState(false);
  const [shadowMetrics, setShadowMetrics] = useState<ShadowMetricsView>(EMPTY_SHADOW);

  const refreshDatabaseStats = async () => {
    setLoadingStats(true);
    try {
      const response = await callMvp<{
        ok: boolean;
        skyddadeOmraden: number;
        kulturmiljoer: number;
        vatmarker: number;
        fastigheter: number;
      }>('/api/geodata/stats', { method: 'GET' });

      if (response && response.ok) {
        setGeodata((prev) =>
          prev.map((item) => {
            if (item.id === 'wetland') {
              return { ...item, count: response.vatmarker || 114934 };
            }
            if (item.id === 'nvr') {
              return { ...item, count: response.skyddadeOmraden || 6572 };
            }
            if (item.id === 'roads' && response.fastigheter > 0) {
              return { ...item, count: response.fastigheter, coverage: 'Live från PostGIS' };
            }
            return item;
          }),
        );
      }
    } catch (e) {
      console.error('Failed to sync geodata stats:', e);
    } finally {
      setLoadingStats(false);
    }
  };

  const runProbeSearch = async () => {
    const query = probeQuery.trim();
    if (query.length < 2) return;

    setProbeLoading(true);
    setShadowMetrics((prev) => ({ ...prev, error: null }));
    try {
      const response = await callMvp<{
        ok: boolean;
        results?: unknown[];
        meta?: LegalSearchMeta;
        error?: string;
      }>('/api/legal/search', {
        method: 'POST',
        body: { query },
      });

      if (!response.ok || !response.meta) {
        setShadowMetrics({
          ...EMPTY_SHADOW,
          error: response.error || 'Sökningen returnerade inga metrics.',
        });
        return;
      }

      setShadowMetrics(metaToShadowView(response.meta, response.results?.length ?? 0));
    } catch (e) {
      setShadowMetrics({
        ...EMPTY_SHADOW,
        error: e instanceof Error ? e.message : 'Probesökning misslyckades.',
      });
    } finally {
      setProbeLoading(false);
    }
  };

  const handleChunkText = useCallback(() => {
    setIsChunking(true);
    setTimeout(() => {
      const textToChunk = chunkText || CHUNKING_TEMPLATES.miljobalken;
      const paragraphs = textToChunk
        .split('\n\n')
        .map((p) => p.trim())
        .filter(Boolean);

      const generatedChunks: ChunkNode[] = paragraphs.map((para, idx) => {
        let header = 'Standard Stycke';
        let tags: string[] = [];
        const tokens = Math.round(para.length / 4.8) + 12; // Grov uppskattning av tokenlängd

        if (parserMode === 'sfs') {
          const match = para.match(/^(\d+\s+kap\.\s+\d+\s+§)/i);
          if (match) {
            header = match[1];
            tags = ['SFS Lag', 'Hänsynsregel', 'Miljöbalken'];
          } else {
            header = `MB Stycke ${idx + 1}`;
            tags = ['MB Kontext', 'Lagrum'];
          }
        } else if (parserMode === 'mmd') {
          if (para.includes('DOMSLUT')) {
            header = 'DOMSLUT (Huvudbeslut)';
            tags = ['Rättsfall', 'Mål-ID', 'Domslut'];
          } else if (para.includes('SKÄL')) {
            header = 'SKÄL FÖR BESLUT';
            tags = ['Domskäl', 'Juridisk Prövning'];
          } else {
            header = `MMD Stycke ${idx + 1}`;
            tags = ['Domskontext'];
          }
        } else {
          header = `Nod #${idx + 1}`;
          tags = ['Standard Paragraph'];
        }

        return {
          id: `node-${idx + 1}`,
          header,
          text: para,
          tokens,
          tags,
          overlap: idx > 0, // Markera som överlappande nod
        };
      });

      setChunks(generatedChunks);
      setIsChunking(false);
    }, 400);
  }, [chunkText, parserMode]);

  useEffect(() => {
    void refreshDatabaseStats();
    handleChunkText();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial demo chunk only
  }, []);

  return (
    <div className="animate-in slide-in-from-bottom-4 space-y-8 fade-in duration-500">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Database size={12} className="animate-pulse" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">
              Mimers Brunn Dataarkiv
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mt-1">
            Mimer Bibliotekarie (Bibbi)
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl mt-1">
            Visualisering av skördade geodatabaser, interaktiv semantisk chunking-analys och
            realtidsutvärdering av RAG-reranker.
          </p>
        </div>

        <button
          onClick={refreshDatabaseStats}
          disabled={loadingStats}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loadingStats ? 'animate-spin' : ''} />
          Synka PostGIS Stats
        </button>
      </div>

      {/* SECTION 1: SWEDISH GEODATA INVENTORY */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Layers size={18} className="text-indigo-600" />
            Kanonisk Geodata-Checklista
          </h2>
          <Badge label="Offline-First" color="bg-indigo-50 text-indigo-700 border border-indigo-100" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {geodata.map((item) => (
            <Card
              key={item.id}
              className={`relative border transition-all hover:shadow-md ${
                item.status === 'harvesting'
                  ? 'border-amber-200 bg-amber-50/20'
                  : 'border-slate-200 hover:border-indigo-300'
              }`}
            >
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    {item.source}
                  </span>
                  {item.status === 'active' ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black tracking-tight text-emerald-700">
                      <CheckCircle2 size={10} /> MIMERS OK
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black tracking-tight text-amber-800 animate-pulse">
                      <RefreshCw size={10} className="animate-spin" /> SKÖRDAR
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-black text-slate-900 leading-snug">{item.name}</h3>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-black tracking-tight text-slate-800">
                      {item.count > 0 ? item.count.toLocaleString('sv-SE') : '—'}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">rader</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">PostGIS Tabell:</span>
                    <span className="font-mono font-bold text-slate-600">{item.table}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Skördad datum:</span>
                    <span className="text-slate-600 font-bold">{item.harvestDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status & Täckning:</span>
                    <span className="text-slate-600 font-bold">{item.coverage}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* SECTION 2: SEMANTIC CHUNKING SIMULATOR & PLAYGROUND */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Playboard panel */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <BookOpen size={18} className="text-indigo-600" />
            Interaktiv Semantisk Chunking
          </h2>

          <Card className="border-slate-200">
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-400 block mb-2">
                  Läs in Exempeltext
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setChunkText(CHUNKING_TEMPLATES.miljobalken);
                      setParserType('sfs');
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    SFS Miljöbalken
                  </button>
                  <button
                    onClick={() => {
                      setChunkText(CHUNKING_TEMPLATES.mmdDom);
                      setParserType('mmd');
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    Domslut (MMD)
                  </button>
                  <button
                    onClick={() => {
                      setChunkText(CHUNKING_TEMPLATES.skordningslogg);
                      setParserType('standard');
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    Skördningslogg (Ostrukturerad)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-400 block mb-2">
                  Välj Semantisk Parser
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['sfs', 'mmd', 'standard'] as ParserType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setParserType(t)}
                      className={`rounded-xl py-2 text-xs font-black border transition ${
                        parserMode === t
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {t === 'sfs' ? 'SFS Lagrum' : t === 'mmd' ? 'Domslut (MMD)' : 'Standard Text'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Källtext för analys
                </label>
                <textarea
                  value={chunkText}
                  onChange={(e) => setChunkText(e.target.value)}
                  rows={6}
                  className="w-full rounded-xl border border-slate-200 p-3.5 text-xs font-medium outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Klistra in eller välj en text ovan..."
                />
              </div>

              <button
                onClick={handleChunkText}
                disabled={isChunking}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Cpu size={16} className={isChunking ? 'animate-spin' : ''} />
                Analysera & Chunkera
              </button>
            </div>
          </Card>
        </div>

        {/* Output nodes visualizer */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Terminal size={18} className="text-indigo-600" />
            Utvunnet Semantiskt Träd ({chunks.length} noder)
          </h2>

          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            {chunks.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-slate-400">
                <FileText size={32} className="mb-2 text-slate-300" />
                <p className="text-sm font-bold">Inget resultat laddat</p>
                <p className="text-xs">
                  Skriv eller klistra in en text och tryck på "Analysera" till vänster.
                </p>
              </div>
            ) : (
              chunks.map((node, idx) => (
                <div
                  key={node.id}
                  className="animate-in fade-in slide-in-from-right-2 duration-300 rounded-2xl border border-slate-200 bg-white p-4.5 space-y-3 shadow-sm hover:border-indigo-200"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-indigo-50 text-[10px] font-black text-indigo-700">
                        {idx + 1}
                      </span>
                      <h4 className="text-xs font-black text-slate-800 tracking-tight">{node.header}</h4>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                        {node.tokens} tokens
                      </span>
                      {node.overlap && (
                        <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100/50">
                          Överlapp
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-600 font-medium bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                    {node.text}
                  </p>

                  <div className="flex flex-wrap gap-1.5">
                    {node.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-[9px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full"
                      >
                        # {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: SEARCH EVALUATION BOARD & SHADOW VALIDATION TELEMETRY */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <BarChart4 size={18} className="text-indigo-600" />
            Utvärderingsbord & Skuggvalidering (Shadow Mode)
          </h2>
          <Badge
            label={shadowMetrics.loaded ? `Rerank: ${shadowMetrics.rerankerStatus}` : 'Ej probad'}
            color="bg-emerald-50 text-emerald-700 border border-emerald-100"
          />
        </div>

        <Card className="border-slate-200">
          <div className="p-5 space-y-3">
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 block">
              Probesökning mot legal corpus (live telemetry)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  value={probeQuery}
                  onChange={(e) => setProbeQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runProbeSearch();
                  }}
                  placeholder="Ex: miljöbalken avlopp, fosforrening..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <button
                type="button"
                onClick={() => void runProbeSearch()}
                disabled={probeLoading || probeQuery.trim().length < 2}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {probeLoading ? 'Söker...' : 'Kör probesökning'}
              </button>
            </div>
            {shadowMetrics.error ? (
              <p className="text-xs font-bold text-red-600">{shadowMetrics.error}</p>
            ) : null}
            {shadowMetrics.probedAt ? (
              <p className="text-[10px] font-bold text-slate-400">
                Senaste probesökning: {shadowMetrics.probedAt}
              </p>
            ) : (
              <p className="text-[10px] font-bold text-slate-400">
                Kräver inloggning (admin-token). Kör probesökning för live shadow-metrics.
              </p>
            )}
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Latency card */}
          <Card className="border-slate-200">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Sökfördröjning (Latency)
                </span>
                <Clock size={16} className="text-indigo-600" />
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                    <span>Hämtning (Retrieval)</span>
                    <span className="font-mono">{shadowMetrics.retrievalMs} ms</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{
                        width: `${shadowMetrics.totalMs > 0 ? Math.min(100, (shadowMetrics.retrievalMs / shadowMetrics.totalMs) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                    <span>Reranker (Vertex AI)</span>
                    <span className="font-mono">{shadowMetrics.rerankMs} ms</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-indigo-600"
                      style={{
                        width: `${shadowMetrics.totalMs > 0 ? Math.min(100, (shadowMetrics.rerankMs / shadowMetrics.totalMs) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="pt-2 flex justify-between items-baseline border-t border-slate-100">
                  <span className="text-xs font-black text-slate-800">Total Latency:</span>
                  <span className="font-mono text-lg font-black text-slate-900">
                    {shadowMetrics.totalMs} ms
                  </span>
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-500">
                  <span>Returnerade / rerankade</span>
                  <span>
                    {shadowMetrics.returnedCount} / {shadowMetrics.rerankedCount}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Shadow change metrics */}
          <Card className="border-slate-200">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Skuggvaliderings-skillnad
                </span>
                <TrendingUp size={16} className="text-indigo-600" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                    Changed Top-1
                  </span>
                  <span className="font-mono text-xl font-black text-indigo-600 mt-1 block">
                    {shadowMetrics.shadowChangedTop1Label}
                  </span>
                  <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                    Första träffen ändrad
                  </span>
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                    Changed Top-5
                  </span>
                  <span className="font-mono text-xl font-black text-indigo-600 mt-1 block">
                    {shadowMetrics.shadowChangedTop5Label}
                  </span>
                  <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                    Topp-5 ordning ändrad
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <AlertCircle size={12} className="text-indigo-500 shrink-0" />
                <span>
                  {shadowMetrics.loaded
                    ? 'Värden från senaste probesökning mot /api/legal/search.'
                    : 'Kör probesökning ovan för live shadow-metrics från backend.'}
                </span>
              </div>
            </div>
          </Card>

          {/* Reranker quality scores */}
          <Card className="border-slate-200">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Sökkvalitet & Precision
                </span>
                <Sparkles size={16} className="text-indigo-600" />
              </div>
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-600">NDCG @ 5 (Relevans):</span>
                  <span className="font-mono text-xs font-black text-slate-800">{shadowMetrics.ndcgAt5}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-600">MRR (Placering):</span>
                  <span className="font-mono text-xs font-black text-slate-800">{shadowMetrics.mrr}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-600">Recall @ 10 (Täckning):</span>
                  <span className="font-mono text-xs font-black text-slate-800">
                    {shadowMetrics.recallAt10}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <span className="text-xs font-black text-slate-800">Skugga relevans delta:</span>
                  <span className="font-mono text-xs font-black text-emerald-600">
                    {shadowMetrics.shadowScoreDelta >= 0 ? '+' : ''}
                    {shadowMetrics.shadowScoreDelta} Δ
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MvpLibrarianView;
