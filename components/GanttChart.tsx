
import React from 'react';
import { Task } from '../types';

const _MOCK_TASKS: Task[] = [
  { id: '1', title: 'Inledande platsspecifik riskanalys', startWeek: 2, duration: 4, type: 'TECHNICAL', status: 'DONE' },
  { id: '2', title: 'Samråd med närboende & intressenter', startWeek: 6, duration: 3, type: 'LEGAL', status: 'ONGOING' },
  { id: '3', title: 'Fältundersökning: PAH & Markprover', startWeek: 8, duration: 2, type: 'FIELD', status: 'TODO' },
  { id: '4', title: 'MKB - Miljökonsekvensbeskrivning', startWeek: 10, duration: 8, type: 'LEGAL', status: 'TODO' },
  { id: '5', title: 'Ansökan enligt 90-serien (90.131)', startWeek: 18, duration: 1, type: 'ADMIN', status: 'TODO' },
  { id: '6', title: 'Myndighetshandläggning (Estimerad)', startWeek: 19, duration: 12, type: 'LEGAL', status: 'TODO' },
];

const MONTHS = [
  { name: 'Jan', weeks: 4 }, { name: 'Feb', weeks: 4 }, { name: 'Mar', weeks: 5 },
  { name: 'Apr', weeks: 4 }, { name: 'Maj', weeks: 4 }, { name: 'Jun', weeks: 4 },
  { name: 'Jul', weeks: 5 }, { name: 'Aug', weeks: 4 }, { name: 'Sep', weeks: 4 },
  { name: 'Okt', weeks: 4 }, { name: 'Nov', weeks: 5 }, { name: 'Dec', weeks: 5 }
];

interface GanttChartProps {
  phases?: any[];
}

const GanttChart: React.FC<GanttChartProps> = ({ phases }) => {
  const totalWeeks = 52;

  const getTypeColor = (type?: string) => {
    switch (type) {
      case 'LEGAL': return 'bg-rose-500';
      case 'TECHNICAL': return 'bg-blue-500';
      case 'FIELD': return 'bg-emerald-500';
      case 'ADMIN': return 'bg-slate-500';
      default: return 'bg-slate-400';
    }
  };

  if (!phases || phases.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 border-dashed rounded-[3rem] p-12 text-center text-slate-400 font-bold uppercase tracking-widest text-sm">
        Ingen tidplan genererad ännu. Ange fastighetsbeteckning för att starta projektmotorn.
      </div>
    );
  }

  // Flatten phases and tasks into a single viewable list
  const allTasks = phases.flatMap(phase => phase.tasks.map((task: any) => ({
    ...task,
    phaseId: phase.id,
    phaseTitle: phase.title
  })));

  return (
    <div className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col animate-in fade-in duration-700">
      <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tighter italic">Projekt-Tidplan</h3>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1 italic">Baserad på myndighetskrav & prövningsprocess</p>
        </div>
        <div className="flex gap-4">
          <LegendItem color="bg-rose-500" label="Juridisk process" />
          <LegendItem color="bg-blue-500" label="Tekniskt underlag" />
          <LegendItem color="bg-emerald-500" label="Fältarbete" />
        </div>
      </header>

      <div className="flex-1 overflow-x-auto custom-scrollbar">
        <div className="min-w-[1200px]">
          {/* Header Row: Months */}
          <div className="flex border-b border-slate-100 bg-white sticky top-0 z-10">
            <div className="w-64 shrink-0 p-4 border-r border-slate-100 font-black text-[10px] uppercase text-slate-400">Aktivitet / Vecka</div>
            <div className="flex flex-1">
              {MONTHS.map((m, i) => (
                <div key={i} className="flex-1 text-center py-4 border-r border-slate-50 font-black text-[10px] uppercase text-slate-400 bg-slate-50/30" style={{ flexGrow: m.weeks }}>
                  {m.name}
                </div>
              ))}
            </div>
          </div>

          {/* Grid View */}
          <div className="relative">
            {allTasks.map((task: any) => (
              <div key={task.id} className="flex border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                <div className="w-64 shrink-0 p-4 border-r border-slate-100 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${task.status === 'DONE' ? 'bg-emerald-500' : task.status === 'ONGOING' ? 'bg-blue-500 animate-pulse' : 'bg-slate-200'}`}></div>
                  <div className="flex flex-col truncate">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{task.phaseTitle}</span>
                    <span className="text-xs font-bold text-slate-700 truncate group-hover:text-blue-600 transition-colors">{task.title}</span>
                  </div>
                </div>
                <div className="flex-1 relative h-12 flex items-center">
                  {/* Background Grid Lines */}
                  {Array.from({ length: totalWeeks }).map((_, i) => (
                    <div key={i} className="flex-1 h-full border-r border-slate-50/50"></div>
                  ))}

                  {/* Task Bar */}
                  <div
                    className={`absolute h-6 rounded-full shadow-lg ${getTypeColor(task.type)} opacity-90 hover:opacity-100 hover:scale-[1.02] transition-all cursor-pointer flex items-center px-3 overflow-hidden`}
                    style={{
                      // Provide defaults if startWeek/duration are missing from DB
                      left: `${((task.startWeek || 1) / totalWeeks) * 100}%`,
                      width: `${((task.duration || 2) / totalWeeks) * 100}%`
                    }}
                  >
                    <span className="text-[8px] font-black text-white uppercase tracking-tighter truncate">{task.duration || 2} v</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="p-6 bg-slate-900 text-white flex justify-between items-center">
        <div className="flex gap-8">
          <div className="text-center">
            <p className="text-[9px] font-black opacity-40 uppercase mb-1">Total Tid</p>
            <p className="text-sm font-black italic">42 Veckor</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-black opacity-40 uppercase mb-1">Faser</p>
            <p className="text-sm font-black text-rose-400 italic">{phases.length} St</p>
          </div>
        </div>
        <button className="px-6 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
          Exportera till Excel / MSP
        </button>
      </footer>
    </div>
  );
};

const LegendItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-2">
    <div className={`w-3 h-3 rounded-full ${color}`}></div>
    <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</span>
  </div>
);

export default GanttChart;
