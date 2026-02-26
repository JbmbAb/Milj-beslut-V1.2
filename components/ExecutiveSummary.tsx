
import React from 'react';

interface ExecutiveSummaryProps {
  mode?: string;
}

const ExecutiveSummary: React.FC<ExecutiveSummaryProps> = ({ mode = 'summary' }) => {
  if (mode === 'score' || mode === 'audit' || mode === 'reports') {
    return (
      <div className="animate-in fade-in duration-500 space-y-10 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Compliance Score Card */}
          <div className="lg:col-span-1 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm text-center space-y-6">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Regelefterlevnads-index</h3>
            <div className="relative w-48 h-48 mx-auto">
              <svg className="w-full h-full" viewBox="0 0 100 100">
                <circle className="text-slate-100 stroke-current" strokeWidth="10" fill="transparent" r="40" cx="50" cy="50" />
                <circle className="text-emerald-500 stroke-current" strokeWidth="10" strokeLinecap="round" fill="transparent" r="40" cx="50" cy="50" strokeDasharray="251.2" strokeDashoffset="62.8" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-black text-slate-900 tracking-tighter">75</span>
                <span className="text-[10px] font-black text-slate-400 uppercase">Score</span>
              </div>
            </div>
            <div className="space-y-4 text-left">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-slate-500">Genomförda moment:</span>
                <span className="text-slate-900">12 / 16</span>
              </div>
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-slate-500">Uppladdade tillstånd:</span>
                <span className="text-slate-900">4 / 5</span>
              </div>
            </div>
            <button className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-100">
              Verifiera Slutdokumentation
            </button>
          </div>

          {/* Audit Trail / Reports */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl">
              <h3 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] mb-8">Revisionslogg (Audit Trail)</h3>
              <div className="space-y-4">
                <AuditRow time="2024-02-22 14:30" user="System" action="Projekt skapat" details="Auto-init via Fastighets-API" />
                <AuditRow time="2024-02-22 15:12" user="Erik L." action="Fas Signerad" details="Förstudie godkänd" />
                <AuditRow time="2024-02-22 16:05" user="System" action="RAG-Analys" details="Checklista genererad för 90.131" />
                <AuditRow time="2024-02-22 16:45" user="Erik L." action="Dokument Uppladdat" details="Provtagningsplan.pdf" />
              </div>
            </div>

            <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-black italic uppercase tracking-tight">Riskrapport för Långivare</h3>
                <button className="px-6 py-2 bg-slate-100 text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest border border-slate-200">
                  <i className="fas fa-download mr-2"></i> Exportera PDF
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Miljöteknisk Risk</p>
                  <p className="text-sm font-bold text-slate-700 leading-relaxed italic">"Fastigheten har kvarlämnade föroreningar klass MKM. Saneringsbehov identifierat."</p>
                </div>
                <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-100">
                  <p className="text-[10px] font-black text-emerald-600 uppercase mb-2">Grön Obligation-verifiering</p>
                  <p className="text-sm font-bold text-emerald-900 leading-relaxed italic">"Projektet matchar EU-taxonomins krav för hållbara investeringar (Vatten & Avlopp)."</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
             <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
             <span className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.3em]">System Status: Optimal</span>
          </div>
          <h1 className="text-5xl font-black text-slate-900 tracking-tighter italic">Miljöintelligens.se</h1>
          <p className="text-slate-500 font-medium text-lg">Sveriges ledande AI-driven plattform för miljötillstånd och marknadsdata.</p>
        </div>
        <div className="flex gap-4">
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center min-w-[120px]">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Analyserade Beslut</p>
              <p className="text-2xl font-black text-slate-900 tracking-tight">1 577</p>
           </div>
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center min-w-[120px]">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">API-Kopplingar</p>
              <p className="text-2xl font-black text-slate-900 tracking-tight">8/8</p>
           </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <CapabilityCard 
          title="Spatial Intelligence" 
          desc="Intersection-analys mot RAÄ, SMHI och SGU för automatisk riskflaggning." 
          icon="fa-location-dot" 
          color="text-emerald-400"
          status="Live"
        />
        <CapabilityCard 
          title="Document AI (OCR)" 
          desc="Gemini 3 Flash-driven extraktion av juridiska villkor och avfallskoder." 
          icon="fa-file-shield" 
          color="text-blue-400"
          status="Live"
        />
        <CapabilityCard 
          title="Market Grounding" 
          desc="Realtidsanalys av marknadstrender via Google Search & Maps integration." 
          icon="fa-earth-europe" 
          color="text-indigo-400"
          status="Live"
        />
        <CapabilityCard 
          title="Asset Triage" 
          desc="Visuell klassificering av signaturer och logotyper för nätverksanalys." 
          icon="fa-microscope" 
          color="text-amber-400"
          status="Beta"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-[3rem] border border-slate-200 p-10 shadow-sm">
           <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-8">Live API Stack</h3>
           <div className="space-y-4">
              <ApiRow name="Lantmäteriet WMS" type="Fastighetsdata" status="Ansluten" delay="45ms" />
              <ApiRow name="RAÄ Fornsök" type="Kulturmiljö" status="Ansluten" delay="120ms" />
              <ApiRow name="SMHI Hydro" type="Klimatrisk" status="Ansluten" delay="88ms" />
              <ApiRow name="Naturvårdsverket" type="Miljöskydd" status="Ansluten" delay="110ms" />
              <ApiRow name="SGU Geokarta" type="Markdata" status="Ansluten" delay="210ms" />
              <ApiRow name="Google Maps Grounding" type="Spatial AI" status="Ansluten" delay="1.2s" />
           </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[3rem] p-10 text-white shadow-xl relative overflow-hidden">
           <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
           <h3 className="text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">Färdplan Q4</h3>
           <div className="space-y-8">
              <RoadmapItem icon="fa-bugs" title="Artdatabanken" desc="Integration för automatisk kontroll av rödlistade arter vid schaktning." />
              <RoadmapItem icon="fa-cloud-bolt" title="Väder-prognos AI" desc="Prediktiv analys av avrinningsrisker baserat på realtidsväder." />
           </div>
        </div>
      </div>
    </div>
  );
};

const CapabilityCard: React.FC<{ title: string; desc: string; icon: string; color: string; status: string }> = ({ title, desc, icon, color, status }) => (
  <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl hover:scale-[1.02] transition-all group border border-white/5">
     <div className={`${color} mb-6 transition-transform group-hover:rotate-12`}>
        <i className={`fas ${icon} text-3xl`}></i>
     </div>
     <h3 className="text-lg font-black mb-2 tracking-tight">{title}</h3>
     <p className="text-slate-400 text-xs leading-relaxed mb-6 italic">{desc}</p>
     <span className="px-3 py-1 bg-white/10 rounded-full text-[8px] font-black uppercase tracking-widest">{status}</span>
  </div>
);

const ApiRow: React.FC<{ name: string; type: string; status: string; delay: string }> = ({ name, type, status, delay }) => (
  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-slate-100 transition-colors">
    <div className="flex items-center gap-4">
       <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
       <div>
          <p className="text-sm font-black text-slate-800">{name}</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{type}</p>
       </div>
    </div>
    <div className="flex gap-6 items-center">
       <span className="text-[9px] font-black text-slate-300 uppercase">{delay}</span>
       <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-200">{status}</span>
    </div>
  </div>
);

const RoadmapItem: React.FC<{ icon: string; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className="flex gap-4">
     <div className="w-10 h-10 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center shrink-0">
        <i className={`fas ${icon} text-sm`}></i>
     </div>
     <div>
        <p className="text-sm font-black italic mb-0.5">{title}</p>
        <p className="text-[11px] opacity-70 leading-relaxed">{desc}</p>
     </div>
  </div>
);

const AuditRow: React.FC<{ time: string; user: string; action: string; details: string }> = ({ time, user, action, details }) => (
  <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors">
    <div className="flex items-center gap-4">
       <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
       <div>
          <p className="text-sm font-black">{action}</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{details}</p>
       </div>
    </div>
    <div className="text-right">
       <p className="text-[9px] font-black text-slate-300 uppercase">{time}</p>
       <p className="text-[9px] font-black text-blue-400 uppercase">{user}</p>
    </div>
  </div>
);

export default ExecutiveSummary;
