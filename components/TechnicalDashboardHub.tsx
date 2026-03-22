import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';

const TechnicalSluExpert = lazy(() =>
  import('./TechnicalSluExpert').then((module) => ({ default: module.TechnicalSluExpert }))
);

const MODULES = [
  {
    id: 'mvp',
    title: 'MVP Workflow',
    description: 'Snabbspar for klassificering och anmalan (Miljobeslut.se MVP).',
    iconClassName: 'fa-rocket text-emerald-500',
    badge: 'NEW',
    accent: 'glow-emerald',
  },
  {
    id: 'ansokan',
    title: 'Ansokningsportal',
    description: 'Automatiserade forhandsprovningar med stod av 1500+ rattsdokument.',
    iconClassName: 'fa-brain text-indigo-500',
    badge: 'AI-SUPPORT',
    accent: 'glow-indigo',
  },
  {
    id: 'logistik',
    title: 'Logistik & Massor',
    description: 'Interaktiv GIS-analys for optimering av deponier och transporter.',
    iconClassName: 'fa-map-location-dot text-teal-500',
    badge: 'GEOSPATIAL',
    accent: 'glow-teal',
  },
  {
    id: 'projekt',
    title: 'Projektledning',
    description: 'Automatisk generering av anmalningshandlingar och bilagor for fastigheter.',
    iconClassName: 'fa-clipboard-list text-amber-500',
    badge: 'BACKLOG',
    accent: 'glow-amber',
  },
  {
    id: 'gronkoll',
    title: 'Gronkoll (Score)',
    description: 'Real-time regelefterlevnads-score baserat pa projektets riskprofil.',
    iconClassName: 'fa-shield-halved text-rose-500',
    badge: 'COMPLIANCE',
    accent: 'glow-rose',
  },
  {
    id: 'admin',
    title: 'Administrator',
    description: 'Adminyta for case-review, dokumentvisning och fordjupad analys.',
    iconClassName: 'fa-user-shield text-fuchsia-500',
    badge: 'ADMIN',
    accent: 'glow-rose',
  },
] as const;

interface TechnicalDashboardHubProps {
  onSelectModule: (id: string) => void;
  onPreviewModule?: (id: string) => void;
  user?: { name: string; avatar?: string };
}

export const TechnicalDashboardHub: React.FC<TechnicalDashboardHubProps> = ({
  onSelectModule,
  onPreviewModule,
  user,
}) => {
  const expertSectionRef = useRef<HTMLElement | null>(null);
  const [shouldRenderExpert, setShouldRenderExpert] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (shouldRenderExpert) return;

    const node = expertSectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRenderExpert(true);
          observer.disconnect();
        }
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRenderExpert]);

  return (
    <div className="min-h-screen bg-[#060607] text-white selection:bg-indigo-500/30 font-['Inter']">
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 bg-white/5 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <i className="fas fa-wave-square text-white text-[18px]" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter font-['Outfit']">
              RiskGuard<span className="text-indigo-500">.ai</span>
            </h1>
            <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 -mt-1">Miljobeslut 2.0</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-4 bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
            <i className="fas fa-magnifying-glass text-slate-600 text-[14px]" />
            <input
              type="text"
              placeholder="Sok i kunskapsgraf..."
              className="bg-transparent border-none outline-none text-xs font-bold text-slate-300 w-48 placeholder:text-slate-600"
            />
          </div>

          <div className="flex items-center gap-3 pl-4 border-l border-white/10">
            <div className="text-right">
              <p className="text-xs font-black">{user?.name || 'Administrator'}</p>
              <p className="text-[10px] text-slate-500">Premium Plan</p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden">
              <i className="fas fa-user text-slate-400 text-[16px]" />
            </div>
          </div>
        </div>
      </header>

      <main className="pt-32 pb-20 px-8 max-w-7xl mx-auto">
        <section className="mb-16 text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black tracking-widest uppercase mb-6">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Powered by Gemini 1.5 Pro
          </div>
          <h2 className="text-5xl md:text-6xl font-black font-['Outfit'] leading-tight mb-6 tracking-tight gradient-text">
            Gor miljo-tillstand enkelt och sakert
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed mb-10">
            Systematiserad handlaggning med realtidsdata fran Lantmateriet, SMHI och juridiska arkiv.
          </p>
        </section>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((module) => (
            <div
              key={module.id}
              onClick={() => onSelectModule(module.id)}
              onMouseEnter={() => onPreviewModule?.(module.id)}
              onFocus={() => onPreviewModule?.(module.id)}
              onPointerDown={() => onPreviewModule?.(module.id)}
              data-testid={`landing-open-${module.id}`}
              className={`group cursor-pointer p-8 rounded-[32px] bg-[#0F0F11] border border-white/5 hover:border-white/20 transition-all duration-500 relative overflow-hidden ${module.accent}`}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-[80px] group-hover:bg-indigo-500/20 transition-all duration-500" />

              <div className="relative z-10">
                <span className="inline-flex items-center justify-center p-4 bg-white/5 rounded-2xl mb-12 border border-white/5 group-hover:scale-110 transition-transform duration-500">
                  <i className={`fas ${module.iconClassName} text-[32px]`} />
                </span>

                <span className="block text-[10px] font-black tracking-widest text-[#475569] uppercase mb-2 group-hover:text-white/50 transition-colors">
                  {module.badge}
                </span>

                <h3 className="text-xl font-bold mb-3 font-['Outfit'] text-white">{module.title}</h3>

                <p className="text-slate-500 text-xs leading-relaxed mb-10 group-hover:text-slate-300 transition-colors">
                  {module.description}
                </p>

                <div className="flex items-center gap-2 text-xs font-black text-indigo-400 group-hover:text-white transition-colors">
                  Oppna modul <i className="fas fa-arrow-right text-[12px] group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-20 grid md:grid-cols-3 gap-6">
          {[
            { label: 'Bearbetade Dokument', value: '1 045', detail: '+12 sedan igar' },
            { label: 'Analytisk Precision', value: '98.4%', detail: 'Hogre konfidens' },
            { label: 'Aktiv Handlaggningstid', value: '-64%', detail: 'Tidsbesparing' },
          ].map((stat, i) => (
            <div key={i} className="p-6 rounded-3xl bg-white/5 border border-white/5 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{stat.label}</p>
              <div className="text-3xl font-black font-['Outfit'] mb-1">{stat.value}</div>
              <p className="text-[10px] text-teal-400 font-bold uppercase">{stat.detail}</p>
            </div>
          ))}
        </div>

        <section ref={expertSectionRef} className="mt-20 min-h-[320px]">
          {shouldRenderExpert ? (
            <Suspense
              fallback={
                <div className="rounded-[32px] border border-white/5 bg-[#0F0F11] p-10 text-center text-slate-500">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-emerald-500" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Laddar expertvy</p>
                </div>
              }
            >
              <TechnicalSluExpert />
            </Suspense>
          ) : (
            <div className="rounded-[32px] border border-white/5 bg-[#0F0F11] p-10 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Expertvy laddas nar sektionen narmar sig</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default TechnicalDashboardHub;
