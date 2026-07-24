import React from 'react';
import { useTheme } from './context/ThemeContext';

type PriorityModulePortfolioProps = {
  onNavigate: (tab: string) => void;
};

const MODULES = [
  {
    id: 'sewage-application',
    title: 'Enskilt avlopp',
    subtitle: 'Fastighet, PE, skyddsnivå, GIS-analys, systemval och kommunal ansökan.',
    icon: 'fa-droplet',
    status: 'Huvudmodul 1',
    lightAccent: 'text-sky-600 bg-sky-50 border-sky-100',
    darkAccent: 'text-sky-400 bg-sky-500/10 border-sky-500/20 shadow-[0_0_15px_rgba(56,189,248,0.1)]',
    tagColor: 'text-sky-500 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/40 dark:border-sky-900/40',
  },
  {
    id: 'c-notification-mass',
    title: 'C-anmälan schaktmassor',
    subtitle: 'Fastighet, MPF/EWC, mellanlagring och deponi, massflöde, logistik och inlämning.',
    icon: 'fa-truck-ramp-box',
    status: 'Huvudmodul 2',
    lightAccent: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    darkAccent: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.1)]',
    tagColor: 'text-emerald-500 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-900/40',
  },
  {
    id: 'localization',
    title: 'Lokaliseringsutredning',
    subtitle: 'Alternativa platser, geodata, skyddsavstånd, kartfigurer och rapportgenerering.',
    icon: 'fa-map-location-dot',
    status: 'Huvudmodul 3',
    lightAccent: 'text-indigo-600 bg-indigo-50 border-indigo-100',
    darkAccent: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 shadow-[0_0_15px_rgba(129,140,248,0.1)]',
    tagColor: 'text-indigo-500 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/40 dark:border-indigo-900/40',
  },
  {
    id: 'mimer-search',
    title: 'Mimers AI-Sök',
    subtitle: 'Lokal hybrid RAG-sökning med pgvector, full-text och Cross-Encoder reranking.',
    icon: 'fa-brain',
    status: 'Huvudmodul 4',
    lightAccent: 'text-cyan-600 bg-cyan-50 border-cyan-100',
    darkAccent: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]',
    tagColor: 'text-cyan-500 bg-cyan-50 dark:text-cyan-400 dark:bg-cyan-950/40 dark:border-cyan-900/40',
  },
  {
    id: 'c-notification-chemicals',
    title: 'C-anmälan kemikalier',
    subtitle: 'Kemikalier, utsläpp och egenkontroll (separat flöde).',
    icon: 'fa-flask',
    status: 'Tillägg',
    lightAccent: 'text-teal-600 bg-teal-50 border-teal-100',
    darkAccent: 'text-teal-400 bg-teal-500/10 border-teal-500/20 shadow-[0_0_15px_rgba(45,212,191,0.1)]',
    tagColor: 'text-teal-500 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/40 dark:border-teal-900/40',
  },
] as const;

export const PriorityModulePortfolio: React.FC<PriorityModulePortfolioProps> = ({ onNavigate }) => {
  const { isDark } = useTheme();

  return (
    <div className={`min-h-full p-4 md:p-8 transition-colors duration-200 ${
      isDark ? 'bg-[#060607] text-slate-100' : 'bg-slate-50 text-slate-900'
    }`}>
      <div className="mx-auto max-w-7xl space-y-8">
        
        {/* Operations Center Header */}
        <header className={`relative overflow-hidden rounded-[24px] border p-6 md:p-8 transition-all duration-300 ${
          isDark 
            ? 'border-slate-800/80 bg-slate-900/30 backdrop-blur-xl shadow-2xl' 
            : 'border-slate-200 bg-white shadow-sm'
        }`}>
          {/* Subtle Background Glow for Dark Mode */}
          {isDark && (
            <div className="absolute -top-24 -right-24 w-80 h-80 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />
          )}

          <div className="relative z-10">
            <span className={`text-[10px] font-black uppercase tracking-[0.22em] ${
              isDark ? 'text-cyan-400' : 'text-slate-400'
            }`}>
              Prioriterad modulportfölj
            </span>
            <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <h1 className={`text-2xl md:text-3xl font-black tracking-tight ${
                  isDark ? 'text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400' : 'text-slate-950'
                }`}>
                  Enskilt avlopp, C-anmälan och lokaliseringsutredning
                </h1>
                <p className={`max-w-3xl text-xs md:text-sm leading-relaxed ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  Dessa tre moduler ska vara första produktspåret. Projektplansportföljen ska styra tid,
                  risk, intressenter, ansvar och grindar ovanpå modulernas faktiska underlag.
                </p>
              </div>
              
              <button
                type="button"
                onClick={() => onNavigate('localization')}
                className={`shrink-0 rounded-xl px-6 py-3.5 text-xs font-black uppercase tracking-wider text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
                  isDark 
                    ? 'bg-cyan-600 hover:bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' 
                    : 'bg-slate-900 hover:bg-indigo-600 shadow-sm'
                }`}
              >
                <i className="fas fa-search-location mr-2" />
                Starta utredning
              </button>
            </div>
          </div>
        </header>

        {/* Modular Cards Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {MODULES.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => onNavigate(module.id)}
              className={`group relative overflow-hidden rounded-[24px] border p-6 text-left transition-all duration-300 hover:-translate-y-1 ${
                isDark 
                  ? 'border-slate-800/80 bg-slate-900/20 hover:border-slate-700/80 hover:bg-slate-900/40 hover:shadow-[0_12px_30px_rgba(0,0,0,0.5)]' 
                  : 'border-slate-200 bg-white shadow-sm hover:border-indigo-200 hover:bg-slate-50/50 hover:shadow-md'
              }`}
            >
              {/* Card top border accent glow for dark mode */}
              {isDark && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              )}

              <div className="flex items-start justify-between gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-all duration-300 ${
                  isDark ? module.darkAccent : `${module.lightAccent} shadow-sm`
                }`}>
                  <i className={`fas ${module.icon} text-lg`} />
                </div>
                <span className={`rounded-xl px-2.5 py-1 text-[9px] font-black uppercase tracking-wider border ${
                  isDark 
                    ? 'border-slate-800 bg-slate-950 text-slate-400' 
                    : 'border-slate-100 bg-slate-100 text-slate-500'
                }`}>
                  {module.status}
                </span>
              </div>

              <h2 className={`mt-6 text-lg font-black tracking-tight leading-tight ${
                isDark ? 'text-white group-hover:text-cyan-400' : 'text-slate-950 group-hover:text-indigo-600'
              } transition-colors duration-200`}>
                {module.title}
              </h2>
              
              <p className={`mt-3 min-h-[64px] text-xs leading-relaxed ${
                isDark ? 'text-slate-400 group-hover:text-slate-300' : 'text-slate-600 group-hover:text-slate-700'
              } transition-colors duration-200 line-clamp-3`}>
                {module.subtitle}
              </p>

              <div className={`mt-6 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${
                isDark ? 'text-cyan-400' : 'text-indigo-600'
              }`}>
                Öppna modul 
                <i className="fas fa-arrow-right text-[10px] transition-transform duration-200 group-hover:translate-x-1" />
              </div>
            </button>
          ))}
        </div>

        {/* System & Portfolio Roll Panel */}
        <section className={`rounded-[24px] border p-6 md:p-8 transition-all duration-300 ${
          isDark 
            ? 'border-slate-800/80 bg-slate-900/10 backdrop-blur-md' 
            : 'border-slate-200 bg-white shadow-sm'
        }`}>
          <h2 className={`text-base md:text-lg font-black tracking-tight ${
            isDark ? 'text-slate-200' : 'text-slate-950'
          }`}>
            Projektplansportföljens roll
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: 'Gantt', icon: 'fa-chart-gantt text-cyan-500/70' },
              { title: 'Riskanalys', icon: 'fa-triangle-exclamation text-amber-500/70' },
              { title: 'Intressenter', icon: 'fa-users text-purple-500/70' },
              { title: 'Grindar', icon: 'fa-door-closed text-emerald-500/70' },
            ].map((item) => (
              <div 
                key={item.title} 
                className={`group rounded-2xl border p-4 transition-all duration-200 ${
                  isDark 
                    ? 'border-slate-800/60 bg-slate-900/20 hover:border-slate-700/60 hover:bg-slate-900/30' 
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100/50 hover:border-indigo-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <i className={`fas ${item.icon} text-xs`} />
                  <p className={`text-xs font-black uppercase tracking-wider ${
                    isDark ? 'text-slate-300 group-hover:text-cyan-400' : 'text-slate-900 group-hover:text-indigo-600'
                  } transition-colors duration-150`}>
                    {item.title}
                  </p>
                </div>
                <p className={`mt-2.5 text-xs leading-relaxed ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  Styrs i projektportföljen och hämtar status från de tre huvudmodulerna.
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
