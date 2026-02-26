
import React, { useState } from 'react';
import MapView from './MapView';
import { Permit, WasteCode } from '../types';
import WeatherRisk from './WeatherRisk';
import { WASTE_CODES } from '../constants';

interface PermitPortalViewProps {
  permits: Permit[];
  mode?: 'map' | 'apply';
}

const PermitPortalView: React.FC<PermitPortalViewProps> = ({ permits, mode = 'map' }) => {
  const [selectedMuni, setSelectedMuni] = useState('Haninge');
  const [selectedCode, setSelectedCode] = useState<WasteCode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCodes = WASTE_CODES.filter(c => 
    c.code.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (mode === 'apply') {
    return (
      <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Smart Code Selector */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 text-xl">
                <i className="fas fa-barcode"></i>
              </div>
              <div>
                <h3 className="text-xl font-black italic uppercase tracking-tight">Smart Kodväljare</h3>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">SNI & EWC Register</p>
              </div>
            </div>

            <div className="relative mb-6">
              <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
              <input 
                type="text" 
                placeholder="Sök kod eller verksamhet..."
                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {filteredCodes.map(code => (
                <button 
                  key={code.code}
                  onClick={() => setSelectedCode(code)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    selectedCode?.code === code.code 
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200' 
                      : 'bg-white border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                      selectedCode?.code === code.code ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {code.type}
                    </span>
                    <span className="font-mono text-sm font-bold">{code.code}</span>
                  </div>
                  <p className="text-sm font-bold leading-tight">{code.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* RAG Output - Checklist */}
          <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 text-8xl rotate-12">
              <i className="fas fa-robot"></i>
            </div>

            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center text-white text-xl">
                  <i className="fas fa-microchip"></i>
                </div>
                <div>
                  <h3 className="text-xl font-black italic uppercase tracking-tight">Kravmatchning (RAG)</h3>
                  <p className="text-blue-400 text-[10px] font-black uppercase tracking-widest">AI-Analys av 1500+ Beslut</p>
                </div>
              </div>

              {selectedCode ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                  <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <i className="fas fa-list-check"></i> Checklista för regelefterlevnad
                    </h4>
                    <div className="space-y-4">
                      <ChecklistItem 
                        label="Lagringstid" 
                        value={selectedCode.requirements.storageTime || 'Ej specificerat'} 
                        refLink={selectedCode.requirements.legalReference}
                      />
                      <ChecklistItem 
                        label="Maxmängd" 
                        value={selectedCode.requirements.maxAmount || 'Ej begränsad'} 
                        refLink={selectedCode.requirements.legalReference}
                      />
                      <ChecklistItem 
                        label="Skyddsavstånd" 
                        value={selectedCode.requirements.safetyDistance || 'Standardkrav'} 
                        refLink={selectedCode.requirements.legalReference}
                      />
                    </div>
                  </div>

                  <div className="p-6 bg-blue-600/20 border border-blue-500/30 rounded-3xl">
                    <div className="flex items-center gap-3 mb-2">
                      <i className="fas fa-circle-info text-blue-400"></i>
                      <span className="text-xs font-black uppercase tracking-widest">AI-Insikt</span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed italic">
                      "För kod {selectedCode.code} i {selectedMuni} visar historiska data att 85% av alla bifall kräver en specifik invallningsplan vid närhet till vattenskyddsområden."
                    </p>
                  </div>

                  <button className="w-full py-4 bg-white text-slate-900 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-50 transition-all flex items-center justify-center gap-2">
                    <i className="fas fa-file-pen"></i> Generera Ansökningsutkast
                  </button>
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-center px-10">
                  <i className="fas fa-arrow-left text-4xl mb-4 animate-bounce"></i>
                  <p className="text-sm font-bold">Välj en verksamhetskod för att starta AI-analysen och generera checklistan.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-10">
      <WeatherRisk municipality={selectedMuni} />
      
      <div className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden h-[700px] relative">
         <MapView permits={permits} onSelectPermit={() => {}} />
      </div>

      <div className="bg-slate-900 p-10 rounded-[3rem] text-white flex items-center gap-10 shadow-2xl">
         <div className="w-20 h-20 bg-blue-500/20 border border-blue-500/30 rounded-3xl flex items-center justify-center text-3xl text-blue-400">
            <i className="fas fa-satellite-dish"></i>
         </div>
         <div className="flex-1">
            <h4 className="text-2xl font-black italic tracking-tighter">Spatial AI Engine v5.0 Active</h4>
            <p className="text-slate-400 text-sm mt-1 leading-relaxed">Systemet aggregerar nu realtidsdata från SMHI (Väder), SLU (Bio) och Lantmäteriet för att ge dig ett komplett beslutsunderlag på sekunder.</p>
         </div>
         <button className="px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
            Exportera Spatial Audit
         </button>
      </div>
    </div>
  );
};

const ChecklistItem: React.FC<{ label: string; value: string; refLink: string }> = ({ label, value, refLink }) => (
  <div className="group relative">
    <div className="flex justify-between items-center py-2 border-b border-white/5">
      <span className="text-slate-400 text-xs font-bold">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-black text-white">{value}</span>
        <a 
          href="#" 
          onClick={(e) => e.preventDefault()}
          className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-[10px] text-blue-400 hover:bg-blue-500 hover:text-white transition-all"
          title={refLink}
        >
          <i className="fas fa-link"></i>
        </a>
      </div>
    </div>
    <div className="absolute left-0 -top-12 hidden group-hover:block z-20 bg-white text-slate-900 p-3 rounded-xl shadow-2xl text-[10px] font-bold w-64 border border-slate-200">
      <p className="mb-1 text-blue-600 uppercase tracking-widest font-black">Källhänvisning:</p>
      {refLink}
    </div>
  </div>
);

export default PermitPortalView;
