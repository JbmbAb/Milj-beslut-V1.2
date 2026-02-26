
import React, { useState, useEffect } from 'react';
import { predictWeatherRisk } from '../services/geminiService';
import { WeatherRisk as WeatherRiskType } from '../types';

const WeatherRisk: React.FC<{ municipality: string }> = ({ municipality }) => {
  const [risk, setRisk] = useState<WeatherRiskType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await predictWeatherRisk(municipality);
        setRisk(result);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [municipality]);

  if (loading) return (
    <div className="bg-slate-900 p-8 rounded-[2.5rem] flex items-center justify-center">
       <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className={`p-8 rounded-[2.5rem] border shadow-2xl transition-all duration-500 flex items-center gap-8 ${
      risk?.level === 'Hög' ? 'bg-rose-950 border-rose-800' :
      risk?.level === 'Medel' ? 'bg-amber-950 border-amber-800' : 'bg-slate-900 border-slate-800'
    }`}>
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-inner ${
        risk?.level === 'Hög' ? 'bg-rose-500 text-white' :
        risk?.level === 'Medel' ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
      }`}>
        <i className={`fas ${risk?.level === 'Hög' ? 'fa-cloud-showers-heavy' : 'fa-cloud-sun'}`}></i>
      </div>
      <div className="flex-1">
         <div className="flex items-center gap-3 mb-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">SMHI Prediktion</span>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
              risk?.level === 'Hög' ? 'bg-rose-500 text-white' : 'text-slate-400 border border-slate-700'
            }`}>Risk: {risk?.level}</span>
         </div>
         <h4 className="text-xl font-black text-white italic tracking-tight">Väderpåverkan vid Schakt</h4>
         <p className="text-slate-400 text-xs mt-2 leading-relaxed">{risk?.description}</p>
         <div className="mt-4 flex items-center gap-2 text-blue-400 text-[10px] font-black uppercase tracking-widest">
            <i className="fas fa-hand-holding-medical"></i> Rekommendation: {risk?.action}
         </div>
      </div>
    </div>
  );
};

export default WeatherRisk;
