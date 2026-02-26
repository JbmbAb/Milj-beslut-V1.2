
import React, { useState } from 'react';
import { performSpatialAudit } from '../services/geminiService';

const ApplicationWizard: React.FC = () => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string[]>([]);
  const [auditResult, setAuditResult] = useState<{ text: string, sources: any[] } | null>(null);

  const steps = [
    { id: 1, title: 'Legitimering', icon: 'fa-fingerprint' },
    { id: 2, title: 'Spatial Analys', icon: 'fa-location-crosshairs' },
    { id: 3, title: 'Projektparametrar', icon: 'fa-cubes' },
    { id: 4, title: 'Granskning & Signering', icon: 'fa-signature' }
  ];

  const runFullSpatialAudit = async () => {
    setLoading(true);
    setAnalysisStatus(["Kopplar upp mot Lantmäteriet..."]);
    
    // Simulerade steg för visuell feedback
    const checks = [
      "Hämtar Fornlämningar (RAÄ)...",
      "Kontrollerar Översvämningsrisk (SMHI)...",
      "Kör Google Maps Grounding Audit...",
      "Beräknar närhet till transportvägar...",
      "Matchar mot praxis_db..."
    ];

    for (const check of checks) {
      await new Promise(r => setTimeout(r, 600));
      setAnalysisStatus(prev => [...prev, check]);
    }

    try {
      // Vi simulerar koordinater för en punkt i Stockholmsområdet
      const result = await performSpatialAudit(59.3293, 18.0686);
      setAuditResult(result);
      setStep(3);
    } catch (e) {
      console.error(e);
      setStep(3);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
      {/* Step Tracker */}
      <div className="flex items-center justify-between px-10 relative">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-200 -z-10 -translate-y-1/2 rounded-full"></div>
        <div className="absolute top-1/2 left-0 h-1 bg-emerald-500 -z-10 -translate-y-1/2 rounded-full transition-all duration-500" style={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }}></div>
        {steps.map((s) => (
          <div key={s.id} className="flex flex-col items-center gap-3">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all border-4 ${step >= s.id ? 'bg-emerald-600 border-emerald-100 text-white shadow-xl rotate-3' : 'bg-white border-slate-100 text-slate-300'}`}>
              <i className={`fas ${s.icon} text-lg`}></i>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${step >= s.id ? 'text-emerald-700' : 'text-slate-400'}`}>{s.title}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-[3rem] border border-slate-200 shadow-2xl overflow-hidden min-h-[600px] flex flex-col">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-20 bg-slate-50/50">
             <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-10"></div>
             <div className="space-y-3 w-full max-w-sm">
                {analysisStatus.map((text, idx) => (
                  <div key={idx} className="flex items-center gap-4 animate-in fade-in slide-in-from-left-2 duration-200">
                     <i className="fas fa-check-circle text-emerald-500 text-xs"></i>
                     <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{text}</p>
                  </div>
                ))}
             </div>
          </div>
        ) : (
          <>
            {step === 1 && (
              <div className="p-20 text-center flex-1 flex flex-col justify-center">
                 <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
                    <i className="fas fa-bank text-4xl"></i>
                 </div>
                 <h3 className="text-3xl font-black text-slate-900 tracking-tighter mb-4 italic">Myndighetsidentifiering</h3>
                 <p className="text-slate-500 mb-10 max-w-sm mx-auto font-medium">Vi kopplar upp din profil mot Bolagsverket och verifierar firmatecknare.</p>
                 <button onClick={() => setStep(2)} className="px-10 py-5 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-4 mx-auto group">
                    Signera med BankID <i className="fas fa-chevron-right group-hover:translate-x-1 transition-transform"></i>
                 </button>
              </div>
            )}

            {step === 2 && (
              <div className="flex-1 flex flex-col">
                <div className="p-10 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                   <div>
                     <h3 className="text-2xl font-black text-slate-900 tracking-tighter italic">Välj Projektplats</h3>
                     <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Vi utför spatial audit mot 9 nationella källor.</p>
                   </div>
                   <div className="flex gap-2">
                      <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[9px] font-black uppercase text-emerald-600 tracking-widest flex items-center gap-2"><i className="fas fa-circle text-[6px]"></i> RAÄ Aktiv</span>
                      <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[9px] font-black uppercase text-blue-600 tracking-widest flex items-center gap-2"><i className="fas fa-circle text-[6px]"></i> SMHI Aktiv</span>
                   </div>
                </div>
                <div className="flex-1 bg-slate-100 relative group cursor-crosshair">
                   <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center animate-bounce">
                         <i className="fas fa-map-pin text-rose-500 text-6xl drop-shadow-2xl"></i>
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-800 mt-2">Placera projekt</p>
                      </div>
                   </div>
                   <div className="absolute top-6 right-6 w-56 bg-white/90 backdrop-blur-md p-5 rounded-3xl shadow-xl border border-white/50 space-y-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Sensing Layers</p>
                      <SourceItem label="Fornlämningar (WMS)" active />
                      <SourceItem label="Klimatrisk 100-år" active />
                      <SourceItem label="Google Maps Logistik" active />
                   </div>
                </div>
                <div className="p-8 bg-white border-t border-slate-100 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Spatial Engine v4.0 Redo</span>
                   </div>
                   <button onClick={runFullSpatialAudit} className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-emerald-700 transition-all">Starta Fullständig Audit</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-12 space-y-10 flex-1 overflow-y-auto custom-scrollbar">
                 <header className="flex justify-between items-start">
                    <div>
                      <h3 className="text-3xl font-black text-slate-900 tracking-tighter italic">Audit-resultat: Kritisk Nivå</h3>
                      <p className="text-slate-500 mt-1 font-medium italic">Baserat på spatial intersection mot nationella register.</p>
                    </div>
                    <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-center min-w-[120px]">
                       <p className="text-[9px] font-black text-rose-600 uppercase tracking-widest mb-1">Riskvärde</p>
                       <p className="text-2xl font-black text-rose-700">74 / 100</p>
                    </div>
                 </header>
                 
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <AuditCard title="Arkeologi (RAÄ)" status="Varning" icon="fa-monument" color="amber" desc="Hittat fornlämning inom 50m radie. Kräver arkeologisk kontroll." />
                    <AuditCard title="Klimat (SMHI)" status="Låg Risk" icon="fa-water" color="emerald" desc="Ej beläget i 100-års flödeszon för vattendrag." />
                    <AuditCard title="Natur (NV)" status="Kritisk" icon="fa-leaf" color="rose" desc="Överlappar Natura 2000-område. Särskilt tillstånd krävs." />
                 </div>

                 {auditResult && (
                   <div className="bg-indigo-50 p-8 rounded-[2rem] border border-indigo-100">
                      <h4 className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-4 flex items-center gap-2">
                         <i className="fas fa-location-dot"></i> Google Maps Proximity Audit
                      </h4>
                      <p className="text-sm font-medium text-slate-700 leading-relaxed italic mb-4">
                        {auditResult.text}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {auditResult.sources.map((s, i) => s.web && (
                          <a key={i} href={s.web.uri} target="_blank" className="px-3 py-1 bg-white border border-indigo-100 rounded-lg text-[9px] font-black text-indigo-500 uppercase flex items-center gap-2"><i className="fas fa-external-link-alt text-[8px]"></i> {s.web.title}</a>
                        ))}
                      </div>
                   </div>
                 )}

                 <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
                    <button onClick={() => setStep(2)} className="text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-600">Gör om analys</button>
                    <button onClick={() => setStep(4)} className="px-10 py-5 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-emerald-700 transition-all">Skapa Slutlig Handling</button>
                 </div>
              </div>
            )}

            {step === 4 && (
              <div className="p-20 text-center flex-1 flex flex-col justify-center">
                 <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
                    <i className="fas fa-file-signature text-5xl"></i>
                 </div>
                 <h3 className="text-3xl font-black text-slate-900 tracking-tighter mb-4 italic">Redo för E-Signering.</h3>
                 <p className="text-slate-500 mb-12 max-w-sm mx-auto font-medium">Samtliga spatiala analyser och riskintyg har inkluderats i PDF-underlaget.</p>
                 <div className="flex gap-4 max-w-sm mx-auto w-full">
                    <button className="flex-1 p-5 bg-slate-100 text-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest">Förhandsgranska</button>
                    <button className="flex-1 p-5 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-emerald-600/20">Signera & Skicka</button>
                 </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const AuditCard: React.FC<{ title: string; status: string; icon: string; color: string; desc: string }> = ({ title, status, icon, color, desc }) => (
  <div className={`p-6 rounded-[2rem] bg-${color}-50 border border-${color}-100 flex flex-col justify-between h-full shadow-sm`}>
    <div className="flex items-center justify-between mb-4">
       <div className={`w-10 h-10 bg-white rounded-xl flex items-center justify-center text-${color}-600 shadow-sm`}><i className={`fas ${icon}`}></i></div>
       <span className={`text-[8px] font-black px-2 py-0.5 rounded-md uppercase tracking-tighter bg-${color}-100 text-${color}-700`}>{status}</span>
    </div>
    <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-2">{title}</h4>
    <p className="text-[11px] font-medium text-slate-600 leading-relaxed italic">{desc}</p>
  </div>
);

const SourceItem: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <div className="flex items-center gap-3">
    <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
    <span className="text-[10px] font-bold text-slate-600">{label}</span>
  </div>
);

export default ApplicationWizard;
