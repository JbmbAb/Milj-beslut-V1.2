
import React from 'react';
import { INTEGRATION_SOURCES } from '../constants';

const IntegrationsDashboard: React.FC = () => {
  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-700">
      <header>
        <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic text-shadow-sm">Systemarkitektur & API:er.</h2>
        <p className="text-slate-500 mt-2 font-medium">RiskGuard aggregerar nu {INTEGRATION_SOURCES.length} nationella källor i realtid.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {INTEGRATION_SOURCES.map((integ) => (
          <div key={integ.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden">
            <div className={`absolute top-6 right-6 text-[8px] font-black px-2 py-1 rounded-md uppercase tracking-tighter ${
              integ.status === 'CONNECTED' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}>
              {integ.status === 'CONNECTED' ? 'Aktiv' : 'Fel'}
            </div>
            
            <div className="w-14 h-14 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-slate-900 group-hover:text-white transition-all">
               <i className={`fas ${
                 integ.provider.includes('Lantmäteriet') ? 'fa-map' :
                 integ.provider.includes('Naturvårdsverket') ? 'fa-leaf' :
                 integ.provider.includes('SGU') ? 'fa-mountain' :
                 integ.provider.includes('Riksantikvarieämbetet') ? 'fa-monument' :
                 integ.provider.includes('MSB') ? 'fa-water' :
                 integ.provider.includes('SLU') ? 'fa-bugs' :
                 integ.provider.includes('Bolagsverket') ? 'fa-fingerprint' :
                 integ.provider.includes('SMHI') ? 'fa-cloud-bolt' : 'fa-network-wired'
               } text-2xl`}></i>
            </div>
            
            <h3 className="text-xl font-black text-slate-900 mb-1 tracking-tight italic">{integ.name}</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{integ.provider}</p>
            
            <div className="space-y-3">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Data som hämtas</p>
                <p className="text-xs text-slate-600 leading-relaxed italic">{integ.dataType}</p>
              </div>
              <div className="flex justify-between items-center px-2">
                <span className="text-[9px] font-black text-slate-300 uppercase">Komplexitet: {integ.complexity}/5</span>
                <span className="text-[9px] font-black text-slate-300 uppercase">Sync: {integ.lastSync}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-indigo-900 p-12 rounded-[3rem] text-white flex flex-col md:flex-row items-center gap-10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20"></div>
        <div className="flex-1 space-y-6">
          <h3 className="text-3xl font-black italic tracking-tighter">Spatial Audit Engine (Grounding)</h3>
          <p className="text-indigo-200 leading-relaxed">
            Vi har nu implementerat fullt stöd för <strong>Google Maps Grounding</strong>. Det innebär att AI:n inte bara läser dina dokument, utan även korsrefererar dem mot verkliga platser, avstånd och intressepunkter för att validera ansökningar.
          </p>
          <div className="flex gap-3">
             <div className="px-4 py-2 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10">v4.2.0 Stable</div>
             <div className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-500/20">Latency: 45ms</div>
          </div>
        </div>
        <div className="w-48 h-48 bg-white/10 rounded-full flex items-center justify-center border border-white/20">
           <i className="fas fa-network-wired text-5xl text-blue-400 animate-pulse"></i>
        </div>
      </div>
    </div>
  );
};

export default IntegrationsDashboard;
