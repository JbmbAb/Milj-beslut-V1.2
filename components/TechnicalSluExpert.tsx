import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { analyzeBiodiversity } from '../services/geminiService';
import type { SpeciesObservation } from '../types';
import type { ProtectedArea } from '../server/services/nvrService';
import type { GeologicalData } from '../server/services/sguService';
import type { Monument } from '../server/services/raaService';
import type { SiteAnalysis } from '../server/services/complianceRuleEngine';
import {
  Bug,
  Search,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  MapPin,
  Waves,
  Mountain,
  Gavel,
  Landmark,
} from 'lucide-react';

export const TechnicalSluExpert: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const [data, setData] = useState<{
    summary: string;
    observations: SpeciesObservation[];
    protectedAreas: ProtectedArea[];
    geological?: GeologicalData;
    monuments?: Monument[];
    compliance?: SiteAnalysis;
  } | null>(null);

  const handleScan = async () => {
    setLoading(true);
    try {
      const numericLat = Number.parseFloat(lat);
      const numericLng = Number.parseFloat(lng);
      if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
        setData({
          summary: 'Ange verifierade koordinater innan SLU-kontroll koras.',
          observations: [],
          protectedAreas: [],
        });
        return;
      }

      const result = await analyzeBiodiversity(numericLat, numericLng);
      setData(result);
    } catch (e) {
      console.error(e);
      setData({
        summary: 'SLU-kontroll saknar verifierad kalla. Konfigurera livekalla innan resultat anvands.',
        observations: [],
        protectedAreas: [],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-12 p-8 rounded-[32px] bg-[#0F0F11] border border-white/5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-[100px]" />

      <div className="relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <Bug size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold font-['Outfit']">SLU Artdatabanken Scan</h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#475569]">
                Kontroll mot rödlistade arter & biotopskydd
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Position</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-24 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500/50 transition-colors"
                placeholder="Lat"
              />
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="w-24 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500/50 transition-colors"
                placeholder="Lng"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleScan}
              disabled={loading}
              className={`px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center gap-2 transition-all duration-300 shadow-xl ${
                loading
                  ? 'bg-white/5 text-slate-500 border border-white/5'
                  : 'bg-white text-black hover:bg-emerald-500 hover:text-white shadow-white/5'
              }`}
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
              {loading ? 'Analyserar...' : 'Starta Scan'}
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-16 text-center space-y-4"
            >
              <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto" />
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest animate-pulse">
                Söker i Artportalen & Natura 2000-register...
              </p>
            </motion.div>
          )}

          {data && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-2 space-y-4">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <CheckCircle2 size={12} className="text-emerald-500" /> AI-Sammanfattning
                </h4>
                <div className="p-6 bg-white/5 rounded-2xl border border-white/5 italic text-sm text-slate-300 leading-relaxed">
                  {data.summary}
                </div>

                {data.geological && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-5 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
                      <div className="flex items-center gap-3 mb-3">
                        <Mountain size={18} className="text-amber-500" />
                        <h5 className="text-xs font-black uppercase tracking-widest text-amber-500/80">
                          Geologi
                        </h5>
                      </div>
                      <p className="text-sm font-bold text-slate-200">{data.geological.soilType}</p>
                      <p className="text-[10px] text-slate-500 mt-1 uppercase font-medium">
                        Huvudsaklig jordart
                      </p>
                    </div>
                    <div className="p-5 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
                      <div className="flex items-center gap-3 mb-3">
                        <Waves size={18} className="text-blue-500" />
                        <h5 className="text-xs font-black uppercase tracking-widest text-blue-500/80">
                          Grundvatten
                        </h5>
                      </div>
                      <p className="text-sm font-bold text-slate-200">
                        {data.geological.groundwaterVulnerability}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1 uppercase font-medium">Sårbarhetsklass</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Gavel size={12} className="text-amber-500" /> Bedömning MB
                </h4>

                {data.compliance && (
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/5 space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                          Riskklassning
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xl font-black font-['Outfit'] ${
                              data.compliance.overallRisk === 'BLOCK'
                                ? 'text-rose-500'
                                : data.compliance.overallRisk === 'HIGH'
                                  ? 'text-orange-500'
                                  : data.compliance.overallRisk === 'MEDIUM'
                                    ? 'text-amber-400'
                                    : 'text-emerald-500'
                            }`}
                          >
                            {data.compliance.overallRisk}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                          Tillståndschans
                        </p>
                        <p className="text-xl font-black text-white font-['Outfit']">
                          {Math.round(data.compliance.permitProbability * 100)}%
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {data.compliance.rules.map((rule, i) => (
                        <div key={i} className="flex gap-3 items-start">
                          <div
                            className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                              rule.risk === 'BLOCK'
                                ? 'bg-rose-500'
                                : rule.risk === 'HIGH'
                                  ? 'bg-orange-500'
                                  : 'bg-amber-500'
                            }`}
                          />
                          <div>
                            <p className="text-[11px] font-bold text-slate-300">{rule.title}</p>
                            <p className="text-[9px] text-slate-500 italic mt-0.5">{rule.recommendation}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 pt-4">
                    <ShieldAlert size={12} className="text-rose-500" /> Arter & Skydd
                  </h4>
                  {data.observations.map((obs, i) => (
                    <div
                      key={`obs-${i}`}
                      className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl group hover:bg-white/10 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-200">{obs.name}</p>
                        <p className="text-[9px] font-medium text-slate-600 uppercase">
                          {obs.distance}m från centrum
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase ${
                          obs.status.includes('Röd')
                            ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                            : obs.status.includes('Frid')
                              ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                        }`}
                      >
                        {obs.status}
                      </span>
                    </div>
                  ))}

                  {data.protectedAreas.map((area, i) => (
                    <div
                      key={`area-${i}`}
                      className="flex items-center justify-between p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl group hover:bg-indigo-500/10 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-bold text-indigo-200">{area.name}</p>
                        <p className="text-[9px] font-medium text-indigo-400 uppercase">{area.type}</p>
                      </div>
                      <MapPin size={14} className="text-indigo-500" />
                    </div>
                  ))}

                  {data.monuments?.map((mon, i) => (
                    <div
                      key={`mon-${i}`}
                      className="flex items-center justify-between p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl group hover:bg-amber-500/10 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-bold text-amber-200">{mon.name}</p>
                        <p className="text-[9px] font-medium text-amber-500 uppercase">{mon.type}</p>
                      </div>
                      <Landmark size={14} className="text-amber-500" />
                    </div>
                  ))}

                  {data.observations.length === 0 &&
                    data.protectedAreas.length === 0 &&
                    data.monuments?.length === 0 && (
                      <p className="text-xs text-slate-600 italic p-4">
                        Inga restriktioner funna i närområdet.
                      </p>
                    )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
