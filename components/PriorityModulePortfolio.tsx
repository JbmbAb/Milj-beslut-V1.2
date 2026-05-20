import React from 'react';

type PriorityModulePortfolioProps = {
  onNavigate: (tab: string) => void;
};

const MODULES = [
  {
    id: 'sewage-application',
    title: 'Enskilt avlopp',
    subtitle: 'Fastighet, PE, skyddsniva, GIS-analys, systemval och kommunal ansokan.',
    icon: 'fa-droplet',
    status: 'Huvudmodul 1',
    accent: 'bg-sky-600',
  },
  {
    id: 'c-notification-mass',
    title: 'C-anmalan schaktmassor',
    subtitle: 'Fastighet, MPF/EWC, mellanlagring och deponi, massflode, logistik och inlamning.',
    icon: 'fa-truck-ramp-box',
    status: 'Huvudmodul 2',
    accent: 'bg-emerald-600',
  },
  {
    id: 'c-notification-chemicals',
    title: 'C-anmalan kemikalier',
    subtitle: 'Kemikalier, utslapp och egenkontroll (separat flode).',
    icon: 'fa-flask',
    status: 'Tillagg',
    accent: 'bg-teal-600',
  },
  {
    id: 'localization',
    title: 'Lokaliseringsutredning',
    subtitle: 'Alternativa platser, geodata, skyddsavstand, kartfigurer och rapportgenerering.',
    icon: 'fa-map-location-dot',
    status: 'Huvudmodul 3',
    accent: 'bg-indigo-600',
  },
] as const;

export const PriorityModulePortfolio: React.FC<PriorityModulePortfolioProps> = ({ onNavigate }) => {
  return (
    <div className="min-h-full bg-slate-50 px-8 py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            Prioriterad modulportfolj
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">
                Enskilt avlopp, C-anmalan och lokaliseringsutredning
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Dessa tre moduler ska vara forsta produktsparet. Projektplansportfoljen ska styra tid,
                risk, intressenter, ansvar och grindar ovanpa modulernas faktiska underlag.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('localization')}
              className="rounded-lg bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-600"
            >
              Starta utredning
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {MODULES.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => onNavigate(module.id)}
              className="group rounded-lg border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${module.accent} text-white`}>
                  <i className={`fas ${module.icon}`} />
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {module.status}
                </span>
              </div>
              <h2 className="mt-5 text-xl font-black text-slate-950">{module.title}</h2>
              <p className="mt-3 min-h-20 text-sm leading-6 text-slate-600">{module.subtitle}</p>
              <div className="mt-6 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-600">
                Oppna modul <i className="fas fa-arrow-right transition group-hover:translate-x-1" />
              </div>
            </button>
          ))}
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Projektplansportfoljens roll</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            {['Gantt', 'Riskanalys', 'Intressenter', 'Grindar'].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-slate-900">{item}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Styrs i projektportfoljen och hamtar status fran de tre huvudmodulerna.
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
