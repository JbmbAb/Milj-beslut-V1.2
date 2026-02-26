
import React, { useState } from 'react';
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

const App: React.FC = () => {
  const [permits] = useState<Permit[]>(MOCK_PERMITS);
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);
  const [mode, setMode] = useState<InterfaceMode | null>(null);
  const [activeTab, setActiveTab] = useState('summary');

  if (!mode) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-['Plus_Jakarta_Sans']">
        <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-3 gap-8">
          <ModeCard 
            title="Logistikmarknad" 
            desc="Analysera 1577 historiska beslut. Hitta leads och marknadstrender."
            icon="fa-chart-mixed"
            color="bg-indigo-600"
            onClick={() => setMode('LOGISTICS_MARKET')}
          />
          <ModeCard 
            title="Prövnings-Portal" 
            desc="Sök miljötillstånd. Tillgång till blanketter och spatial riskanalys."
            icon="fa-file-shield"
            color="bg-emerald-600"
            onClick={() => setMode('PERMIT_PORTAL')}
          />
          <ModeCard 
            title="Projektledare" 
            desc="Hantera projektplanen för VA-utbyggnad. Gantt, risk och budget."
            icon="fa-list-check"
            color="bg-amber-600"
            onClick={() => setMode('PROJECT_MANAGER')}
          />
          <ModeCard 
            title="Grönkoll & Audit" 
            desc="Compliance-score för banker och revisorer. Full spårbarhet."
            icon="fa-shield-check"
            color="bg-slate-700"
            onClick={() => setMode('COMPLIANCE_AUDIT')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex overflow-hidden font-['Plus_Jakarta_Sans'] bg-slate-50`}>
      {/* Sidebar - Dynamic based on Mode */}
      <aside className={`w-72 flex flex-col shrink-0 border-r bg-slate-900 border-slate-800 text-white`}>
        <div className="h-24 flex items-center px-8 gap-4 border-b border-slate-800">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl font-black shadow-lg ${
            mode === 'LOGISTICS_MARKET' ? 'bg-indigo-600' : mode === 'PERMIT_PORTAL' ? 'bg-emerald-600' : mode === 'PROJECT_MANAGER' ? 'bg-amber-600' : 'bg-slate-700'
          }`}>
            {mode[0]}{mode.split('_')[1]?.[0] || mode[1]}
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight leading-none italic">
              RiskGuard<span className="text-blue-500">.ai</span>
            </h1>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">
              {mode === 'LOGISTICS_MARKET' ? 'Logistikmarknad' : mode.replace('_', ' ')}
            </p>
          </div>
        </div>

        <nav className="flex-1 p-6 space-y-2">
          <SidebarLink active={activeTab === 'summary'} icon="fa-house" label="Dashboard" onClick={() => setActiveTab('summary')} />
          <SidebarLink active={activeTab === 'guide'} icon="fa-book-open" label="Användarstöd" onClick={() => setActiveTab('guide')} />
          <SidebarLink active={activeTab === 'integrations'} icon="fa-network-wired" label="API & Lager" onClick={() => setActiveTab('integrations')} />
          
          {mode === 'LOGISTICS_MARKET' && (
            <>
              <SidebarLink active={activeTab === 'archive'} icon="fa-box-archive" label="Beslutsarkiv" onClick={() => setActiveTab('archive')} />
              <SidebarLink active={activeTab === 'logistics'} icon="fa-truck-ramp-box" label="Logistik & Massor" onClick={() => setActiveTab('logistics')} />
              <SidebarLink active={activeTab === 'triage'} icon="fa-microscope" label="Resurs-Triage" onClick={() => setActiveTab('triage')} />
            </>
          )}

          {mode === 'PERMIT_PORTAL' && (
            <>
              <SidebarLink active={activeTab === 'apply'} icon="fa-pen-to-square" label="Ny Ansökan" onClick={() => setActiveTab('apply')} />
              <SidebarLink active={activeTab === 'forms'} icon="fa-file-invoice" label="Blankett-motor" onClick={() => setActiveTab('forms')} />
              <SidebarLink active={activeTab === 'biodiversity'} icon="fa-bugs" label="Bio-Inventering" onClick={() => setActiveTab('biodiversity')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-shield-virus" label="Risk-Analys (GIS)" onClick={() => setActiveTab('risks')} />
              <SidebarLink active={activeTab === 'map'} icon="fa-map-location-dot" label="Kartutforskaren" onClick={() => setActiveTab('map')} />
            </>
          )}

          {mode === 'PROJECT_MANAGER' && (
            <>
              <SidebarLink active={activeTab === 'plan'} icon="fa-scroll" label="Projektplan" onClick={() => setActiveTab('plan')} />
              <SidebarLink active={activeTab === 'timeline'} icon="fa-calendar-range" label="Tidplan / Gantt" onClick={() => setActiveTab('timeline')} />
              <SidebarLink active={activeTab === 'field'} icon="fa-camera-retro" label="Fältstöd (AI)" onClick={() => setActiveTab('field')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-triangle-exclamation" label="Riskhantering" onClick={() => setActiveTab('risks')} />
            </>
          )}

          {mode === 'COMPLIANCE_AUDIT' && (
            <>
              <SidebarLink active={activeTab === 'score'} icon="fa-gauge-high" label="Compliance Score" onClick={() => setActiveTab('score')} />
              <SidebarLink active={activeTab === 'audit'} icon="fa-list-check" label="Revisionslogg" onClick={() => setActiveTab('audit')} />
              <SidebarLink active={activeTab === 'reports'} icon="fa-file-chart-column" label="Långivarerapport" onClick={() => setActiveTab('reports')} />
            </>
          )}
        </nav>

        <div className="p-6 border-t border-slate-800">
          <button 
            onClick={() => setMode(null)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <i className="fas fa-right-left"></i> Byt Gränssnitt
          </button>
        </div>
      </aside>

      {/* Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-20 border-b flex items-center justify-between px-10 shrink-0 bg-white z-10 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-3">
             <span className={`w-2 h-2 rounded-full ${
               mode === 'LOGISTICS_MARKET' ? 'bg-indigo-500' : mode === 'PERMIT_PORTAL' ? 'bg-emerald-500' : 'bg-amber-500'
             }`}></span>
             {activeTab}
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
               SYSTEM VERSION 5.0.0
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          {activeTab === 'summary' && <ExecutiveSummary />}
          {activeTab === 'guide' && <Guide />}
          {activeTab === 'integrations' && <IntegrationsDashboard />}
          
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
              {activeTab === 'apply' && <ApplicationWizard />}
            </>
          )}

          {mode === 'PROJECT_MANAGER' && activeTab === 'field' && <FieldAssistant />}

          {mode === 'PROJECT_MANAGER' && activeTab !== 'summary' && activeTab !== 'integrations' && activeTab !== 'guide' && activeTab !== 'field' && (
            <ProjectManagerView activeTab={activeTab} />
          )}

          {mode === 'COMPLIANCE_AUDIT' && activeTab !== 'summary' && activeTab !== 'integrations' && activeTab !== 'guide' && (
            <ExecutiveSummary mode={activeTab} />
          )}
        </div>
        <ChatBot />
      </main>

      {selectedPermit && <DetailModal permit={selectedPermit} onClose={() => setSelectedPermit(null)} />}
    </div>
  );
};

const ModeCard: React.FC<{ title: string; desc: string; icon: string; color: string; onClick: () => void }> = ({ title, desc, icon, color, onClick }) => (
  <button 
    onClick={onClick}
    className="bg-slate-900 border border-slate-800 p-10 rounded-[3rem] text-left hover:border-blue-500 hover:bg-slate-900/80 transition-all group hover:scale-[1.02]"
  >
    <div className={`${color} w-16 h-16 rounded-2xl flex items-center justify-center text-white text-3xl mb-8 shadow-2xl group-hover:rotate-6 transition-transform`}>
      <i className={`fas ${icon}`}></i>
    </div>
    <h3 className="text-2xl font-black text-white mb-4 tracking-tight uppercase italic">{title}</h3>
    <p className="text-slate-400 font-medium leading-relaxed">{desc}</p>
    <div className="mt-8 flex items-center gap-2 text-xs font-black text-blue-400 uppercase tracking-widest">
      Öppna Vy <i className="fas fa-arrow-right group-hover:translate-x-2 transition-transform"></i>
    </div>
  </button>
);

const SidebarLink: React.FC<{ active: boolean; icon: string; label: string; onClick: () => void }> = ({ active, icon, label, onClick }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-200 group ${
      active ? 'bg-white/10 text-white shadow-xl' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
    }`}
  >
    <i className={`fas ${icon} w-6 text-center text-lg ${active ? 'text-blue-400' : 'group-hover:text-blue-400'}`}></i>
    <span className="text-sm font-bold tracking-tight">{label}</span>
  </button>
);

export default App;
