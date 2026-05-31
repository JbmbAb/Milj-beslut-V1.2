import React from 'react';
import { InterfaceMode, AppBootstrapResponse } from '../types';
import { SidebarLink } from './SidebarLink';

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
  activeMode,
  modeCards,
  openMode,
  setShowUpload: _setShowUpload,
}) => {
  const primaryModeCards = modeCards.filter((item) => item.mode !== 'PERMIT_PORTAL');

  return (
    <aside className="w-[280px] flex flex-col shrink-0 border-r border-white/5 bg-[#0a0a0c] text-white shadow-2xl">
      <div className="h-24 flex flex-col justify-center px-8 gap-1 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <i className="fas fa-microchip text-white" />
          </div>
          <h1 className="text-xl font-black tracking-tighter font-['Outfit']">
            Miljöbeslut<span className="text-indigo-500">.se</span>
          </h1>
        </div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{activeMode.title}</p>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-8 overflow-y-auto custom-scrollbar">
        <div>
          <p className="px-4 pb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
            Arbetsytor
          </p>
          <div className="space-y-1">
            {primaryModeCards.map((item) => (
              <button
                key={`module-${item.mode}`}
                type="button"
                onClick={() => openMode(item.mode)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all ${
                  mode === item.mode
                    ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_20px_rgba(79,70,229,0.1)]'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent'
                }`}
              >
                <i
                  className={`fas ${item.icon} ${mode === item.mode ? 'text-indigo-400' : 'text-slate-500'}`}
                />
                <span className="text-sm font-bold truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="px-4 pb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
            Navigering
          </p>
          <div className="space-y-1">
            <SidebarLink
              active={activeTab === 'summary'}
              icon="fa-house"
              label="Översikt"
              onClick={() => setActiveTab('summary')}
            />

            {mode === 'PERMIT_PORTAL' && (
              <>
                <SidebarLink
                  active={activeTab === 'risks'}
                  icon="fa-shield-virus"
                  label="Fastighetsanalys"
                  onClick={() => setActiveTab('risks')}
                />
                <SidebarLink
                  active={activeTab === 'map'}
                  icon="fa-map-location-dot"
                  label="Kartutforskare"
                  onClick={() => setActiveTab('map')}
                />
                <SidebarLink
                  active={activeTab === 'apply'}
                  icon="fa-pen-to-square"
                  label="Skapa Ansökan"
                  onClick={() => setActiveTab('apply')}
                />
              </>
            )}

            {mode === 'Core_WORKFLOW' && (
              <>
                <SidebarLink
                  active={activeTab === 'core'}
                  icon="fa-rocket"
                  label="Modulportfölj"
                  onClick={() => setActiveTab('core')}
                />
                <SidebarLink
                  active={activeTab === 'sewage-application'}
                  icon="fa-droplet"
                  label="Enskilt avlopp"
                  onClick={() => setActiveTab('sewage-application')}
                />
                <SidebarLink
                  active={activeTab === 'localization'}
                  icon="fa-map-location-dot"
                  label="Lokaliseringsutredning"
                  onClick={() => setActiveTab('localization')}
                />
                <SidebarLink
                  active={activeTab === 'c-notification-mass'}
                  icon="fa-truck-ramp-box"
                  label="C-anmälan massor"
                  onClick={() => setActiveTab('c-notification-mass')}
                />
                <SidebarLink
                  active={activeTab === 'c-notification-chemicals'}
                  icon="fa-flask"
                  label="C-anmälan kemikalier"
                  onClick={() => setActiveTab('c-notification-chemicals')}
                />
              </>
            )}

            <SidebarLink
              active={activeTab === 'legal'}
              icon="fa-scale-balanced"
              label="Juridiskt Stöd"
              onClick={() => setActiveTab('legal')}
            />
          </div>
        </div>
      </nav>

      <div className="p-6 bg-white/[0.02] border-t border-white/5">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            System Status: OK
          </span>
        </div>
        <button
          onClick={() => setMode(null)}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 border border-white/10 text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/10 hover:text-white transition-all shadow-lg"
        >
          <i className="fas fa-layer-group" /> Byt Gränssnitt
        </button>
      </div>
    </aside>
  );
};
