
import React, { useState, useMemo } from 'react';
import { Permit, DecisionType } from '../types';
import { generateMarketingSummary } from '../services/geminiService';
import MunicipalityAvatar from './MunicipalityAvatar';

interface PermitTableProps {
  permits: Permit[];
  onSelect: (permit: Permit) => void;
}

const PermitTable: React.FC<PermitTableProps> = ({ permits, onSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDecision, setFilterDecision] = useState<DecisionType | 'ALL'>('ALL');
  const [filterMunicipality, setFilterMunicipality] = useState<string>('ALL');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{ text: string, sources: any[] } | null>(null);

  const municipalities = useMemo(() => 
    Array.from(new Set(permits.map(p => p.municipality))).sort(),
    [permits]
  );

  const filtered = useMemo(() => {
    return permits.filter(p => {
      const content = `${p.filename} ${p.property_id} ${p.municipality} ${p.applicant_company || ''}`.toLowerCase();
      const matchesSearch = content.includes(searchTerm.toLowerCase());
      const matchesDecision = filterDecision === 'ALL' || p.decision_type === filterDecision;
      const matchesMuni = filterMunicipality === 'ALL' || p.municipality === filterMunicipality;
      
      return matchesSearch && matchesDecision && matchesMuni;
    });
  }, [permits, searchTerm, filterDecision, filterMunicipality]);

  const handleGenerateSummary = async () => {
    if (filtered.length === 0) return;
    setIsGeneratingSummary(true);
    setSummaryData(null);
    try {
      const result = await generateMarketingSummary(filtered);
      setSummaryData(result);
    } catch (error) {
      console.error(error);
      setSummaryData({ text: "Kunde inte generera underlag.", sources: [] });
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter Header */}
      <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
               Fastighetsdatabas
               <span className="text-[10px] px-3 py-1 bg-green-50 text-green-600 rounded-full border border-green-100 font-black uppercase tracking-widest animate-pulse">
                 Live: 1577 Dokument
               </span>
            </h2>
            <p className="text-slate-400 text-xs font-medium mt-1 italic">Datan är synkroniserad från Outlook-importen (risk_data.db)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button 
              onClick={handleGenerateSummary}
              disabled={isGeneratingSummary || filtered.length === 0}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black transition-all shadow-xl shadow-indigo-600/20 flex items-center gap-3 disabled:opacity-50 active:scale-95"
            >
              {isGeneratingSummary ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-bullhorn"></i>}
              Skapa Marknadsunderlag
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2 relative">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
            <input 
              type="text" 
              placeholder="Sök sökande, fastighet, diarienummer..." 
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/10 outline-none transition-all focus:bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select 
            className="px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10"
            value={filterDecision}
            onChange={(e) => setFilterDecision(e.target.value as any)}
          >
            <option value="ALL">Alla beslut</option>
            <option value={DecisionType.BIFALL}>Bifall</option>
            <option value={DecisionType.AVSLAG}>Avslag</option>
          </select>
          <select 
            className="px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10"
            value={filterMunicipality}
            onChange={(e) => setFilterMunicipality(e.target.value)}
          >
            <option value="ALL">Alla kommuner</option>
            {municipalities.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Market Summary AI Output */}
      {summaryData && (
        <div className="bg-gradient-to-br from-indigo-900 to-blue-900 p-10 rounded-[3rem] text-white shadow-2xl animate-in fade-in slide-in-from-top-4 duration-500 border border-white/10">
          <div className="flex justify-between items-start mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/10 border border-white/20 rounded-2xl flex items-center justify-center">
                 <i className="fas fa-brain text-indigo-300"></i>
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight">AI Marknadsinsikt</h3>
                <p className="text-indigo-300 text-[10px] font-black uppercase tracking-[0.2em]">Baserad på din lokala data + Web Grounding</p>
              </div>
            </div>
            <button onClick={() => setSummaryData(null)} className="text-white/40 hover:text-white transition-colors">
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="prose prose-invert max-w-none text-sm leading-relaxed mb-8 font-medium">
             {summaryData.text}
          </div>
          {summaryData.sources.length > 0 && (
            <div className="pt-6 border-t border-white/10">
               <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-3">Verifierade Källor</p>
               <div className="flex flex-wrap gap-3">
                 {summaryData.sources.map((chunk: any, i: number) => (
                   chunk.web && (
                     <a 
                       key={i} 
                       href={chunk.web.uri} 
                       target="_blank" 
                       rel="noopener noreferrer"
                       className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] flex items-center gap-2 transition-all"
                     >
                       <i className="fas fa-external-link-alt text-[8px] text-indigo-400"></i>
                       {chunk.web.title || "Källa"}
                     </a>
                   )
                 ))}
               </div>
            </div>
          )}
        </div>
      )}

      {/* Main Table Content */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/50 text-slate-400 text-[10px] uppercase font-black tracking-[0.2em]">
              <tr>
                <th className="px-8 py-6">Sökande Bolag</th>
                <th className="px-8 py-6">Fastighet / Kommun</th>
                <th className="px-8 py-6">Beslut</th>
                <th className="px-8 py-6">Datum</th>
                <th className="px-8 py-6 text-right">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((permit) => (
                <tr key={permit.id} className="hover:bg-slate-50/80 transition-all group cursor-pointer" onClick={() => onSelect(permit)}>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-blue-600 shadow-sm group-hover:shadow-md transition-all">
                        <i className="fas fa-building text-xs"></i>
                      </div>
                      <div>
                        <span className="font-black text-slate-900 block tracking-tight">{permit.applicant_company || 'Ej angivet'}</span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase">SHA: {permit.checksum.substring(7, 13)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <MunicipalityAvatar name={permit.municipality} size="md" />
                      <div>
                        <span className="font-black text-slate-700 block tracking-tight">{permit.property_id}</span>
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{permit.municipality}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                      permit.decision_type === DecisionType.BIFALL ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                      permit.decision_type === DecisionType.AVSLAG ? 'bg-rose-50 text-rose-700 border-rose-100' :
                      'bg-slate-100 text-slate-700 border-slate-200'
                    }`}>
                      {permit.decision_type}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-slate-400 font-bold tabular-nums">{permit.received_date}</td>
                  <td className="px-8 py-5 text-right">
                    <button 
                      className="w-12 h-12 rounded-2xl bg-white border border-slate-200 shadow-sm text-slate-400 group-hover:text-blue-600 group-hover:border-blue-200 transition-all active:scale-90 flex items-center justify-center mx-auto"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-20 text-center">
             <i className="fas fa-search text-slate-100 text-6xl mb-4"></i>
             <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Inga ärenden matchar din sökning</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PermitTable;
