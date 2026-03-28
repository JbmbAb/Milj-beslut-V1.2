import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  itemVariants,
  slideUpVariants,
  staggerContainerVariants,
  pageEnterVariants,
} from './animations/motionVariants';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';
import { designTokens } from './theme/designTokens';

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
}

export const TechnicalDashboardHub: React.FC<TechnicalDashboardHubProps> = ({
  onSelectModule,
  onPreviewModule,
}) => {
  const expertSectionRef = useRef<HTMLElement | null>(null);
  const [shouldRenderExpert, setShouldRenderExpert] = useState(() => typeof IntersectionObserver === 'undefined');
  const isMdUp =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 768px)').matches;

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
    <motion.div
      initial="hidden"
      animate="visible"
      variants={pageEnterVariants}
      className="min-h-screen bg-gradient-to-b from-[#060607] to-[#0a0a0d] text-white selection:bg-indigo-500/30 font-['Inter']"
    >
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 bg-white/5 backdrop-blur-xl border-b border-white/5">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <i className="fas fa-wave-square text-white text-[18px]" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter font-['Outfit']">
              RiskGuard<span className="text-indigo-500">.ai</span>
            </h1>
            <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 -mt-1">Miljobeslut 2.0</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex items-center gap-6"
        >
          <div className="hidden md:flex items-center gap-4 bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
            <i className="fas fa-magnifying-glass text-slate-600 text-[14px]" />
            <input
              type="text"
              placeholder="Sok i kunskapsgraf..."
              tabIndex={isMdUp ? 0 : -1}
              className="bg-transparent border-none outline-none text-xs font-bold text-slate-300 w-48 placeholder:text-slate-600"
            />
          </div>

          <div className="flex items-center gap-3 pl-4 border-l border-white/10">
            <IconButton
              icon={<i className="fas fa-user text-[16px]" />}
              ariaLabel="User profile"
              tabIndex={-1}
              variant="default"
              size="md"
            />
          </div>
        </motion.div>
      </header>

      <main className="pt-32 pb-20 px-8 max-w-7xl mx-auto">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={slideUpVariants}
          className="mb-16 text-center max-w-2xl mx-auto"
        >
          <motion.div
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Badge
              tone="default"
              icon={<span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
            >
              Powered by Gemini 1.5 Pro
            </Badge>
          </motion.div>
          <h2 className="text-5xl md:text-6xl font-black font-['Outfit'] leading-tight mb-6 tracking-tight gradient-text">
            Gor miljo-tillstand enkelt och sakert
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed mb-10">
            Systematiserad handlaggning med realtidsdata fran Lantmateriet, SMHI och juridiska arkiv.
          </p>
        </motion.section>

        <motion.div
          className="grid gap-6 md:grid-cols-2 lg:grid-cols-4"
          variants={staggerContainerVariants}
          initial="hidden"
          animate="visible"
        >
          {MODULES.map((module) => (
            <motion.div
              key={module.id}
              variants={itemVariants}
              whileHover="hover"
              initial="rest"
              animate="rest"
              tabIndex={0}
              onClick={() => onSelectModule(module.id)}
              onMouseEnter={() => onPreviewModule?.(module.id)}
              onFocus={() => onPreviewModule?.(module.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectModule(module.id);
                }
              }}
              onPointerDown={() => onPreviewModule?.(module.id)}
              data-testid={`landing-open-${module.id}`}
              className={`group cursor-pointer p-8 rounded-[32px] bg-[#0F0F11] border border-white/5 hover:border-white/20 relative overflow-hidden ${module.accent}`}
            >
              <motion.div
                className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-[80px]"
                whileHover={{ background: 'rgba(99, 102, 241, 0.2)' }}
                transition={{ duration: 0.3 }}
              />

              <div className="relative z-10">
                <motion.span
                  className="inline-flex items-center justify-center p-4 bg-white/5 rounded-2xl mb-12 border border-white/5"
                  transition={{ duration: 0.2 }}
                  whileHover={{ rotate: 360, scale: 1.1 }}
                >
                  <i className={`fas ${module.iconClassName} text-[32px]`} />
                </motion.span>

                <motion.div
                  whileHover={{ opacity: 0.8 }}
                  transition={{ duration: 0.2 }}
                  className="mb-2"
                >
                  <Badge tone="default">{module.badge}</Badge>
                </motion.div>

                <h3 className="text-xl font-bold mb-3 font-['Outfit'] text-white">{module.title}</h3>

                <p className="text-slate-500 text-xs leading-relaxed mb-10 group-hover:text-slate-300 transition-colors">
                  {module.description}
                </p>

                <motion.div
                  className="flex items-center gap-2 text-xs font-black text-indigo-400"
                  whileHover={{ color: '#ffffff' }}
                  transition={{ duration: 0.2 }}
                >
                  Oppna modul{' '}
                  <motion.i
                    className="fas fa-arrow-right text-[12px]"
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}
                  />
                </motion.div>
              </div>
            </motion.div>
          ))}
        </motion.div>



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
    </motion.div>
  );
};

export default TechnicalDashboardHub;
