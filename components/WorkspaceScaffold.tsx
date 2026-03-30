import React, { useMemo } from 'react';
import type { InterfaceMode } from '../types';
import { preloadWorkspaceForMode } from './workspacePreload';
import { MODE_CARDS } from './workspaceModes';

type WorkspaceScaffoldProps = {
  mode: InterfaceMode;
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onOpenMode: (mode: InterfaceMode) => void;
  onExitToDashboard: () => void;
  headerBadges?: React.ReactNode;
  children: React.ReactNode;
};

const WorkspaceScaffold: React.FC<WorkspaceScaffoldProps> = ({
  mode,
  activeTab,
  onSetActiveTab,
  onOpenMode,
  onExitToDashboard,
  headerBadges,
  children,
}) => {
  const modeCardMap = useMemo(() => {
    return MODE_CARDS.reduce<Record<InterfaceMode, (typeof MODE_CARDS)[number]>>((acc, item) => {
      acc[item.mode] = item;
      return acc;
    }, {} as Record<InterfaceMode, (typeof MODE_CARDS)[number]>);
  }, []);

  const activeMode = modeCardMap[mode] ?? null;

  return (
    <div className="min-h-screen flex overflow-hidden font-['Plus_Jakarta_Sans'] bg-slate-50">
      <aside className="w-[250px] flex flex-col shrink-0 border-r border-[#243148] bg-[#1c212e] text-white">
        <div className="h-24 flex flex-col justify-center px-6 gap-2 border-b border-[#243148]">
          <img src="/logo.png" alt="Miljobeslut.se Logo" className="h-8 w-auto object-contain self-start" />
          <p className="text-[9px] font-bold text-[#8ea0bf] uppercase tracking-widest">
            {activeMode?.title}
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto custom-scrollbar">
          <p className="px-[10px] pb-1 text-[12px] font-semibold text-[#91a3c4]">Moduler</p>

          {MODE_CARDS.map((item) => (
            <button
              key={`module-${item.mode}`}
              type="button"
              onClick={() => onOpenMode(item.mode)}
              onMouseEnter={() => {
                if (item.mode !== mode) {
                  void preloadWorkspaceForMode(item.mode);
                }
              }}
              onFocus={() => {
                if (item.mode !== mode) {
                  void preloadWorkspaceForMode(item.mode);
                }
              }}
              onPointerDown={() => {
                if (item.mode !== mode) {
                  void preloadWorkspaceForMode(item.mode);
                }
              }}
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
              API: Ansluten
            </span>
          </div>

          <p className="px-[10px] pt-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7086a4]">
            Avsnitt
          </p>
          <SidebarLink active={activeTab === 'summary'} icon="fa-house" label="Startsida" onClick={() => onSetActiveTab('summary')} />
          {mode !== 'MVP_WORKFLOW' && (
            <>
              <SidebarLink active={activeTab === 'summary'} icon="fa-chart-pie" label="Beslutsoversikt" onClick={() => onSetActiveTab('summary')} />
              <SidebarLink active={activeTab === 'integrations'} icon="fa-database" label="Tjansteintegreringar" onClick={() => onSetActiveTab('integrations')} />
              <SidebarLink active={activeTab === 'guide'} icon="fa-book-open" label="Manualer & Support" onClick={() => onSetActiveTab('guide')} />
              <SidebarLink active={activeTab === 'legal'} icon="fa-scale-balanced" label="Rattsligt stod" onClick={() => onSetActiveTab('legal')} />
            </>
          )}

          {mode === 'LOGISTICS_MARKET' && (
            <>
              <SidebarLink active={activeTab === 'archive'} icon="fa-box-archive" label="Beslutsarkiv" onClick={() => onSetActiveTab('archive')} />
              <SidebarLink active={activeTab === 'logistics'} icon="fa-truck-ramp-box" label="Logistik och massor" onClick={() => onSetActiveTab('logistics')} />
              <SidebarLink active={activeTab === 'triage'} icon="fa-microscope" label="Resurs-triage" onClick={() => onSetActiveTab('triage')} />
            </>
          )}

          {mode === 'PERMIT_PORTAL' && (
            <>
              <SidebarLink active={activeTab === 'apply'} icon="fa-pen-to-square" label="Ny ansokan" onClick={() => onSetActiveTab('apply')} />
              <SidebarLink active={activeTab === 'forms'} icon="fa-file-invoice" label="Blankettmotor" onClick={() => onSetActiveTab('forms')} />
              <SidebarLink active={activeTab === 'biodiversity'} icon="fa-bugs" label="Bioinventering" onClick={() => onSetActiveTab('biodiversity')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-shield-virus" label="Fastighetsanalys" onClick={() => onSetActiveTab('risks')} />
              <SidebarLink active={activeTab === 'map'} icon="fa-map-location-dot" label="Kartutforskare" onClick={() => onSetActiveTab('map')} />
            </>
          )}

          {mode === 'PROJECT_MANAGER' && (
            <>
              <SidebarLink active={activeTab === 'plan'} icon="fa-scroll" label="Projektplan" onClick={() => onSetActiveTab('plan')} />
              <SidebarLink active={activeTab === 'timeline'} icon="fa-calendar-range" label="Tidplan och Gantt" onClick={() => onSetActiveTab('timeline')} />
              <SidebarLink active={activeTab === 'field'} icon="fa-camera-retro" label="Faltdokumentation" onClick={() => onSetActiveTab('field')} />
              <SidebarLink active={activeTab === 'risks'} icon="fa-triangle-exclamation" label="Riskhantering" onClick={() => onSetActiveTab('risks')} />
            </>
          )}

          {mode === 'COMPLIANCE_AUDIT' && (
            <>
              <SidebarLink active={activeTab === 'score'} icon="fa-gauge-high" label="Regelefterlevnad" onClick={() => onSetActiveTab('score')} />
              <SidebarLink active={activeTab === 'audit'} icon="fa-list-check" label="Revisionslogg" onClick={() => onSetActiveTab('audit')} />
              <SidebarLink active={activeTab === 'reports'} icon="fa-file-chart-column" label="Langivarrapport" onClick={() => onSetActiveTab('reports')} />
            </>
          )}

          {mode === 'ADMIN_CONSOLE' && (
            <>
              <SidebarLink active={activeTab === 'admin-search'} icon="fa-magnifying-glass-chart" label="Admin sokcenter" onClick={() => onSetActiveTab('admin-search')} />
              <SidebarLink active={activeTab === 'admin-review'} icon="fa-clipboard-check" label="Kvalitetssakring" onClick={() => onSetActiveTab('admin-review')} />
              <SidebarLink active={activeTab === 'admin-insight'} icon="fa-shield-check" label="Analys och compliance" onClick={() => onSetActiveTab('admin-insight')} />
            </>
          )}

          {mode === 'MVP_WORKFLOW' && (
            <SidebarLink active={activeTab === 'mvp'} icon="fa-rocket" label="Ansokningsflode" onClick={() => onSetActiveTab('mvp')} />
          )}
        </nav>

        <div className="p-4 border-t border-[#243148]">
          <button
            onClick={onExitToDashboard}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#1f2633] text-[#a6b4cb] rounded-[10px] text-[10px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <i className="fas fa-right-left" /> Byt granssnitt
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-20 border-b flex items-center justify-between px-10 shrink-0 bg-white z-10 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${activeMode?.accent ?? 'bg-slate-400'}`} />
            {activeTab}
          </h2>
          <div className="flex items-center gap-4">
            {headerBadges}
            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
              SYSTEM VERSION 5.0.0
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar relative">{children}</div>
      </main>
    </div>
  );
};

const SidebarLink: React.FC<{ active: boolean; icon: string; label: string; onClick: () => void }> = ({
  active,
  icon,
  label,
  onClick,
}) => (
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

export default WorkspaceScaffold;
