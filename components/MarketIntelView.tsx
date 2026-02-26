
import React, { useState } from 'react';
import StatsOverview from './StatsOverview';
import PermitTable from './PermitTable';
import MapView from './MapView';
import MarketingHub from './MarketingHub';
import { Permit, Receiver, WasteCode } from '../types';
import { MOCK_RECEIVERS, WASTE_CODES } from '../constants';

interface MarketIntelViewProps {
  permits: Permit[];
  onSelectPermit: (permit: Permit) => void;
  mode?: 'archive' | 'logistics';
}

const MarketIntelView: React.FC<MarketIntelViewProps> = ({ permits, onSelectPermit, mode = 'archive' }) => {
  const [selectedWasteCode, setSelectedWasteCode] = useState<WasteCode | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<Receiver | null>(null);
  const [massAmount, setMassAmount] = useState<number>(0);
  const [isBooking, setIsBooking] = useState(false);

  const stats = {
    total: permits.length,
    bifall: permits.filter(p => p.decision_type === 'BIFALL').length,
    avslag: permits.filter(p => p.decision_type === 'AVSLAG').length,
    municipalities: new Set(permits.map(p => p.municipality)).size
  };

  if (mode === 'logistics') {
    const isCompatible = selectedReceiver && selectedWasteCode && selectedReceiver.allowedCodes.includes(selectedWasteCode.code);
    const distance = 12.5; // Mock distance
    const co2 = massAmount * distance * 0.12; // Mock CO2 calc

    return (
      <div className="animate-in fade-in duration-500 space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Logistics Controls */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
              <h3 className="text-xl font-black italic uppercase tracking-tight mb-6">Mass-Matchning</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Avfallskod (EWC)</label>
                  <select 
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    onChange={(e) => setSelectedWasteCode(WASTE_CODES.find(c => c.code === e.target.value) || null)}
                  >
                    <option value="">Välj kod...</option>
                    {WASTE_CODES.filter(c => c.type === 'EWC').map(c => (
                      <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Mängd (Ton)</label>
                  <input 
                    type="number" 
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="T.ex. 500"
                    onChange={(e) => setMassAmount(Number(e.target.value))}
                  />
                </div>

                {selectedWasteCode && (
                  <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                    <p className="text-[10px] font-black text-blue-600 uppercase mb-1">Krav för {selectedWasteCode.code}:</p>
                    <p className="text-xs font-bold text-slate-700">{selectedWasteCode.requirements.storageTime}</p>
                  </div>
                )}
              </div>
            </div>

            {selectedReceiver && (
              <div className={`p-8 rounded-[2.5rem] border shadow-lg transition-all ${
                isCompatible ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${
                    isCompatible ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                  }`}>
                    <i className={`fas ${isCompatible ? 'fa-check-circle' : 'fa-triangle-exclamation'}`}></i>
                  </div>
                  <div>
                    <h4 className={`font-black uppercase tracking-tight ${isCompatible ? 'text-emerald-900' : 'text-red-900'}`}>
                      {isCompatible ? 'Matchning Godkänd' : 'VARNING: EJ TILLÅTET'}
                    </h4>
                    <p className={`text-[10px] font-bold uppercase ${isCompatible ? 'text-emerald-600' : 'text-red-600'}`}>
                      Compliance Check
                    </p>
                  </div>
                </div>
                {!isCompatible && (
                  <p className="text-xs font-bold text-red-700 leading-relaxed">
                    Denna anläggning ({selectedReceiver.name}) saknar tillstånd för avfallskod {selectedWasteCode?.code}. Transport får ej bokas.
                  </p>
                )}
                {isCompatible && (
                  <div className="space-y-3 mt-4">
                    <div className="flex justify-between text-xs font-bold text-emerald-800">
                      <span>Avstånd:</span>
                      <span>{distance} km</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-emerald-800">
                      <span>Ruttoptimering:</span>
                      <span className="flex items-center gap-1 text-[10px]"><i className="fas fa-bolt text-yellow-500"></i> Aktiv</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-emerald-800">
                      <span>Est. CO2:</span>
                      <span>{co2.toFixed(1)} kg</span>
                    </div>
                    <button 
                      onClick={() => {
                        setIsBooking(true);
                        setTimeout(() => {
                          setIsBooking(false);
                          alert("Transport bokad! Digitalt vågkort och transportdokument har skickats till chauffören.");
                        }, 1500);
                      }}
                      disabled={isBooking}
                      className="w-full py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all mt-2 disabled:opacity-50"
                    >
                      {isBooking ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-truck mr-2"></i>}
                      {isBooking ? 'Genererar Vågkort...' : 'Boka Transport & Skapa Vågkort'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Map View */}
          <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden h-[600px] relative">
            <MapView 
              receivers={MOCK_RECEIVERS} 
              onSelectReceiver={setSelectedReceiver}
              selectedReceiverId={selectedReceiver?.id}
            />
            <div className="absolute bottom-6 left-6 right-6 bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 text-white flex items-center justify-between z-10">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                  <i className="fas fa-map-location-dot"></i>
                </div>
                <div>
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Interaktiv Mottagarkarta</p>
                  <p className="text-sm font-bold">{MOCK_RECEIVERS.length} godkända anläggningar i systemet</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <StatsOverview stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl">
          <h3 className="text-white font-black text-xs uppercase tracking-widest mb-6">Affärsutveckling (AI-Analys)</h3>
          <MarketingHub permits={permits} />
        </div>
        <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl h-[400px]">
          <MapView permits={permits} onSelectPermit={onSelectPermit} />
        </div>
      </div>
      <PermitTable permits={permits} onSelect={onSelectPermit} />
    </div>
  );
};

export default MarketIntelView;
