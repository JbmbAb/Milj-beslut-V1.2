
import React from 'react';

const Guide: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20 text-slate-800">
      <header className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest mb-4 shadow-lg shadow-blue-600/20">
          <i className="fas fa-flag-checkered"></i> Slutfas: Från Data till Insikt
        </div>
        <h2 className="text-4xl font-black text-slate-900 tracking-tighter leading-tight italic">"1577 pusselbitar är nu lagda."</h2>
        <p className="text-slate-500 mt-2 text-lg">Här är din guide för att förvandla databasen till ett färdigt examensarbete.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all">
          <h3 className="text-xl font-black text-slate-900 mb-4 flex items-center gap-3">
             <i className="fas fa-magnifying-glass-chart text-blue-600"></i>
             Hitta Trenderna
          </h3>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">
            Använd <strong>Fastighetsarkivet</strong> för att se vilka bolag som är mest aktiva. Sök på avfallskoder som 90.10 för att se hur olika kommuner bedömer samma typ av risk.
          </p>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 italic text-[11px] text-slate-400">
             "Tips: Jämför Haninge och Huddinge. Finns det en skillnad i hur ofta de ger 'Bifall'?"
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all">
          <h3 className="text-xl font-black text-slate-900 mb-4 flex items-center gap-3">
             <i className="fas fa-map-location-dot text-emerald-600"></i>
             Den Rumsliga Risken
          </h3>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">
            Öppna <strong>Kartutforskaren</strong>. Genom att kombinera dina 1577 punkter med SGU:s lager för grundvatten kan du vetenskapligt bevisa var miljörisken är störst.
          </p>
          <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 italic text-[11px] text-emerald-600">
             "Ta screenshots på klustren vid vattenskyddsområden för din bilaga."
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-[3rem] p-12 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-10">
            <i className="fas fa-graduation-cap text-[120px]"></i>
        </div>
        <h4 className="text-2xl font-black mb-8 flex items-center gap-4">
          <i className="fas fa-list-check text-blue-400"></i>
          Ditt nästa steg (Action Plan)
        </h4>
        
        <div className="space-y-6 relative z-10">
          <StepItem 
            num="1" 
            title="Klassificera i Resurshantering" 
            desc="Låt AI:n gå igenom bildfragmenten. Detta rensar bort 'brus' och lyfter fram de viktiga signaturerna." 
          />
          <StepItem 
            num="2" 
            title="Använd 'Marknadsunderlag'" 
            desc="Gå till tabellen, välj en grupp dokument och klicka på knappen. Kopiera AI-sammanfattningen som grund till din diskussion." 
          />
          <StepItem 
            num="3" 
            title="Utför Risk-Triage" 
            desc="Välj ut 10 dokument i arkivet och kör 'AI Riskbedömning'. Jämför resultaten för att se om AI:n hittar risker som handläggaren missat." 
          />
        </div>
      </div>

      <footer className="text-center opacity-40 pb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em]">RiskGuard v3.4.2 • Powered by Gemini 3 Pro</p>
      </footer>
    </div>
  );
};

const StepItem: React.FC<{ num: string; title: string; desc: string }> = ({ num, title, desc }) => (
  <div className="flex gap-6 items-start group">
    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black shrink-0 shadow-lg group-hover:scale-110 transition-transform">
      {num}
    </div>
    <div>
      <h5 className="font-black text-white text-base mb-1">{title}</h5>
      <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
    </div>
  </div>
);

export default Guide;
