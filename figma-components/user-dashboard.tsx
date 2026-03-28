import React from 'react';

export type UserDashboardProps = {
  title?: string;
  className?: string;
  // Pass in real data from the loader
  data?: {
    completion?: any;
    graphStats?: any;
    risks?: any[];
  };
};

export default function UserDashboard({ title = 'Dashboard Flow', className, data }: UserDashboardProps) {
  // If no data, use a subtle skeleton/shimmer instead of "FAKE" text
  const completion = data?.completion || { donePercent: 0, categories: [] };
  const graphStats = data?.graphStats || { totalNodes: 0, totalEdges: 0 };

  return (
    <section className={`glass-strong rounded-3xl border border-white/10 p-8 shadow-glow ${className ?? ''}`.trim()}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-black text-white font-display tracking-tight">{title}</h2>
          <p className="text-white/40 text-sm font-medium mt-1">Aktuell status frÃ¥n Kunskapsgraf & SGU</p>
        </div>
        <div className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-[10px] text-indigo-300 font-bold uppercase tracking-widest">
          Live Analys
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Knowledge Insights Card */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/5 group hover:border-white/20 transition-all">
          <div className="flex items-center gap-3 mb-4">
             <span className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">🧠</span>
             <h3 className="font-bold text-white">Kunskapsgraf</h3>
          </div>
          <div className="space-y-3">
             <div className="flex justify-between text-xs text-white/60">
                <span>Noder (Lagar/Regler)</span>
                <span className="font-mono text-white">{graphStats.totalNodes}</span>
             </div>
             <div className="flex justify-between text-xs text-white/60">
                <span>Relationer (Logik)</span>
                <span className="font-mono text-white">{graphStats.totalEdges}</span>
             </div>
             <div className="mt-4 pt-4 border-t border-white/5 text-[10px] text-white/30 italic">
                Automatisk koppling till MiljÃ¶balken 2:3 & SGU Risk
             </div>
          </div>
        </div>

        {/* Project Compliance Card */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/5 group hover:border-white/20 transition-all">
          <div className="flex items-center gap-3 mb-4">
             <span className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">⚖️</span>
             <h3 className="font-bold text-white">Efterlevnad</h3>
          </div>
          <div className="space-y-4">
             <div className="flex items-center justify-between">
                <span className="text-2xl font-black text-white">{completion.donePercent}%</span>
                <span className="text-[10px] text-white/40 uppercase tracking-widest">Komplett</span>
             </div>
             <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-emerald-500 transition-all duration-1000" 
                    style={{ width: `${completion.donePercent}%` }} 
                />
             </div>
             <div className="grid grid-cols-2 gap-2 mt-2">
                {completion.categories?.slice(0, 2).map((cat: any) => (
                    <div key={cat.name} className="bg-white/5 p-2 rounded-lg">
                        <div className="text-[8px] text-white/40 uppercase tracking-tighter">{cat.name}</div>
                        <div className="text-xs font-bold text-white">{cat.percent}%</div>
                    </div>
                ))}
             </div>
          </div>
        </div>
      </div>
    </section>
  );
}
