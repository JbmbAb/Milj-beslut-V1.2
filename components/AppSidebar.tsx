import React from 'react';
import { InterfaceMode, AppBootstrapResponse } from '../types';
import { useOperationsCenter } from './context/OperationsCenterContext';

interface AppSidebarProps {
  mode: InterfaceMode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  setMode: (mode: InterfaceMode | null) => void;
  bootstrap: AppBootstrapResponse | null;
  activeMode: {
    title: string;
    accent: string;
  };
  modeCards: any[];
  openMode: (mode: InterfaceMode) => void;
  setShowUpload: (show: boolean) => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  mode,
  activeTab,
  setActiveTab,
  setMode,
  bootstrap: _bootstrap,
  activeMode: _activeMode,
  modeCards,
  openMode,
  setShowUpload: _setShowUpload,
}) => {
  const primaryModeCards = modeCards;
  const { caseId } = useOperationsCenter();

  return (
    <aside className="w-18 hover:w-64 flex flex-col shrink-0 border-r border-slate-800 bg-slate-950 text-slate-200 transition-all duration-300 ease-in-out group z-20 shadow-2xl overflow-hidden h-screen relative">
      {/* Brand Logo & Label */}
      <div className="h-16 flex items-center px-4 gap-3 border-b border-slate-800 bg-slate-900/50 justify-start shrink-0">
        <div className="w-9 h-9 rounded-xl bg-cyan-600 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
          <i className="fas fa-database text-white text-sm" />
        </div>
        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in-out whitespace-nowrap overflow-hidden">
          <h1 className="text-sm font-black tracking-tight leading-none text-slate-100">
            Mimers<span className="text-cyan-400"> Brunn</span>
          </h1>
          <span className="text-[8px] font-black text-cyan-500 uppercase tracking-widest mt-1">
            Enterprise v2
          </span>
        </div>
      </div>

      {/* Case Switcher Selector */}
      <div className="px-3 py-4 border-b border-slate-800 bg-slate-900/20 shrink-0">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-slate-900 border border-slate-800/80 hover:bg-slate-800/60 cursor-pointer transition-all duration-150">
          <div className="w-6 h-6 rounded-lg bg-cyan-950 border border-cyan-800/40 flex items-center justify-center shrink-0">
            <i className="fas fa-folder-open text-cyan-400 text-xs" />
          </div>
          <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in-out whitespace-nowrap overflow-hidden">
            <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider leading-none">Aktivt Ärende</span>
            <span className="text-[11px] font-bold text-slate-200 mt-1 leading-none">{caseId}</span>
          </div>
        </div>
      </div>

      {/* Scrollable Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto custom-scrollbar overflow-x-hidden">
        {/* Workspaces Group */}
        <div>
          <p className="px-2 pb-2 text-[8px] font-black uppercase tracking-widest text-slate-600 whitespace-nowrap overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            Arbetsytor
          </p>
          <div className="space-y-1">
            {primaryModeCards.map((item) => {
              const isSelected = mode === item.mode;
              return (
                <button
                  key={`module-${item.mode}`}
                  type="button"
                  onClick={() => openMode(item.mode)}
                  title={item.title}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    isSelected
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas ${item.icon} text-sm ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    {item.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation Group */}
        <div>
          <p className="px-2 pb-2 text-[8px] font-black uppercase tracking-widest text-slate-600 whitespace-nowrap overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            Navigering
          </p>
          <div className="space-y-1">
            {/* Summary Link */}
            <button
              type="button"
              onClick={() => setActiveTab('summary')}
              title="Översikt"
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                activeTab === 'summary'
                  ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <i className={`fas fa-house text-sm ${activeTab === 'summary' ? 'text-cyan-400' : 'text-slate-500'}`} />
              </div>
              <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                Översikt
              </span>
            </button>

            {/* Workflow Mode Tabs */}
            {mode === 'Core_WORKFLOW' && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('core')}
                  title="Modulportfölj"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'core'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-rocket text-sm ${activeTab === 'core' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Modulportfölj
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('localization')}
                  title="Lokaliseringsutredning (Scout)"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'localization'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-search-location text-sm ${activeTab === 'localization' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Lokaliseringsutredning
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('sewage-application')}
                  title="Enskilt avlopp (Copilot)"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'sewage-application'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-faucet-drip text-sm ${activeTab === 'sewage-application' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Enskilt avlopp
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('c-notification-mass')}
                  title="C-anmälan massor (Compliance)"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'c-notification-mass'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-file-shield text-sm ${activeTab === 'c-notification-mass' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    C-anmälan massor
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('mimer-search')}
                  title="Mimers AI-Sök (Alphaevolve RAG)"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'mimer-search'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-brain text-sm ${activeTab === 'mimer-search' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Mimers AI-Sök
                  </span>
                </button>
              </>
            )}

            {mode === 'PERMIT_PORTAL' && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('map')}
                  title="Karta & Riskstöd"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'map'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-map-location-dot text-sm ${activeTab === 'map' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Karta & Riskstöd
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('apply')}
                  title="Ansökningsportal"
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    activeTab === 'apply'
                      ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <i className={`fas fa-file-pen text-sm ${activeTab === 'apply' ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Ansökningsportal
                  </span>
                </button>
              </>
            )}

            {/* Legal Support Center Link */}
            <button
              type="button"
              onClick={() => setActiveTab('legal')}
              title="Juridiskt Stöd"
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                activeTab === 'legal'
                  ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 shadow-[inset_0_0_12px_rgba(6,182,212,0.05)]'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <i className={`fas fa-scale-balanced text-sm ${activeTab === 'legal' ? 'text-cyan-400' : 'text-slate-500'}`} />
              </div>
              <span className="text-xs font-bold truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                Juridiskt Stöd
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Sidebar Footer */}
      <div className="p-3 bg-slate-900/50 border-t border-slate-800 shrink-0">
        <div className="flex items-center gap-2 p-1.5 whitespace-nowrap overflow-hidden">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
          <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            System Status: OK
          </span>
        </div>
        
        {/* Toggle Hub Viewport */}
        <button
          onClick={() => setMode(null)}
          type="button"
          className="w-full mt-3 flex items-center justify-center gap-2 p-2 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-300 rounded-xl transition-all duration-100"
          title="Byt Gränssnitt"
        >
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            <i className="fas fa-layer-group text-xs" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
            Byt Gränssnitt
          </span>
        </button>
      </div>
    </aside>
  );
};

