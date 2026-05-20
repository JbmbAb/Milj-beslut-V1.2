import React, { useState } from 'react';
import { Permit } from '../types';
import { generateMarketingSummary } from '../services/geminiService';

interface MarketingHubProps {
  permits: Permit[];
  fullView?: boolean;
}

const MarketingHub: React.FC<MarketingHubProps> = ({ permits, fullView }) => {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ text: string; sources: any[] } | null>(null);

  const handleAnalysis = async () => {
    setLoading(true);
    try {
      const result = await generateMarketingSummary(permits);
      setSummary(result);
    } catch (err) {
      console.error(err);
      setSummary({
        text: 'Marknadsanalys saknar verifierad extern kalla. Konfigurera en livekalla innan rapporten anvands.',
        sources: [],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {!summary && !loading && (
        <div className="text-center py-12 flex-1 flex flex-col justify-center">
          <i className="fas fa-magnifying-glass-chart text-5xl text-indigo-500/20 mb-6"></i>
          <h4 className="text-indigo-200 font-black text-lg mb-2">Generera Affärsinsikt</h4>
          <p className="text-slate-500 text-sm max-w-xs mx-auto mb-8">
            Vi kor endast analys nar verifierade kallor svarar.
          </p>
          <button
            onClick={handleAnalysis}
            className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all mx-auto active:scale-95"
          >
            Kör Trend-motor
          </button>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-black text-indigo-400 uppercase tracking-widest animate-pulse">
            Kontrollerar verifierade kallor...
          </p>
        </div>
      )}

      {summary && (
        <div
          className={`animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col ${fullView ? 'bg-slate-900 p-10 rounded-[3rem]' : ''}`}
        >
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-indigo-400 font-black text-xs uppercase tracking-[0.2em]">
              Marknadsrapport: Genererad Nu
            </h4>
            <button
              onClick={() => setSummary(null)}
              className="text-slate-600 hover:text-indigo-400 transition-colors"
            >
              <i className="fas fa-rotate-left"></i>
            </button>
          </div>
          <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed italic mb-8 border-l-2 border-indigo-500/30 pl-6">
            {summary.text}
          </div>
          {summary.sources.length > 0 && (
            <div className="space-y-3">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                Web Grounding Källor
              </p>
              <div className="flex flex-wrap gap-2">
                {summary.sources.map(
                  (s, i) =>
                    s.web && (
                      <a
                        key={i}
                        href={s.web.uri}
                        target="_blank"
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[10px] text-indigo-400 flex items-center gap-2"
                      >
                        <i className="fas fa-external-link-alt text-[8px]"></i> {s.web.title || 'Referens'}
                      </a>
                    ),
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketingHub;
