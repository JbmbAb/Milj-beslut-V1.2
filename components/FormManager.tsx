import React from 'react';

const FormManager: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h2 className="text-3xl font-black tracking-tighter text-slate-900 italic">Blankett-hantering</h2>
          <p className="mt-1 font-medium italic text-slate-500">
            Demoformularet ar borttaget. Denna vy aktiveras igen nar riktiga myndighetsblanketter eller verifierade formmallar
            ar inkopplade.
          </p>
        </div>
      </header>

      <section className="rounded-[3rem] border border-amber-200 bg-amber-50 p-10 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Blankettmotor blockerad</p>
        <h3 className="mt-3 text-2xl font-black text-slate-900">Ingen verifierad blankettmall tillgänglig</h3>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-700">
          For att undvika fejkdata visas inga forifyllda formular langre i utvecklingslaget. Nasta sakra steg ar att koppla
          riktiga mallar fran kommun, myndighet eller en juridiskt godkand intern mallkatalog.
        </p>
        <div className="mt-6 rounded-2xl border border-amber-300 bg-white px-5 py-4 text-sm text-slate-700">
          <p className="font-black text-slate-900">Vad som kravs for att återaktivera denna vy</p>
          <ul className="mt-2 list-disc pl-5">
            <li>Verifierad formulärkälla per tillståndstyp</li>
            <li>Spårbar versionshantering av varje blankettmall</li>
            <li>Human-in-the-loop innan AI-förslag skrivs in i skarpa handlingar</li>
          </ul>
        </div>
      </section>
    </div>
  );
};

export default FormManager;
