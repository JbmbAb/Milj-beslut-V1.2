import React from 'react';
import { ProjectPlan } from '../../types';

interface ProjectReportViewProps {
  plan: ProjectPlan;
  onClose: () => void;
}

export const ProjectReportView: React.FC<ProjectReportViewProps> = ({ plan, onClose }) => {
  const reportAccentColor = plan.branding.primaryColor || '#0f172a';
  const reportLogo = plan.branding.logoUrl?.trim() || '/logo.png';

  return (
    <div className="max-w-4xl mx-auto bg-white p-20 shadow-2xl rounded-sm font-serif text-slate-900 min-h-screen animate-in fade-in duration-500 relative overflow-hidden">
      {/* Watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] rotate-[-35deg] select-none">
        <span className="text-9xl font-black whitespace-nowrap uppercase">
          UTKAST – Kräver manuell verifiering
        </span>
      </div>

      <button
        onClick={onClose}
        className="fixed top-24 left-10 p-4 bg-slate-900 text-white rounded-full shadow-xl hover:scale-110 transition-all z-50"
      >
        <i className="fas fa-arrow-left"></i>
      </button>

      <header className="border-b-4 border-slate-900 pb-10 mb-10" style={{ borderColor: reportAccentColor }}>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
          Projektstyrdokument / {plan.revision}
        </p>
        <h1 className="text-5xl font-black tracking-tighter uppercase">{plan.name}</h1>
        <div className="mt-6 flex justify-between items-end">
          <div>
            <p className="text-sm font-black">{plan.branding.organizationName}</p>
            <p className="text-sm font-bold">Fastighet: {plan.location.propertyId}</p>
            <p className="text-xs text-slate-400 italic">Skapat: {new Date().toLocaleDateString('sv-SE')}</p>
          </div>
          <img src={reportLogo} className="h-10 grayscale opacity-20" alt="Logo" />
        </div>
      </header>

      <section className="mb-12">
        <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">
          1. Bakgrund & Behov
        </h2>
        <p className="text-lg leading-relaxed">{plan.background}</p>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">
          2. Projektbeskrivning
        </h2>
        <p className="text-lg leading-relaxed whitespace-pre-wrap">{plan.description}</p>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">3. Effektmål</h2>
        <ul className="list-disc pl-6 space-y-2">
          {plan.goals.map((g) => (
            <li key={g.id} className="text-lg font-bold italic">
              {g.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">
          4. Intressentanalys
        </h2>
        <div className="grid grid-cols-2 gap-6">
          {plan.stakeholders.map((s) => (
            <div key={s.id} className="p-4 border border-slate-100 bg-slate-50">
              <p className="text-[10px] font-black uppercase opacity-50">{s.role}</p>
              <p className="font-bold">{s.name}</p>
              <p className="text-sm italic mt-1">{s.relevance}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">5. Dokumentarkiv</h2>
        <div className="space-y-3">
          {plan.documentArchive.map((doc) => (
            <div key={doc.id} className="p-4 border border-slate-100 bg-slate-50">
              <p className="font-bold">{doc.name}</p>
              <p className="text-xs uppercase tracking-widest text-slate-500">
                {doc.module} / {doc.category} / {doc.status}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-20 pt-10 border-t border-slate-100 text-center text-xs text-slate-400">
        Dokumentet är genererat via Miljobeslut.se Portal 2.0.
      </footer>
    </div>
  );
};
