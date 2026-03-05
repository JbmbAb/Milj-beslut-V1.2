import React, { useMemo, useState } from 'react';
import { Permit, InterfaceMode } from '../types';
import { MOCK_PERMITS } from '../constants';
import MarketIntelView from './MarketIntelView';
import PermitPortalView from './PermitPortalView';
import ProjectManagerView from './ProjectManagerView';
import ExecutiveSummary from './ExecutiveSummary';
import DetailModal from './DetailModal';
import ChatBot from './ChatBot';
import FormManager from './FormManager';
import SluExpert from './SluExpert';
import IntegrationsDashboard from './IntegrationsDashboard';
import ApplicationWizard from './ApplicationWizard';
import AssetTriage from './AssetTriage';
import FieldAssistant from './FieldAssistant';
import Guide from './Guide';
import GisRiskModule from './GisRiskModule';
import AdminSearchConsole from './AdminSearchConsole';
import LegalSupportCenter from './LegalSupportCenter';
import { useProjectStructure } from './ProjectStructureContext';
import { countReadyModules } from '../services/projectStructure';

type ModeCardConfig = {
  mode: InterfaceMode;
  title: string;
  description: string;
  icon: string;
  accent: string;
  defaultTab: string;
};

const MODE_CARDS: ModeCardConfig[] = [
  {
    mode: 'LOGISTICS_MARKET',
    title: 'Logistik schaktmassor',
    description: 'Planera mottagning, transport och regelefterlevnad för masshantering.',
    icon: 'fa-chart-mixed',
    accent: 'bg-indigo-600',
    defaultTab: 'archive',
  },
  {
    mode: 'PERMIT_PORTAL',
    title: 'Provningsportal',
    description: 'Sök tillstånd, bygg ansökan och validera regelkrav.',
    icon: 'fa-file-shield',
    accent: 'bg-emerald-600',
    defaultTab: 'map',
  },
  {
    mode: 'PROJECT_MANAGER',
    title: 'Projektledning',
    description: 'Planera tid, resurser, risk och uppföljning i en vy.',
    icon: 'fa-list-check',
    accent: 'bg-amber-600',
    defaultTab: 'plan',
  },
  {
    mode: 'COMPLIANCE_AUDIT',
    title: 'Grönkoll och revision',
    description: 'Compliance-score, revision och banknära rapportering.',
    icon: 'fa-shield-check',
    accent: 'bg-slate-700',
    defaultTab: 'score',
  },
  {
    mode: 'ADMIN_CONSOLE',
    title: 'Administrator',
    description: 'Separat adminyta med utökad sökning och analys.',
    icon: 'fa-user-shield',
    accent: 'bg-rose-600',
    defaultTab: 'admin-search',
  },
];

const App: React.FC = () => {
  const { plan } = useProjectStructure();
  const [permits] = useState<Permit[]>(MOCK_PERMITS);
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);
  const [mode, setMode] = useState<InterfaceMode | null>(null);
  const [activeTab, setActiveTab] = useState('summary');

  const readyModuleCount = useMemo(() => countReadyModules(plan), [plan]);
  const blockedModuleCount = useMemo(
    () => plan.moduleIntegrations.filter((item) => item.readiness === 'BLOCKED').length,
    [plan]
  );
  const requiredGateCount = useMemo(
    () => plan.stageGates.filter((gate) => gate.required).length,
    [plan]
  );
  const passedGateCount = useMemo(
    () => plan.stageGates.filter((gate) => gate.required && gate.status === 'PASSED').length,
    [plan]
  );
  const carbonReady = Boolean(plan.carbonSummary.lastResult);

  const modeCardMap = useMemo(() => {
    return MODE_CARDS.reduce<Record<InterfaceMode, ModeCardConfig>>((acc, item) => {
      acc[item.mode] = item;
      return acc;
    }, {} as Record<InterfaceMode, ModeCardConfig>);
  }, []);

  const openMode = (nextMode: InterfaceMode) => {
    setMode(nextMode);
    setActiveTab(modeCardMap[nextMode].defaultTab);
  };

  if (!mode) {
    return (
      <div className="min-h-screen bg-slate-950 text-white font-['Plus_Jakarta_Sans']">
        <div className="mx-auto max-w-7xl px-6 py-8 md:py-12">
          <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-base font-black text-white shadow-lg">
                M
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Miljöbeslut.se 2.0</p>
                <p className="text-sm font-semibold text-slate-200">Det är lätt att göra rätt</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openMode('PERMIT_PORTAL')}
                data-testid="landing-open-permit"
                className="rounded-xl px-4 py-2 text-sm font-black text-white"
                style={{ backgroundColor: 'var(--color-primary-500)' }}
              >
                Starta ansökan
              </button>
              <button
                type="button"
                onClick={() => openMode('LOGISTICS_MARKET')}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-black text-slate-200"
              >
                Planera logistik
              </button>
              <button
                type="button"
                onClick={() => openMode('ADMIN_CONSOLE')}
                data-testid="landing-open-admin"
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-black text-slate-200"
              >
                Admin
              </button>
            </div>
          </header>

          <section className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 md:p-8">
              <p className="text-[11px] uppercase tracking-[0.18em] text-indigo-300">Human in the Loop</p>
              <h1 className="mt-3 text-3xl font-black leading-tight md:text-5xl">
                Automatiserad precision. Mänskligt ansvar.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
                Vi kombinerar AI-driven analys av 1500 lagtexter med verifierade "hårda fakta" från myndighets-API:er. 
                Systemet förbereder – du beslutar och signerar.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => openMode('PERMIT_PORTAL')}
                  className="rounded-xl px-5 py-3 text-sm font-black text-white"
                  style={{ backgroundColor: 'var(--color-primary-500)' }}
                >
                  Skapa ny ansökan
                </button>
                <button
                  type="button"
                  onClick={() => openMode('LOGISTICS_MARKET')}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-black text-slate-200"
                >
                  Kontrollera massor och mottagare
                </button>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <TrustPill label="Kommuner" />
                <TrustPill label="Entreprenorer" />
                <TrustPill label="Miljökonsulter" />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Snabbstart på 3 steg</p>
              <ol className="mt-4 space-y-4 text-sm">
                <li className="rounded-xl border border-slate-700 bg-slate-800/80 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-300">Steg 1</p>
                  <p className="mt-1 font-semibold text-slate-100">Välj fastighet och projekt</p>
                  <p className="mt-1 text-slate-400">Systemet laddar relevanta data direkt i arbetsvyn.</p>
                </li>
                <li className="rounded-xl border border-slate-700 bg-slate-800/80 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-300">Steg 2</p>
                  <p className="mt-1 font-semibold text-slate-100">Bygg underlag med filter och kontroller</p>
                  <p className="mt-1 text-slate-400">Fokusera pa beslut, status och spårbar dokumentation.</p>
                </li>
                <li className="rounded-xl border border-slate-700 bg-slate-800/80 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-300">Steg 3</p>
                  <p className="mt-1 font-semibold text-slate-100">Folj upp i projektledning och audit</p>
                  <p className="mt-1 text-slate-400">Samma data finns tillgänglig i hela flödet.</p>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => openMode('PROJECT_MANAGER')}
                className="mt-5 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-200"
              >
                Öppna projektledning
              </button>
            </div>
          </section>

          <section className="mt-8 grid gap-4 md:grid-cols-3">
            <QuickStartCard
              title="Ny ansökan"
              text="För handläggare som vill gå från fastighet till underlag snabbt."
              buttonLabel="Till provningsportal"
              onClick={() => openMode('PERMIT_PORTAL')}
              accent="bg-emerald-600"
              icon="fa-file-pen"
            />
            <QuickStartCard
              title="Logistik och massor"
              text="Kontrollera mottagare, transportkedja och compliance innan bokning."
              buttonLabel="Till logistik"
              onClick={() => openMode('LOGISTICS_MARKET')}
              accent="bg-indigo-600"
              icon="fa-truck-ramp-box"
            />
            <QuickStartCard
              title="Status och risk"
              text="Följ stage gates, blockers och granskning i samma vy."
              buttonLabel="Till projektledning"
              onClick={() => openMode('PROJECT_MANAGER')}
              accent="bg-amber-600"
              icon="fa-list-check"
            />
          </section>

          <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Lägesbild</p>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <MetricTile label="Aktiva ärenden" value="1,577" />
              <MetricTile label="Verifierade dokument" value="12,430" />
              <MetricTile label="Compliance score" value="92%" />
              <MetricTile label="Genomsnittlig ledtid" value="18 dagar" />
            </div>
          </section>

          <section id="how-it-works" className="mt-8 grid gap-4 md:grid-cols-3">
            <HowStep number="1" title="Koppla datakällor" text="Importera beslut, kartlager och externa API-flöden." />
            <HowStep number="2" title="Bygg beslutunderlag" text="Använd guider, filter och kontrollpunkter för kvalitet." />
            <HowStep number="3" title="Leverera och följ upp" text="Rapportering till intressenter med spårbar revision." />
          </section>

          <section id="modes" className="mt-8">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <h3 className="text-xl font-black md:text-2xl">Välj arbetsläge</h3>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Bästa startpunkt för olika roller</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {MODE_CARDS.slice(0, 4).map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => openMode(item.mode)}
                  className="group rounded-3xl border border-slate-800 bg-slate-900 p-5 text-left transition hover:border-slate-600"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-white ${item.accent}`}>
                      <i className={`fas ${item.icon}`} />
                    </span>
                    <p className="text-lg font-black">{item.title}</p>
                  </div>
                  <p className="text-sm text-slate-300">{item.description}</p>
                  <p className="mt-4 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-300 group-hover:text-indigo-200">
                    Öppna vy
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 md:flex md:items-center md:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">För förvaltning och support</p>
                <p className="mt-1 text-sm text-slate-200">Behörig personal kan öppna adminyta för status, index och systemkontroll.</p>
              </div>
              <button
                type="button"
                onClick={() => openMode('ADMIN_CONSOLE')}
                className="mt-3 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-black text-slate-200 md:mt-0"
              >
                Öppna admin
              </button>
            </div>
          </section>

          <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6 md:flex md:items-center md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Kom igång direkt</p>
              <h4 className="mt-2 text-2xl font-black">Vill du skapa första ärendet nu?</h4>
              <p className="mt-2 text-sm text-slate-300">
                Starta i prövningsportalen och lägg till logistik eller projektledning när behovet finns.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openMode('PERMIT_PORTAL')}
              className="mt-4 rounded-xl px-4 py-2 text-sm font-black text-white md:mt-0"
              style={{ backgroundColor: 'var(--color-primary-500)' }}
            >
              Starta portal
            </button>
          </section>
        </div>
      </div>
    );
  }

  const activeMode = modeCardMap[mode];

  return (
    <div className="min-h-screen flex overflow-hidden font-['Plus_Jakarta_Sans'] bg-slate-50">
      <aside className="w-[250px] flex flex-col shrink-0 border-r border-[#243148] bg-[#1c212e] text-white">
        <div className="h-24 flex items-center px-6 gap-4 border-b border-[#243148]">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl font-black shadow-lg ${activeMode.accent}`}>
            {mode[0]}{mode.split('_')[1]?.[0] || mode[1]}
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight leading-none italic">
              Miljöbeslut.se 2.0
            </h1>
            <p className="text-[9px] font-bold text-[#8ea0bf] uppercase tracking-widest mt-1">
              {activeMode.title}
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto custom-scrollbar">
          <p className="px-[10px] pb-1 text-[12px] font-semibold text-[#91a3c4]">Moduler</p>

          {MODE_CARDS.map((item) => (
            <button
              key={`module-${item.mode}`}
              type="button"
              onClick={() => openMode(item.mode)}
              className={`w-[226px] h-[35px] flex items-center gap-[10px] px-[10px] rounded-[10px] text-left transition ${
                mode === item.mode ? 'bg-[#29334a]' : 'bg-[#1f2633] hover:bg-[#273042]'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${mode === item.mode ? 'bg-[#1d77ff]' : 'bg-[#6f86a5]'}`} />
              <span className="text-[12px] font-semibold text-[#e0ebf7] truncate">{item.title}</span>
            </button>
          ))}

          <div className="pt-1 pb-3">
            <span className="inline-flex rounded-full bg-[#1a382e] px-[10px] py-[6px] text-[11px] font-semibold text-[#bff2d6]">
              API: Connected
            </span>
          </div>

          <p className="px-[10px] pt-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7086a4]">Sections</p>
          <SidebarLink active={activeTab === 'summary'} icon="fa-house" label="Dashboard" onClick={() => setActiveTab('summary')} />
          <SidebarLink active={activeTab === 'guide'} icon="fa-book-open" label="Användarstöd" onClick={() => setActiveTab('guide')} />
          <SidebarLink active={activeTab === 'integrations'} icon="fa-network-wired" label="API och lager" onClick={() => setActiveTab('integrations')} />
          <SidebarLink active={activeTab === 'legal'} icon="fa-scale-balanced" label="Juridik och GDPR" onClick={() => setActiveTab('legal')} />

          {mode === 'LOGISTICS_MARKET' && (
            <>
              <SidebarLink active={activeTab === 'archive'} icon="fa-box-archive" label="Beslutsarkiv" onClick={() => setActiveTab('archive')} />
              <SidebarLink active={activeTab === 'logistics'} icon="fa-truck-ramp-box" label="Logistik och massor" onClick={() => setActiveTab('logistics')} />
              <SidebarLink active={activeTab === 'triage'} icon="fa-microscope" label="Resurs-triage" onClick={() => setActiveTab('triage')} />
            </>
          )}

          {mode === 'PERMIT_PORTAL' && (
            <>
              <SidebarLink active={activeTab === 'apply'} icon="fa-pen-to-square" label="Ny ansökan" onClick={() => setActiveTab('apply')} />
              <SidebarLink active={activeTab === 'forms'} icon="fa-file-invoice" label="Blankettmotor" onClick={() => setActiveTab('forms')} />
              <SidebarLink active={activeTab === 'biodiversity'} icon="fa-bugs" label="Bioinventering" onClick={() => setActiveTab('biodiversity')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-shield-virus" label="Riskanalys (GIS)" onClick={() => setActiveTab('risks')} />
              <SidebarLink active={activeTab === 'map'} icon="fa-map-location-dot" label="Kartutforskare" onClick={() => setActiveTab('map')} />
            </>
          )}

          {mode === 'PROJECT_MANAGER' && (
            <>
              <SidebarLink active={activeTab === 'plan'} icon="fa-scroll" label="Projektplan" onClick={() => setActiveTab('plan')} />
              <SidebarLink active={activeTab === 'timeline'} icon="fa-calendar-range" label="Tidplan och Gantt" onClick={() => setActiveTab('timeline')} />
              <SidebarLink active={activeTab === 'field'} icon="fa-camera-retro" label="Fältstöd (AI)" onClick={() => setActiveTab('field')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-triangle-exclamation" label="Riskhantering" onClick={() => setActiveTab('risks')} />
            </>
          )}

          {mode === 'COMPLIANCE_AUDIT' && (
            <>
              <SidebarLink active={activeTab === 'score'} icon="fa-gauge-high" label="Compliance score" onClick={() => setActiveTab('score')} />
              <SidebarLink active={activeTab === 'audit'} icon="fa-list-check" label="Revisionslogg" onClick={() => setActiveTab('audit')} />
              <SidebarLink active={activeTab === 'reports'} icon="fa-file-chart-column" label="Långivarrapport" onClick={() => setActiveTab('reports')} />
            </>
          )}

          {mode === 'ADMIN_CONSOLE' && (
            <>
              <SidebarLink active={activeTab === 'admin-search'} icon="fa-magnifying-glass-chart" label="Admin sökcenter" onClick={() => setActiveTab('admin-search')} />
              <SidebarLink active={activeTab === 'admin-insight'} icon="fa-shield-check" label="Analys och compliance" onClick={() => setActiveTab('admin-insight')} />
            </>
          )}
        </nav>

        <div className="p-4 border-t border-[#243148]">
          <button
            onClick={() => setMode(null)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#1f2633] text-[#a6b4cb] rounded-[10px] text-[10px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <i className="fas fa-right-left" /> Byt gränssnitt
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-20 border-b flex items-center justify-between px-10 shrink-0 bg-white z-10 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${activeMode.accent}`} />
            {activeTab}
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              MODULER REDO {readyModuleCount}/{plan.moduleIntegrations.length}
            </span>
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              BLOCKER {blockedModuleCount}
            </span>
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              GATES {passedGateCount}/{requiredGateCount}
            </span>
            <span className={`text-[10px] font-black px-3 py-1.5 rounded-full border ${carbonReady ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              CO2 {carbonReady ? 'READY' : 'MISSING'}
            </span>
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
              SYSTEM VERSION 5.0.0
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar">
          {activeTab === 'summary' && <ExecutiveSummary />}
          {activeTab === 'guide' && <Guide mode={mode} onNavigate={setActiveTab} />}
          {activeTab === 'integrations' && <IntegrationsDashboard />}
          {activeTab === 'legal' && <LegalSupportCenter />}

          {mode === 'LOGISTICS_MARKET' && (
            <>
              {activeTab === 'archive' && <MarketIntelView permits={permits} onSelectPermit={setSelectedPermit} />}
              {activeTab === 'logistics' && <MarketIntelView mode="logistics" permits={permits} onSelectPermit={setSelectedPermit} />}
              {activeTab === 'triage' && <AssetTriage />}
            </>
          )}

          {mode === 'PERMIT_PORTAL' && (
            <>
              {activeTab === 'forms' && <FormManager />}
              {activeTab === 'biodiversity' && <SluExpert />}
              {activeTab === 'risks' && <GisRiskModule />}
              {activeTab === 'map' && <PermitPortalView permits={permits} />}
              {activeTab === 'apply' && (
                <div className="space-y-8">
                  <PermitPortalView permits={permits} mode="apply" />
                  <ApplicationWizard />
                </div>
              )}
            </>
          )}

          {mode === 'PROJECT_MANAGER' && activeTab === 'field' && <FieldAssistant />}

          {mode === 'PROJECT_MANAGER' && activeTab !== 'summary' && activeTab !== 'integrations' && activeTab !== 'guide' && activeTab !== 'field' && (
            <ProjectManagerView activeTab={activeTab} />
          )}

          {mode === 'COMPLIANCE_AUDIT' && activeTab !== 'summary' && activeTab !== 'integrations' && activeTab !== 'guide' && (
            <ExecutiveSummary mode={activeTab} />
          )}

          {mode === 'ADMIN_CONSOLE' && activeTab !== 'summary' && activeTab !== 'integrations' && activeTab !== 'guide' && (
            <AdminSearchConsole panel={activeTab === 'admin-insight' ? 'insight' : 'search'} />
          )}
        </div>
        <ChatBot />
      </main>

      {selectedPermit && <DetailModal permit={selectedPermit} onClose={() => setSelectedPermit(null)} />}
    </div>
  );
};

const MetricTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-black">{label}</p>
    <p className="mt-1 text-xl font-black">{value}</p>
  </div>
);

const TrustPill: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">{label}</div>
);

const HowStep: React.FC<{ number: string; title: string; text: string }> = ({ number, title, text }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-300">Steg {number}</p>
    <h5 className="mt-2 text-lg font-black">{title}</h5>
    <p className="mt-2 text-sm text-slate-300">{text}</p>
  </div>
);

const QuickStartCard: React.FC<{
  title: string;
  text: string;
  buttonLabel: string;
  onClick: () => void;
  accent: string;
  icon: string;
}> = ({ title, text, buttonLabel, onClick, accent, icon }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex items-center gap-3">
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-white ${accent}`}>
        <i className={`fas ${icon}`} />
      </span>
      <p className="text-base font-black">{title}</p>
    </div>
    <p className="mt-3 text-sm text-slate-300">{text}</p>
    <button
      type="button"
      onClick={onClick}
      className="mt-4 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-200"
    >
      {buttonLabel}
    </button>
  </div>
);

const SidebarLink: React.FC<{ active: boolean; icon: string; label: string; onClick: () => void }> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    title={icon}
    className={`w-[226px] h-[35px] flex items-center gap-[10px] px-[10px] rounded-[10px] transition-all duration-200 text-left ${
      active ? 'bg-[#29334a] text-[#e0ebf7]' : 'bg-[#1f2633] text-[#e0ebf7] hover:bg-[#273042]'
    }`}
  >
    <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#1d77ff]' : 'bg-[#6f86a5]'}`} />
    <span className="text-[12px] font-semibold tracking-tight truncate">{label}</span>
  </button>
);

export default App;
