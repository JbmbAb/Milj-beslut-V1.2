import React, { useEffect, useState } from 'react';
import { ChevronRight, FileText, Search } from 'lucide-react';
import { callMvp } from '../../services/mvpApiClient';
import type { Project } from './mvpDemoModel';
import { Badge, Card } from './mvpDemoShared';

type ProjectDashboardViewProps = {
  onSelect: (project: Project) => void;
};

const ProjectDashboardView: React.FC<ProjectDashboardViewProps> = ({ onSelect }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void callMvp<{ projects: Project[] }>('/api/v1/projects', { method: 'GET' })
      .then((response) => {
        if (!cancelled) {
          setProjects(response.projects);
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="animate-pulse p-10 text-center text-slate-400">Laddar projekt...</div>;
  }

  return (
    <div className="animate-in slide-in-from-bottom-4 space-y-6 fade-in duration-500">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Mina Projekt</h1>
        <p className="text-slate-500">Översikt av pågående miljöprövningar och data-täckning.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Sök fastighet..."
            className="w-64 rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const value = (event.target as HTMLInputElement).value;
                void value;
              }
            }}
          />
        </div>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-black text-slate-400"
        >
          Nytt projekt kräver riktig datakälla
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Card
            key={project.id}
            className="group cursor-pointer transition-colors hover:border-indigo-300"
            onClick={() => onSelect(project)}
          >
            <div className="p-5">
              <div className="mb-4 flex items-start justify-between">
                <Badge
                  label={project.status}
                  color={
                    project.status === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-50 text-slate-600'
                  }
                />
                <span className="font-mono text-xs text-slate-400">{project.id.slice(-6)}</span>
              </div>
              <h3 className="mb-1 text-lg font-bold text-slate-800 transition-colors group-hover:text-indigo-600">
                {project.propertyDesignation}
              </h3>
              <p className="flex items-center gap-1 text-sm text-slate-500">
                <FileText size={14} /> {project.docCount} Dokument
              </p>

              <div className="mt-5 space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-bold uppercase text-slate-400">
                    <span>Kommun-matchning</span>
                    <span>{project.coverage.municipality}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${project.coverage.municipality}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-bold uppercase text-slate-400">
                    <span>Beslutstyp-matchning</span>
                    <span>{project.coverage.decisionType}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${project.coverage.decisionType}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-500 transition-colors group-hover:bg-indigo-50">
              Analysera projekt <ChevronRight size={16} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ProjectDashboardView;
