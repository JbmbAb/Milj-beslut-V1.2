import React, { useState, useEffect } from 'react';
import {
  Search,
  Rocket,
  FileText,
  AlertTriangle,
  ChevronRight,
  LayoutDashboard,
  Download,
  ClipboardCheck,
  Activity,
  ShieldAlert,
  Scale,
  Map as MapIcon,
} from 'lucide-react';
import { callCore } from '../services/coreApiClient';
import { PropertyAnalysisPanel } from './PropertyAnalysisPanel';

// ─── Types ─────────────────────────────────────────────────────────────────
type Project = {
  id: string;
  propertyDesignation: string;
  status: string;
  docCount: number;
  coverage: {
    municipality: number;
    decisionType: number;
  };
};

type SearchResult = {
  id: string;
  originalName: string;
  subject: string;
  municipality: string;
  decisionType: string;
  snippet: string;
  score: number;
};

type Classification = {
  classification: string;
  riskLevel: string;
  suggestedCode: string;
  confidence: number;
  missingFields: string[];
  citations: Array<{ source: string; snippet: string; municipality: string }>;
};

type MunicipalityInsight = {
  name: string;
  index: number;
  ranking: number;
  commonRisks: string[];
  commonRequirements: string[];
  stats: {
    avgRequirements: number;
    riskCoveragePct: number;
    documentationLevel: string;
  };
  patterns: string[];
};

// ─── Shared Components ──────────────────────────────────────────────────────
const Card: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({
  children,
  className = '',
  onClick,
}) => (
  <div
    className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}
    onClick={onClick}
  >
    {children}
  </div>
);

const Badge: React.FC<{ label: string; color?: string; className?: string; icon?: React.ReactNode }> = ({
  label,
  color = 'bg-slate-100 text-slate-700',
  className = '',
  icon,
}) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-tight ${color} ${className}`}
  >
    {icon && <span>{icon}</span>}
    {label}
  </span>
);

// ─── SCREEN 1: PROJECT DASHBOARD ───────────────────────────────────────────
const ProjectDashboard: React.FC<{ onSelect: (p: Project) => void }> = ({ onSelect }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    callCore<{ projects: Project[] }>('/api/v1/projects', { method: 'GET' })
      .then((res) => setProjects(res.projects))
      .catch((err) => {
        console.error(err);
        setApiError('System-API ej tillgänglig – kontrollera anslutningen.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-10 text-center animate-pulse text-slate-400">Laddar projekt...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Mina Projekt</h1>
        <p className="text-slate-500">Översikt av pågående miljöprövningar och data-täckning.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Sök fastighet..."
            className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition w-64"
          />
        </div>
        <button
          type="button"
          disabled
          className="px-4 py-2 bg-slate-200 text-slate-500 text-sm font-black rounded-xl cursor-not-allowed"
        >
          Skapa nytt projekt
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {apiError && (
          <div className="col-span-full rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 flex items-start gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
            <div>
              <p className="font-bold">Backend-anslutning krävs</p>
              <p className="mt-0.5 text-amber-700">{apiError}</p>
              <p className="mt-1 text-xs text-amber-600">
                Projektdata hämtas direkt från produktionsdatabasen för fullständig analys.
              </p>
            </div>
          </div>
        )}
        {projects.map((project) => (
          <Card
            key={project.id}
            className="hover:border-indigo-300 transition-colors cursor-pointer group"
            onClick={() => onSelect(project)}
          >
            <div className="p-5">
              <div className="flex justify-between items-start mb-4">
                <Badge
                  label={project.status}
                  color={
                    project.status === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-50 text-slate-600'
                  }
                />
                <span className="text-xs text-slate-400 font-mono">{project.id.slice(-6)}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1 group-hover:text-indigo-600 transition-colors">
                {project.propertyDesignation}
              </h3>
              <p className="text-sm text-slate-500 flex items-center gap-1">
                <FileText size={14} /> {project.docCount} Dokument
              </p>

              <div className="mt-5 space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-bold uppercase text-slate-400">
                    <span>Kommun-matchning</span>
                    <span>{project.coverage.municipality}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${project.coverage.municipality}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-bold uppercase text-slate-400">
                    <span>Beslutstyp-matchning</span>
                    <span>{project.coverage.decisionType}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${project.coverage.decisionType}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-500 group-hover:bg-indigo-50 transition-colors">
              Analysera projekt <ChevronRight size={16} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

// ─── COMPONENT: MUNICIPALITY INSIGHT ───────────────────────────────────────
const MunicipalityInsightCard: React.FC<{ name: string }> = ({ name }) => {
  const [insight, setInsight] = useState<MunicipalityInsight | null>(null);

  useEffect(() => {
    if (!name) return;
    callCore<{ insight: MunicipalityInsight }>(`/api/v1/municipality/${name}/insight`, { method: 'GET' })
      .then((res) => setInsight(res.insight))
      .catch((err) => console.error(err));
  }, [name]);

  if (!insight) return <div className="animate-pulse bg-slate-100 rounded-3xl h-64"></div>;

  return (
    <Card className="p-6 bg-white border-indigo-100 shadow-sm">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-black text-slate-900 leading-none">Tillsynsindex: {insight.name}</h3>
          <p className="text-[10px] uppercase font-black text-slate-400 mt-1">Regulatorisk profil</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-indigo-600">{insight.index}</div>
          <div className="text-[9px] font-bold text-slate-400 uppercase">
            Ranking: #{insight.ranking} av 290
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        <div className="p-2.5 bg-slate-50 rounded-2xl text-center">
          <Scale size={14} className="text-indigo-500 mx-auto mb-1.5" />
          <div className="text-xs font-black">{insight.stats.avgRequirements}</div>
          <div className="text-[8px] text-slate-400 uppercase font-bold">Krav / beslut</div>
        </div>
        <div className="p-2.5 bg-slate-50 rounded-2xl text-center">
          <ShieldAlert size={14} className="text-emerald-500 mx-auto mb-1.5" />
          <div className="text-xs font-black">{insight.stats.riskCoveragePct}%</div>
          <div className="text-[8px] text-slate-400 uppercase font-bold">Riskfokus</div>
        </div>
        <div className="p-2.5 bg-slate-50 rounded-2xl text-center">
          <ClipboardCheck size={14} className="text-amber-500 mx-auto mb-1.5" />
          <div className="text-xs font-black">{insight.stats.documentationLevel}</div>
          <div className="text-[8px] text-slate-400 uppercase font-bold">Dok-krav</div>
        </div>
      </div>

      <div className="space-y-4">
        {insight.patterns && insight.patterns.length > 0 && (
          <div>
            <h4 className="text-[9px] font-black text-slate-400 uppercase mb-2">Regulatoriska Mönster</h4>
            <div className="flex flex-wrap gap-1.5">
              {insight.patterns.map((p) => (
                <Badge key={p} label={p} color="bg-amber-50 text-amber-700 border border-amber-100" />
              ))}
            </div>
          </div>
        )}
        <div>
          <h4 className="text-[9px] font-black text-slate-400 uppercase mb-2">Vanligaste Fokusområden</h4>
          <div className="flex flex-wrap gap-1.5">
            {insight.commonRisks.map((r) => (
              <Badge key={r} label={r} color="bg-indigo-50 text-indigo-700" />
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-[9px] font-black text-slate-400 uppercase mb-2">
            Typiska Krav i {insight.name}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {insight.commonRequirements.map((r) => (
              <Badge key={r} label={r} color="bg-emerald-50 text-emerald-700" />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

// ─── SCREEN 2: DOCUMENT SEARCH ─────────────────────────────────────────────
const DocumentSearch: React.FC<{ project: Project }> = ({ project }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const performSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await callCore<any>(`/api/v1/projects/${project.id}/search`, {
        method: 'GET',
        query: { q: query, topK: 6 },
      });
      setResults(res.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-400">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-black text-slate-900 mb-2">Sök i projektets kunskapsbas</h2>
        <p className="text-sm text-slate-500 mb-6">
          Hybrid-sökning (semantisk + nyckelord) mot indexerade dokument för {project.propertyDesignation}.
        </p>

        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && performSearch()}
              placeholder="Ex: lakvattenrening, tätskikt sporthall, bullerkrav..."
              className="w-full pl-12 pr-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>
          <button
            onClick={performSearch}
            disabled={loading}
            className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {loading ? 'Söker...' : 'Sök'}
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {results.map((res, idx) => (
          <Card key={idx} className="p-5 border-l-4 border-l-indigo-500">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-bold text-slate-900 underline decoration-slate-200 hover:decoration-indigo-400 cursor-pointer">
                {res.originalName || res.subject}
              </h4>
              <Badge label={`${Math.round(res.score * 100)}% Match`} color="bg-indigo-50 text-indigo-700" />
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge label={res.municipality || 'Okänd Kommun'} />
              <Badge label={res.decisionType || 'Okänd Beslutstyp'} />
            </div>
            <p className="text-sm text-slate-600 italic bg-slate-50 p-3 rounded-xl border border-slate-100">
              "...{res.snippet}..."
            </p>
          </Card>
        ))}
        {!loading && results.length === 0 && query && (
          <div className="text-center py-20 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
            <p className="text-slate-400 font-medium">Inga träffar på "{query}". Prova en bredare sökning.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── SCREEN 3: CLASSIFICATION PANEL ───────────────────────────────────────
const ClassificationPanel: React.FC<{ project: Project }> = ({ project }) => {
  const [data, setData] = useState<Classification | null>(null);
  const [loading, setLoading] = useState(false);

  const runClassification = async () => {
    setLoading(true);
    try {
      const res = await callCore<Classification>('/api/v1/classification', {
        method: 'POST',
        body: { projectId: project.id },
      });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-400">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">AI-Klassificering</h2>
          <p className="text-sm text-slate-500">
            Bestäm verksamhetstyp och risknivå baserat på tidigare prövningar.
          </p>
        </div>
        {!data && (
          <button
            onClick={runClassification}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 bg-teal-600 text-white font-black rounded-2xl hover:bg-teal-700 transition shadow-lg shadow-teal-600/20 disabled:opacity-50"
          >
            <Rocket size={18} /> {loading ? 'Analyserar...' : 'Kör Klassificering'}
          </button>
        )}
      </div>

      {data && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-4">Resultat</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Föreslagen Klass:</span>
                <span className="text-2xl font-black text-teal-600">{data.classification}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Verksamhetskod:</span>
                <Badge label={data.suggestedCode} color="bg-teal-50 text-teal-700 text-sm py-1.5" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Risknivå:</span>
                <Badge
                  label={data.riskLevel}
                  color={
                    data.riskLevel === 'HIGH' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  }
                  className="px-3"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Precision:</span>
                <span className="font-bold text-slate-900">{Math.round(data.confidence * 100)}%</span>
              </div>
            </div>

            {data.missingFields.length > 0 && (
              <div className="mt-8 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <p className="text-xs font-black text-amber-700 uppercase mb-2 flex items-center gap-1">
                  <AlertTriangle size={14} /> Kompletteringsbehov
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.missingFields.map((f) => (
                    <Badge key={f} label={f} color="bg-white text-amber-700 border border-amber-200" />
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6 bg-slate-900 text-white border-none shadow-xl">
            <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-4 flex items-center gap-2">
              <ClipboardCheck size={16} /> Juridisk Evidens
            </h3>
            <div className="space-y-4">
              {data.citations.map((c, i) => (
                <div key={i} className="space-y-2 pb-4 border-b border-slate-800 last:border-0">
                  <p className="text-[10px] font-bold text-teal-400 uppercase tracking-tighter">{c.source}</p>
                  <p className="text-[13px] text-slate-300 leading-relaxed italic">"...{c.snippet}..."</p>
                  {c.municipality && <Badge label={c.municipality} color="bg-slate-800 text-slate-400" />}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ─── SCREEN 4: PERMIT GENERATOR ───────────────────────────────────────────
const PermitGenerator: React.FC<{ project: Project }> = ({ project }) => {
  const [formData, setFormData] = useState({
    businessName: '',
    municipality: project.propertyDesignation.split(' ')[0] || 'Okänd',
    property: project.propertyDesignation,
    ewcCode: '',
    wasteDescription: '',
    volume: '',
    hazardous: false,
    waterHandling: '',
    storageMethod: '',
  });

  useEffect(() => {
    const muni = project.propertyDesignation.split(' ')[0] || '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormData((prev) => ({
      ...prev,
      property: project.propertyDesignation,
      municipality:
        project.coverage.municipality > 0
          ? project.propertyDesignation.split(' ')[0]
          : muni || prev.municipality,
    }));
  }, [project]);

  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await callCore<any>('/api/v1/permit/generate', {
        method: 'POST',
        body: {
          project_data: {
            name: formData.businessName,
            municipality: formData.municipality,
            property_id: formData.property,
            ewc_code: formData.ewcCode,
            volume_tons: Number(formData.volume),
          },
          process_description: formData.wasteDescription,
          water_management: formData.waterHandling,
          storage_safety: formData.storageMethod,
        },
      });
      setResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const downloadDocx = async () => {
    if (!result?.draft_text) return;
    try {
      const blob = await callCore<Blob>('/api/v1/document/export', {
        method: 'POST',
        body: {
          document_type: result.document_type,
          draft_text: result.draft_text,
        },
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Anmälan_C_${formData.property.replace(/ /g, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr] animate-in slide-in-from-bottom-6 duration-500">
      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-xl font-black text-slate-900 mb-4">Underlag C-anmälan</h2>
          <div className="space-y-4">
            {[
              { label: 'Verksamhetsutövare', key: 'businessName' },
              { label: 'Kommun', key: 'municipality' },
              { label: 'Fastighet', key: 'property' },
              { label: 'EWC-kod', key: 'ewcCode' },
              { label: 'Volym (ton)', key: 'volume' },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs font-black text-slate-400 uppercase mb-1 block">{f.label}</label>
                <input
                  type="text"
                  value={(formData as any)[f.key]}
                  onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition"
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-black text-slate-400 uppercase mb-1 block">
                Hantering av vatten
              </label>
              <textarea
                rows={3}
                value={formData.waterHandling}
                onChange={(e) => setFormData({ ...formData, waterHandling: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition"
              />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="w-full mt-6 py-4 bg-slate-900 text-white font-black rounded-2xl hover:bg-black transition shadow-xl disabled:opacity-50"
          >
            {loading ? 'Genererar utkast...' : 'Generera C-anmälan'}
          </button>
        </Card>
      </div>

      <div className="space-y-6">
        {result ? (
          <div className="space-y-6 animate-in fade-in duration-700">
            <header className="flex items-center justify-between">
              <Badge label="Genererat Underlag" color="bg-indigo-600 text-white px-3 py-1.5" />
              <button
                onClick={downloadDocx}
                className="flex items-center gap-2 text-sm font-black text-indigo-600 hover:text-indigo-800 transition"
              >
                <Download size={18} /> Ladda ned .docx
              </button>
            </header>

            <div className="prose prose-slate max-w-none bg-white p-10 rounded-3xl border border-slate-200 shadow-xl font-['Plus_Jakarta_Sans'] text-sm leading-relaxed whitespace-pre-wrap">
              {result.draft_text}
            </div>
          </div>
        ) : (
          <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-10 text-center">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg transform rotate-12 mb-6">
              <FileText className="text-slate-300" size={40} />
            </div>
            <h3 className="text-lg font-bold text-slate-500">Ingen genererad data än</h3>
            <p className="max-w-xs text-sm text-slate-400 mt-2">
              Fyll i formuläret och tryck på kör för att skapa ett anmälningsdokument.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── MAIN INTERFACE WRAPPER ───────────────────────────────────────────────
export const CoreWorkflowView: React.FC = () => {
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [view, setView] = useState<'dashboard' | 'search' | 'analyze' | 'classify' | 'generate'>('dashboard');

  const navItems = [
    { id: 'dashboard', label: 'Projekt', icon: LayoutDashboard },
    { id: 'analyze', label: 'Fastighetsanalys', icon: MapIcon, disabled: !activeProject },
    { id: 'search', label: 'Sök kunskap', icon: Search, disabled: !activeProject },
    { id: 'classify', label: 'AI Klassificering', icon: Rocket, disabled: !activeProject },
    { id: 'generate', label: 'C-anmälan', icon: FileText, disabled: !activeProject },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 font-['Plus_Jakarta_Sans']">
      {/* Tab Navigation */}
      <nav className="shrink-0 flex items-center justify-between px-8 py-4 bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="flex items-center gap-2">
          {activeProject ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                <LayoutDashboard size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
                  Aktivt Projekt
                </p>
                <p className="text-sm font-black text-slate-900 leading-tight">
                  {activeProject.propertyDesignation}
                </p>
              </div>
            </div>
          ) : (
            <h1 className="text-lg font-black text-slate-900 tracking-tight">
              Miljöbeslut.se <span className="text-indigo-600">Pro</span>
            </h1>
          )}
        </div>

        <div className="flex gap-1 bg-slate-100 p-1.5 rounded-2xl">
          {navItems.map((item) => (
            <button
              key={item.id}
              disabled={item.disabled}
              onClick={() => setView(item.id as any)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all ${
                view === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : item.disabled
                    ? 'text-slate-300 cursor-not-allowed'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              <item.icon size={16} /> {item.label}
            </button>
          ))}
          {activeProject && (
            <button
              onClick={() => {
                setActiveProject(null);
                setView('dashboard');
              }}
              className="px-3 py-2.5 text-slate-400 hover:text-red-500 transition-colors"
              title="Avbryt projekt"
            >
              <AlertTriangle size={16} />
            </button>
          )}
        </div>
      </nav>

      {/* View Content */}
      <main className="flex-1 overflow-y-auto w-full px-8 py-8">
        <div
          className={`max-w-7xl mx-auto grid gap-8 ${activeProject ? 'lg:grid-cols-[1fr_320px]' : 'grid-cols-1'}`}
        >
          <div className="space-y-8">
            {view === 'dashboard' && (
              <ProjectDashboard
                onSelect={(p) => {
                  setActiveProject(p);
                  setView('search');
                }}
              />
            )}
            {view === 'search' && activeProject && <DocumentSearch project={activeProject} />}
            {view === 'analyze' && activeProject && (
              <PropertyAnalysisPanel propertyDesignation={activeProject.propertyDesignation} />
            )}
            {view === 'classify' && activeProject && <ClassificationPanel project={activeProject} />}
            {view === 'generate' && activeProject && <PermitGenerator project={activeProject} />}
          </div>

          {activeProject && (
            <aside className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Regulatorisk Insikt
              </div>
              <MunicipalityInsightCard
                key={activeProject.propertyDesignation.split(' ')[0]}
                name={activeProject.propertyDesignation.split(' ')[0]}
              />

              <Card className="p-5 bg-slate-900 text-white border-none">
                <div className="flex items-center gap-3 mb-4">
                  <Activity size={18} className="text-indigo-400" />
                  <h4 className="text-sm font-black">
                    Status i {activeProject.propertyDesignation.split(' ')[0]}
                  </h4>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Ingen verifierad kommunstatus är inläst för projektet.
                </p>
                <Badge label="Saknas" color="bg-slate-700 text-slate-200" className="w-fit" />
              </Card>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
};

export default CoreWorkflowView;
