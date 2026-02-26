
import React, { useState, useMemo } from 'react';
import { classifyAsset } from '../services/geminiService';

interface Asset {
  id: string;
  url: string;
  category?: string;
  confidence?: number;
  status: 'pending' | 'reviewed' | 'trashed';
}

const AssetTriage: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>(
    Array.from({ length: 24 }).map((_, i) => ({
      id: `asset-${i}`,
      url: `https://picsum.photos/seed/${i + 500}/300/150`,
      status: 'pending'
    }))
  );
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'SIGNATUR' | 'KOMMUNVAPEN' | 'SKRÄP'>('ALL');
  const [progress, setProgress] = useState(0);

  const filteredAssets = useMemo(() => {
    if (activeFilter === 'ALL') return assets;
    return assets.filter(a => a.category === activeFilter);
  }, [assets, activeFilter]);

  const handleClassify = async (asset: Asset) => {
    // I verkligheten anropar vi classifyAsset i geminiService
    const mockCategories = ['KOMMUNVAPEN', 'SIGNATUR', 'STÄMPEL', 'RITNINGS_DEL', 'SKRÄP'];
    const randomCat = mockCategories[Math.floor(Math.random() * mockCategories.length)];
    
    setAssets(prev => prev.map(a => 
      a.id === asset.id ? { ...a, category: randomCat, confidence: 0.85 + Math.random() * 0.14 } : a
    ));
  };

  const processAll = async () => {
    setIsProcessing(true);
    setProgress(0);
    const total = assets.filter(a => !a.category).length;
    let count = 0;

    for (const asset of assets) {
      if (!asset.category) {
        await new Promise(r => setTimeout(r, 400)); // Simulera AI-latens
        handleClassify(asset);
        count++;
        setProgress(Math.round((count / total) * 100));
      }
    }
    setIsProcessing(false);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-2">
             <span className="px-2 py-0.5 bg-amber-100 text-amber-600 text-[10px] font-black uppercase rounded shadow-sm border border-amber-200">721 Filer i kö</span>
             <h2 className="text-3xl font-black text-slate-900 tracking-tight">Resurshantering & Triage</h2>
          </div>
          <p className="text-slate-500 text-sm">Automatisera granskningen av logotyper, signaturer och stämplar från dina 1577 dokument.</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <button 
            onClick={processAll}
            disabled={isProcessing}
            className="px-8 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-3"
          >
            {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-robot"></i>}
            {isProcessing ? `Bearbetar: ${progress}%` : "AI-Klassificera Alla"}
          </button>
          {isProcessing && (
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden border border-slate-200">
               <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        <FilterTab active={activeFilter === 'ALL'} onClick={() => setActiveFilter('ALL')} label="Alla fragment" count={assets.length} />
        <FilterTab active={activeFilter === 'SIGNATUR'} onClick={() => setActiveFilter('SIGNATUR')} label="Signaturer" count={assets.filter(a => a.category === 'SIGNATUR').length} />
        <FilterTab active={activeFilter === 'KOMMUNVAPEN'} onClick={() => setActiveFilter('KOMMUNVAPEN')} label="Kommunvapen" count={assets.filter(a => a.category === 'KOMMUNVAPEN').length} />
        <FilterTab active={activeFilter === 'SKRÄP'} onClick={() => setActiveFilter('SKRÄP')} label="Skräp" count={assets.filter(a => a.category === 'SKRÄP').length} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
        {filteredAssets.map((asset) => (
          <div key={asset.id} className="group relative bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm hover:shadow-2xl hover:border-blue-300 transition-all animate-in zoom-in duration-300">
            <div className="aspect-[3/2] bg-slate-50 flex items-center justify-center p-4 relative group-hover:bg-white transition-colors">
              <img src={asset.url} alt="Fragment" className="max-w-full max-h-full object-contain mix-blend-multiply drop-shadow-sm" />
              {asset.category === 'SIGNATUR' && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-[10px] shadow-lg animate-pulse">
                  <i className="fas fa-pen-nib"></i>
                </div>
              )}
            </div>
            
            <div className="p-4 bg-white border-t border-slate-50">
              {asset.category ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest ${
                      asset.category === 'SKRÄP' ? 'bg-slate-100 text-slate-400' :
                      asset.category === 'SIGNATUR' ? 'bg-amber-100 text-amber-700' :
                      'bg-indigo-100 text-indigo-700'
                    }`}>
                      {asset.category}
                    </span>
                    <span className="text-[10px] font-black text-slate-300">{(asset.confidence! * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 py-1.5 bg-slate-50 text-slate-400 hover:text-red-500 rounded-lg transition-colors border border-slate-100 hover:border-red-100">
                       <i className="fas fa-trash text-[10px]"></i>
                    </button>
                    <button className="flex-1 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg transition-all border border-blue-100">
                       <i className="fas fa-check text-[10px]"></i>
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => handleClassify(asset)}
                  className="w-full py-2.5 bg-slate-50 text-slate-400 text-[10px] font-black rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-all border border-dashed border-slate-200 hover:border-blue-200"
                >
                  KLASSIFICERA
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 p-10 rounded-[3rem] text-white flex flex-col md:flex-row items-center gap-10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
        <div className="w-20 h-20 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-3xl flex items-center justify-center shrink-0 shadow-inner">
          <i className="fas fa-microscope text-3xl"></i>
        </div>
        <div>
          <h4 className="text-2xl font-black mb-2 tracking-tight">Djupanalys av signaturer</h4>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xl">
            Genom att identifiera samma handskrivna signatur över flera dokument kan RiskGuard automatiskt mappa upp "Power Users" och nyckelkonsulter som driver flest ärenden i regionen.
          </p>
        </div>
        <button className="ml-auto px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-xs font-black uppercase tracking-widest transition-all">
          Exportera Metadata
        </button>
      </div>
    </div>
  );
};

const FilterTab: React.FC<{ active: boolean; onClick: () => void; label: string; count: number }> = ({ active, onClick, label, count }) => (
  <button 
    onClick={onClick}
    className={`px-5 py-2.5 rounded-full text-xs font-black transition-all flex items-center gap-3 border ${
      active 
      ? 'bg-slate-900 text-white border-slate-900 shadow-lg' 
      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
    }`}
  >
    {label}
    <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
      {count}
    </span>
  </button>
);

export default AssetTriage;
