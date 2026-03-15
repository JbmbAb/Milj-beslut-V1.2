import React, { useMemo, useState } from 'react';
import { Permit, InterfaceMode } from '../types';
import { MOCK_PERMITS } from '../constants';
import MarketIntelView from './MarketIntelView';
import PermitPortalView from './PermitPortalView';
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
import LegalSupportCenter from './LegalSupportCenter';
import MvpDemoInterface from './MvpDemoInterface';
import AdminMetadataReview from './AdminMetadataReview';
import PropertyRegisterExtract from './PropertyRegisterExtract';
import { useProjectStructure } from './ProjectStructureContext';
import { countReadyModules } from '../services/projectStructure';
import { TechnicalDashboardHub } from './TechnicalDashboardHub';

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
    title: 'Egenkontroll och revision',
    description: 'Bedömning av regelefterlevnad, revisionslogg och automatiserad rapportering.',
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
  {
    mode: 'MVP_WORKFLOW',
    title: 'Ärendeportal',
    description: 'Beslutsstöd för miljöärenden: Dashboard → Sök → Granskning → Anmälan.',
    icon: 'fa-folder-open',
    accent: 'bg-indigo-600',
    defaultTab: 'mvp',
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

  const renderContent = () => {
    switch (mode) {
      case 'MVP_WORKFLOW':
        return <MvpDemoInterface />;
      case 'LOGISTICS_MARKET':
        if (activeTab === 'archive') return <ExecutiveSummary />;
        if (activeTab === 'logistics') return <MarketIntelView permits={permits} onSelectPermit={setSelectedPermit} mode="logistics" />;
        if (activeTab === 'triage') return <AssetTriage />;
        return <ExecutiveSummary />;
      case 'PERMIT_PORTAL':
        if (activeTab === 'map') return <PermitPortalView permits={permits} mode="map" />;
        if (activeTab === 'apply') return <PermitPortalView permits={permits} mode="apply" />;
        if (activeTab === 'forms') return <FormManager />;
        if (activeTab === 'risks') return <GisRiskModule />;
        return <PermitPortalView permits={permits} mode="map" />;
      case 'PROJECT_MANAGER':
        if (activeTab === 'plan') return <ApplicationWizard />;
        if (activeTab === 'field') return <FieldAssistant />;
        return <ApplicationWizard />;
      case 'COMPLIANCE_AUDIT':
        if (activeTab === 'score') return <GisRiskModule />;
        return <IntegrationsDashboard />;
      case 'ADMIN_CONSOLE':
        if (activeTab === 'admin-review') return <AdminMetadataReview />;
        if (activeTab === 'admin-search') return <PropertyRegisterExtract propertyId={selectedPermit?.property_id || "ORSA STACKMORA 3:12"} />;
        return <AdminMetadataReview />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <i className="fas fa-layer-group text-4xl mb-4 opacity-20" />
            <p className="text-sm font-bold uppercase tracking-widest">Välj en sektion i menyn</p>
          </div>
        );
    }
  };

  if (!mode) {
    return (
      <TechnicalDashboardHub
        onSelectModule={(id) => {
          if (id === 'mvp' || id === 'ansokan') openMode('MVP_WORKFLOW');
          else if (id === 'logistik') openMode('LOGISTICS_MARKET');
          else if (id === 'projekt') openMode('PROJECT_MANAGER');
          else if (id === 'gronkoll') openMode('COMPLIANCE_AUDIT');
        }}
        user={{ name: "System User" }}
      />
    );
  }

  const activeMode = modeCardMap[mode];

  return (
    <div className="min-h-screen flex overflow-hidden font-['Plus_Jakarta_Sans'] bg-slate-50">
      <aside className="w-[250px] flex flex-col shrink-0 border-r border-[#243148] bg-[#1c212e] text-white">
        <div className="h-24 flex flex-col justify-center px-6 gap-2 border-b border-[#243148]">
          <img src="/logo.png" alt="Miljöbeslut.se Logo" className="h-8 w-auto object-contain self-start" />
          <p className="text-[9px] font-bold text-[#8ea0bf] uppercase tracking-widest">
            {activeMode.title}
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto custom-scrollbar">
          <p className="px-[10px] pb-1 text-[12px] font-semibold text-[#91a3c4]">Moduler</p>

          {MODE_CARDS.map((item) => (
            <button
              key={`module-${item.mode}`}
              type="button"
              onClick={() => openMode(item.mode)}
              className={`w-[226px] h-[35px] flex items-center gap-[10px] px-[10px] rounded-[10px] text-left transition ${mode === item.mode ? 'bg-[#29334a]' : 'bg-[#1f2633] hover:bg-[#273042]'
                }`}
            >
              <span className={`h-2 w-2 rounded-full ${mode === item.mode ? 'bg-[#1d77ff]' : 'bg-[#6f86a5]'}`} />
              <span className="text-[12px] font-semibold text-[#e0ebf7] truncate">{item.title}</span>
            </button>
          ))}

          <div className="pt-1 pb-3">
            <span className="inline-flex rounded-full bg-[#1a382e] px-[10px] py-[6px] text-[11px] font-semibold text-[#bff2d6]">
              API: Ansluten
            </span>
          </div>

          <p className="px-[10px] pt-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7086a4]">Avsnitt</p>
          <SidebarLink active={activeTab === 'summary'} icon="fa-house" label="Startsida" onClick={() => setActiveTab('summary')} />
          {mode !== 'MVP_WORKFLOW' && (
            <>
              <SidebarLink active={activeTab === 'summary'} icon="fa-chart-pie" label="Beslutsöversikt" onClick={() => setActiveTab('summary')} />
              <SidebarLink active={activeTab === 'integrations'} icon="fa-database" label="Tjänsteintegreringar" onClick={() => setActiveTab('integrations')} />
              <SidebarLink active={activeTab === 'guide'} icon="fa-book-open" label="Manualer & Support" onClick={() => setActiveTab('guide')} />
              <SidebarLink active={activeTab === 'legal'} icon="fa-scale-balanced" label="Rättsligt stöd" onClick={() => setActiveTab('legal')} />
            </>
          )}

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
              <SidebarLink active={activeTab === 'risks'} icon="fa-shield-virus" label="Fastighetsanalys" onClick={() => setActiveTab('risks')} />
              <SidebarLink active={activeTab === 'map'} icon="fa-map-location-dot" label="Kartutforskare" onClick={() => setActiveTab('map')} />
            </>
          )}

          {mode === 'PROJECT_MANAGER' && (
            <>
              <SidebarLink active={activeTab === 'plan'} icon="fa-scroll" label="Projektplan" onClick={() => setActiveTab('plan')} />
              <SidebarLink active={activeTab === 'timeline'} icon="fa-calendar-range" label="Tidplan och Gantt" onClick={() => setActiveTab('timeline')} />
              <SidebarLink active={activeTab === 'field'} icon="fa-camera-retro" label="Fältdokumentation" onClick={() => setActiveTab('field')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-triangle-exclamation" label="Riskhantering" onClick={() => setActiveTab('risks')} />
            </>
          )}

          {mode === 'COMPLIANCE_AUDIT' && (
            <>
              <SidebarLink active={activeTab === 'score'} icon="fa-gauge-high" label="Regelefterlevnad" onClick={() => setActiveTab('score')} />
              <SidebarLink active={activeTab === 'audit'} icon="fa-list-check" label="Revisionslogg" onClick={() => setActiveTab('audit')} />
              <SidebarLink active={activeTab === 'reports'} icon="fa-file-chart-column" label="Långivarrapport" onClick={() => setActiveTab('reports')} />
            </>
          )}

          {mode === 'ADMIN_CONSOLE' && (
            <>
              <SidebarLink active={activeTab === 'admin-search'} icon="fa-magnifying-glass-chart" label="Admin sökcenter" onClick={() => setActiveTab('admin-search')} />
              <SidebarLink active={activeTab === 'admin-review'} icon="fa-clipboard-check" label="Kvalitetssäkring" onClick={() => setActiveTab('admin-review')} />
              <SidebarLink active={activeTab === 'admin-insight'} icon="fa-shield-check" label="Analys och compliance" onClick={() => setActiveTab('admin-insight')} />
            </>
          )}

          {mode === 'MVP_WORKFLOW' && (
            <SidebarLink active={activeTab === 'mvp'} icon="fa-rocket" label="Ansökningsflöde" onClick={() => setActiveTab('mvp')} />
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
              CO2 {carbonReady ? 'REDO' : 'SAKNAS'}
            </span>
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 border-slate-200">
              SYSTEM VERSION 5.0.0
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar relative">
          {renderContent()}
        </div>
        <ChatBot />
      </main>

      {selectedPermit && <DetailModal permit={selectedPermit} onClose={() => setSelectedPermit(null)} />}
    </div>
  );
};

const SidebarLink: React.FC<{ active: boolean; icon: string; label: string; onClick: () => void }> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    title={icon}
    className={`w-[226px] h-[35px] flex items-center gap-[10px] px-[10px] rounded-[10px] transition-all duration-200 text-left ${active ? 'bg-[#29334a] text-[#e0ebf7]' : 'bg-[#1f2633] text-[#e0ebf7] hover:bg-[#273042]'
      }`}
  >
    <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#1d77ff]' : 'bg-[#6f86a5]'}`} />
    <span className="text-[12px] font-semibold tracking-tight truncate">{label}</span>
  </button>
);

export default App;