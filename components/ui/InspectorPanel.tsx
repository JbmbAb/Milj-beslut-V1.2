import React from 'react';
import { useOperationsCenter } from '../context/OperationsCenterContext';

export const InspectorPanel: React.FC = () => {
  const { inspectorData } = useOperationsCenter();

  // Color mapping based on status
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success':
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
          dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]',
          badge: 'bg-emerald-500 text-slate-950',
        };
      case 'warning':
        return {
          bg: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
          dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
          badge: 'bg-amber-500 text-slate-950',
        };
      case 'danger':
        return {
          bg: 'bg-red-500/10 border-red-500/20 text-red-400',
          dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]',
          badge: 'bg-red-500 text-slate-100',
        };
      case 'info':
      default:
        return {
          bg: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
          dot: 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]',
          badge: 'bg-cyan-500 text-slate-950',
        };
    }
  };

  if (!inspectorData) {
    return (
      <aside className="w-80 border-l border-slate-800 bg-slate-950 flex flex-col shrink-0 overflow-hidden h-screen z-10 shadow-2xl relative select-none">
        {/* Header */}
        <div className="h-16 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <i className="fas fa-info-circle text-slate-500" />
            Miljö-inspektör
          </h2>
          <span className="text-[8px] font-black text-slate-500 uppercase bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
            Live
          </span>
        </div>

        {/* Placeholder Content */}
        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-4 bg-gradient-to-b from-slate-950 to-slate-900">
          <div className="w-16 h-16 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-center text-slate-500 shadow-inner relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <i className="fas fa-fingerprint text-2xl text-slate-600 group-hover:text-cyan-500 group-hover:scale-110 transition-all duration-300" />
          </div>
          <div className="space-y-1.5 max-w-[200px]">
            <h3 className="text-xs font-black text-slate-300 uppercase tracking-wide">Välj objekt på kartan</h3>
            <p className="text-[10px] text-slate-500 font-bold leading-normal">
              Klicka på ett alternativ eller en fastighet för att köra PostGIS-kontroller, Vertex AI RAG-analyser och granska källhänvisningar.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800/60 bg-slate-950/80 text-[8px] text-slate-500 text-center font-black uppercase tracking-widest shrink-0">
          Mimers Brunn • Offline-First
        </div>
      </aside>
    );
  }

  const colors = getStatusColor(inspectorData.status);

  return (
    <aside className="w-80 border-l border-slate-800 bg-slate-950 flex flex-col shrink-0 overflow-hidden h-screen z-10 shadow-2xl relative">
      {/* Header */}
      <div className="h-16 px-6 border-b border-slate-800 flex flex-col justify-center bg-slate-900/50 shrink-0">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-200 truncate">
          {inspectorData.title}
        </h2>
        <p className="text-[9px] text-slate-500 font-bold uppercase mt-0.5 truncate">
          {inspectorData.subtitle}
        </p>
      </div>

      {/* Scrollable Panel Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {/* Primary Status Card with RAG Confidence Circle */}
        <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between gap-4 relative overflow-hidden">
          <div className="space-y-1 min-w-0">
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Inspektionsstatus</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
              <span className="text-xs font-black text-slate-100 truncate">{inspectorData.statusText || 'Granskad'}</span>
            </div>
          </div>

          {/* Sannolikhets-cirkel */}
          {inspectorData.confidence !== undefined && (
            <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#1e293b" strokeWidth="2.5" />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke={inspectorData.status === 'danger' ? '#ef4444' : inspectorData.status === 'warning' ? '#f59e0b' : '#06b6d4'}
                  strokeWidth="2.5"
                  strokeDasharray="100"
                  strokeDashoffset={100 - inspectorData.confidence}
                />
              </svg>
              <span className="absolute text-[10px] font-black text-slate-200">
                {inspectorData.confidence}%
              </span>
            </div>
          )}
        </div>

        {/* Detailed Metadata Grid */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Egenskaper</h4>
          <div className="bg-slate-900/30 border border-slate-800/60 rounded-2xl overflow-hidden divide-y divide-slate-800/40">
            {Object.entries(inspectorData.metadata).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between p-3 text-[10px]">
                <span className="font-bold text-slate-400">{key}</span>
                <span className="font-black text-slate-200 text-right max-w-[150px] truncate" title={String(val)}>
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Explanatory Legal/Environmental Summary */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Juridisk / Miljöanalys</h4>
          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/50 text-[11px] text-slate-300 leading-relaxed space-y-2">
            <p className="whitespace-pre-wrap">{inspectorData.explainText}</p>
          </div>
        </div>

        {/* Scientific & Government Sources Citation */}
        {inspectorData.sources && inspectorData.sources.length > 0 && (
          <div className="space-y-2.5">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Källhänvisningar & Domar</h4>
            <div className="space-y-2">
              {inspectorData.sources.map((src) => (
                <div
                  key={src.id}
                  className="p-3 bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 rounded-xl transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-slate-200 truncate">{src.title}</span>
                    <span className="text-[8px] font-black tracking-wider px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-400 uppercase shrink-0">
                      {src.type}
                    </span>
                  </div>
                  {src.citation && (
                    <p className="text-[9px] text-slate-400 italic leading-snug border-l-2 border-slate-700 pl-2">
                      "{src.citation}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800/60 bg-slate-950/80 text-[8px] text-slate-500 text-center font-black uppercase tracking-widest shrink-0 flex items-center justify-between">
        <span>Mimers Brunn</span>
        <span>v2.0 Beta</span>
      </div>
    </aside>
  );
};
