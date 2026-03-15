import React, { useMemo, useState } from 'react';
import { ArchiveCategory, CoreModuleKey, ModuleReadiness, ProjectPlan } from '../types';

interface ProjectPlanStructurePanelProps {
  plan: ProjectPlan;
  onUpdatePlan: (key: keyof ProjectPlan, value: any) => void;
}

const MODULE_OPTIONS: CoreModuleKey[] = [
  'PROJECT_MANAGER',
  'PERMIT_PORTAL',
  'LOGISTICS_MARKET',
  'COMPLIANCE_AUDIT',
  'FIELD_SAMPLING'
];

const CATEGORY_OPTIONS: ArchiveCategory[] = ['PROJECT_PLAN', 'PERMIT', 'RISK', 'FIELD', 'FINANCE', 'OTHER'];

const READINESS_OPTIONS: ModuleReadiness[] = ['READY', 'NOT_READY', 'BLOCKED'];

const ProjectPlanStructurePanel: React.FC<ProjectPlanStructurePanelProps> = ({ plan, onUpdatePlan }) => {
  const [draftName, setDraftName] = useState('');
  const [draftModule, setDraftModule] = useState<CoreModuleKey>('PROJECT_MANAGER');
  const [draftCategory, setDraftCategory] = useState<ArchiveCategory>('PROJECT_PLAN');

  const archiveStats = useMemo(() => {
    const total = plan.documentArchive.length;
    const verified = plan.documentArchive.filter((doc) => doc.status === 'VERIFIED').length;
    const archived = plan.documentArchive.filter((doc) => doc.status === 'ARCHIVED').length;
    return { total, verified, archived };
  }, [plan.documentArchive]);

  const updateBranding = (key: keyof ProjectPlan['branding'], value: string) => {
    onUpdatePlan('branding', { ...plan.branding, [key]: value });
  };

  const updateModuleReadiness = (module: CoreModuleKey, readiness: ModuleReadiness) => {
    onUpdatePlan(
      'moduleIntegrations',
      plan.moduleIntegrations.map((item) => (item.module === module ? { ...item, readiness } : item))
    );
  };

  const updateDependencyNote = (module: CoreModuleKey, dependencyNote: string) => {
    onUpdatePlan(
      'moduleIntegrations',
      plan.moduleIntegrations.map((item) => (item.module === module ? { ...item, dependencyNote } : item))
    );
  };

  const addArchiveDocument = () => {
    if (!draftName.trim()) return;

    const createdAt = new Date().toISOString();
    const storageSafeName = draftName.trim().replace(/\s+/g, '-').toLowerCase();

    const nextArchive = [
      {
        id: `DOC-${Date.now()}`,
        name: draftName.trim(),
        module: draftModule,
        category: draftCategory,
        status: 'DRAFT' as const,
        uploadedAt: createdAt,
        storagePath: `/archive/${new Date().getFullYear()}/${storageSafeName}`,
        tags: [draftCategory.toLowerCase(), draftModule.toLowerCase()]
      },
      ...plan.documentArchive
    ];

    onUpdatePlan('documentArchive', nextArchive);
    setDraftName('');
  };

  const toggleSamplingChecklist = (checkId: string) => {
    onUpdatePlan('samplingPreparation', {
      ...plan.samplingPreparation,
      checklist: plan.samplingPreparation.checklist.map((item) =>
        item.id === checkId ? { ...item, done: !item.done } : item
      )
    });
  };

  const completedChecklist = plan.samplingPreparation.checklist.filter((item) => item.done).length;

  return (
    <div className="space-y-10 pt-10 border-t border-slate-100">
      <section className="space-y-5">
        <h4 className="text-xl font-black text-slate-900 italic tracking-tight">Branding & Report Layout</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10"
            placeholder="Organisationsnamn"
            value={plan.branding.organizationName}
            onChange={(e) => updateBranding('organizationName', e.target.value)}
          />
          <input
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10"
            placeholder="Logo URL"
            value={plan.branding.logoUrl}
            onChange={(e) => updateBranding('logoUrl', e.target.value)}
          />
          <input
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10"
            placeholder="#0f172a"
            value={plan.branding.primaryColor}
            onChange={(e) => updateBranding('primaryColor', e.target.value)}
          />
          <select
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10"
            value={plan.branding.layoutTemplate}
            onChange={(e) => updateBranding('layoutTemplate', e.target.value)}
          >
            <option value="CORPORATE">CORPORATE</option>
            <option value="AUTHORITIES">AUTHORITIES</option>
            <option value="COMPACT">COMPACT</option>
          </select>
        </div>
      </section>

      <section className="space-y-5">
        <h4 className="text-xl font-black text-slate-900 italic tracking-tight">Integrated Module Readiness</h4>
        <div className="space-y-4">
          {MODULE_OPTIONS.map((module) => {
            const moduleState = plan.moduleIntegrations.find((item) => item.module === module);
            if (!moduleState) return null;

            return (
              <div key={module} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="text-sm font-black text-slate-800">{module}</p>
                  <select
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-700"
                    value={moduleState.readiness}
                    onChange={(e) => updateModuleReadiness(module, e.target.value as ModuleReadiness)}
                  >
                    {READINESS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10"
                  placeholder="Beroendeanmärkning"
                  value={moduleState.dependencyNote}
                  onChange={(e) => updateDependencyNote(module, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <h4 className="text-xl font-black text-slate-900 italic tracking-tight">Structured Document Archive</h4>
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">
            {archiveStats.total} total / {archiveStats.verified} verified / {archiveStats.archived} archived
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="md:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10"
            placeholder="Dokumentnamn"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <select
            className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
            value={draftModule}
            onChange={(e) => setDraftModule(e.target.value as CoreModuleKey)}
          >
            {MODULE_OPTIONS.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
          <select
            className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value as ArchiveCategory)}
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={addArchiveDocument}
          className="px-5 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all"
        >
          Add to archive
        </button>

        <div className="space-y-2">
          {plan.documentArchive.map((doc) => (
            <div key={doc.id} className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-800">{doc.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {doc.module} / {doc.category} / {doc.status}
                  </p>
                </div>
                <p className="text-[10px] font-mono text-slate-500">{doc.storagePath}</p>
              </div>
            </div>
          ))}
          {plan.documentArchive.length === 0 && (
            <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs font-medium text-slate-500">
              No archived documents yet.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-5">
        <h4 className="text-xl font-black text-slate-900 italic tracking-tight">Sampling Service Preparation</h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <span className="text-xs font-black uppercase tracking-widest text-slate-700">Sampling service active</span>
            <input
              type="checkbox"
              checked={plan.samplingPreparation.enabled}
              onChange={(e) =>
                onUpdatePlan('samplingPreparation', {
                  ...plan.samplingPreparation,
                  enabled: e.target.checked
                })
              }
            />
          </label>
          <label className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <span className="text-xs font-black uppercase tracking-widest text-slate-700">Prep required now</span>
            <input
              type="checkbox"
              checked={plan.samplingPreparation.requiresPreparationNow}
              onChange={(e) =>
                onUpdatePlan('samplingPreparation', {
                  ...plan.samplingPreparation,
                  requiresPreparationNow: e.target.checked
                })
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
            placeholder="Protokollmall"
            value={plan.samplingPreparation.protocolTemplate}
            onChange={(e) =>
              onUpdatePlan('samplingPreparation', {
                ...plan.samplingPreparation,
                protocolTemplate: e.target.value
              })
            }
          />
          <input
            className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
            placeholder="Spårningsmall"
            value={plan.samplingPreparation.chainOfCustodyTemplate}
            onChange={(e) =>
              onUpdatePlan('samplingPreparation', {
                ...plan.samplingPreparation,
                chainOfCustodyTemplate: e.target.value
              })
            }
          />
          <input
            className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
            placeholder="Planerat servicefönster"
            value={plan.samplingPreparation.plannedServiceWindow}
            onChange={(e) =>
              onUpdatePlan('samplingPreparation', {
                ...plan.samplingPreparation,
                plannedServiceWindow: e.target.value
              })
            }
          />
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">
            Checklist {completedChecklist}/{plan.samplingPreparation.checklist.length}
          </p>
          <div className="space-y-2">
            {plan.samplingPreparation.checklist.map((item) => (
              <label key={item.id} className="flex items-center gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={item.done} onChange={() => toggleSamplingChecklist(item.id)} />
                <span className={item.done ? 'line-through opacity-60' : ''}>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default ProjectPlanStructurePanel;
