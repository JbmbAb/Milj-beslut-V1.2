import React, { useState } from 'react';

interface OrgNode {
  id: string;
  title: string;
  role: string;
  type: 'STRAY' | 'LEADER' | 'PARTNER' | 'SUB';
}

const INITIAL_NODES: OrgNode[] = [
  { id: '1', title: 'Styrgrupp', role: 'Beslutsfattare', type: 'LEADER' },
  { id: '2', title: 'Projektledare', role: 'Operativt ansvar', type: 'LEADER' },
  { id: '3', title: 'Markägare', role: 'Intressent', type: 'PARTNER' },
  { id: '4', title: 'Entreprenör', role: 'Genomförande', type: 'SUB' },
  { id: '5', title: 'Miljökonsult', role: 'Tekniskt stöd', type: 'SUB' },
];

const ProjectOrgChart: React.FC = () => {
  const [nodes, setNodes] = useState<OrgNode[]>(INITIAL_NODES);

  const handleUpdateNode = (id: string, key: keyof OrgNode, value: string) => {
    setNodes(nodes.map((n) => (n.id === id ? { ...n, [key]: value } : n)));
  };

  const leader = nodes.find((n) => n.id === '1');
  const pm = nodes.find((n) => n.id === '2');
  const partners = nodes.filter((n) => n.type === 'PARTNER');
  const subs = nodes.filter((n) => n.type === 'SUB');

  return (
    <div className="bg-white rounded-[3rem] border border-slate-200 shadow-sm p-10 md:p-16 animate-in fade-in zoom-in duration-500 overflow-x-auto">
      <header className="mb-16 text-center">
        <h3 className="text-3xl font-black text-slate-900 tracking-tighter italic mb-2">Organisationsplan</h3>
        <p className="text-slate-500 text-sm font-medium uppercase tracking-widest">
          Struktur & Flödesschema
        </p>
      </header>

      <div className="flex flex-col items-center min-w-[800px]">
        {/* Leader Node */}
        {leader && (
          <div className="relative">
            <EditableNode node={leader} onUpdate={handleUpdateNode} color="bg-slate-900" text="text-white" />
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0.5 h-12 bg-slate-200 flex items-end">
              <div className="w-2 h-2 rounded-full bg-slate-200 -mb-1"></div>
            </div>
          </div>
        )}

        <div className="h-12"></div>

        {/* PM Node */}
        {pm && (
          <div className="relative">
            <EditableNode
              node={pm}
              onUpdate={handleUpdateNode}
              color="bg-blue-600"
              text="text-white"
              scale={1.1}
            />
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0.5 h-12 bg-slate-200"></div>
          </div>
        )}

        {/* Junction & Horizontal Flow */}
        <div className="relative w-full h-12 flex justify-center">
          <div className="w-3/4 h-0.5 bg-slate-200 mt-12"></div>
        </div>

        {/* Partner & Sub Nodes */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 w-full">
          {partners.map((p) => (
            <div key={p.id} className="flex flex-col items-center">
              <div className="w-0.5 h-8 bg-slate-200"></div>
              <EditableNode node={p} onUpdate={handleUpdateNode} color="bg-amber-500" text="text-white" />
            </div>
          ))}
          {subs.map((s) => (
            <div key={s.id} className="flex flex-col items-center">
              <div className="w-0.5 h-8 bg-slate-200"></div>
              <EditableNode node={s} onUpdate={handleUpdateNode} color="bg-emerald-600" text="text-white" />
            </div>
          ))}
        </div>
      </div>

      <footer className="mt-20 pt-10 border-t border-slate-50 flex justify-between items-center text-slate-400">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-slate-900 rounded-sm"></div>
            <span className="text-[9px] font-black uppercase">Ledning</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-amber-500 rounded-sm"></div>
            <span className="text-[9px] font-black uppercase">Partner</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-600 rounded-sm"></div>
            <span className="text-[9px] font-black uppercase">Underkonsult</span>
          </div>
        </div>
        <button className="text-[10px] font-black uppercase text-blue-600 hover:scale-105 transition-transform">
          + Lägg till nod
        </button>
      </footer>
    </div>
  );
};

const EditableNode: React.FC<{
  node: OrgNode;
  onUpdate: (id: string, key: keyof OrgNode, value: string) => void;
  color: string;
  text: string;
  scale?: number;
}> = ({ node, onUpdate, color, text, scale = 1 }) => (
  <div
    className={`${color} ${text} p-6 rounded-2xl shadow-xl w-56 text-center space-y-2 border-4 border-white/10 hover:border-white/30 transition-all`}
    style={{ transform: `scale(${scale})` }}
  >
    <input
      className="bg-transparent border-none text-center font-black tracking-tight w-full outline-none focus:ring-0 p-0 leading-tight text-base"
      value={node.title}
      onChange={(e) => onUpdate(node.id, 'title', e.target.value)}
    />
    <input
      className="bg-transparent border-none text-center text-[10px] font-bold uppercase tracking-widest opacity-60 w-full outline-none focus:ring-0 p-0"
      value={node.role}
      onChange={(e) => onUpdate(node.id, 'role', e.target.value)}
    />
  </div>
);

export default ProjectOrgChart;
