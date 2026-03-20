import React, { useMemo, useState } from 'react';
import { ArchiveCategory, CoreModuleKey, ModuleReadiness, ProjectPlan } from '../types';
import { createArchiveDocument, mergeArchiveDocument } from '../services/projectStructure';
import { uploadProjectDocument } from '../services/documentUploadClient';
import { deleteProjectDocument, downloadProjectDocument, openProjectDocument } from '../services/documentAccessClient';

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
const TOKEN_KEY = 'miljobeslut_admin_bearer';
const PROJECT_KEY = 'miljobeslut_admin_project';

const ProjectPlanStructurePanel: React.FC<ProjectPlanStructurePanelProps> = ({ plan, onUpdatePlan }) => {
  const [draftName, setDraftName] = useState('');
  const [draftModule, setDraftModule] = useState<CoreModuleKey>('PROJECT_MANAGER');
  const [draftCategory, setDraftCategory] = useState<ArchiveCategory>('PROJECT_PLAN');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const [downloadingDocumentId, setDownloadingDocumentId] = useState('');
  const [deletingDocumentId, setDeletingDocumentId] = useState('');

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

    const nextArchive = mergeArchiveDocument(
      plan.documentArchive,
      createArchiveDocument({
        name: draftName.trim(),
        module: draftModule,
        category: draftCategory,
        status: 'DRAFT',
        tags: [draftCategory.toLowerCase(), draftModule.toLowerCase()],
      })
    );

    onUpdatePlan('documentArchive', nextArchive);
    setDraftName('');
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setUploadFile(file);
    setUploadMessage('');
    if (file && !draftName.trim()) {
      setDraftName(file.name);
    }
  };

  const handleUploadToArchive = async () => {
    if (!uploadFile) {
      setUploadMessage('Välj en fil först.');
      return;
    }

    if (typeof window === 'undefined') {
      setUploadMessage('Filuppladdning stöds bara i webbläsaren.');
      return;
    }

    const token = String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
    const projectId = String(window.localStorage.getItem(PROJECT_KEY) || '').trim();

    if (!token || !projectId) {
      setUploadMessage('Adminsession eller projektkoppling saknas. Logga in och välj projekt först.');
      return;
    }

    setIsUploading(true);
    setUploadMessage('Laddar upp dokument till projektarkivet...');

    try {
      const uploaded = await uploadProjectDocument({
        file: uploadFile,
        projectId,
        token,
        subject: draftName.trim() || uploadFile.name,
      });

      const archiveDoc = createArchiveDocument({
        name: draftName.trim() || uploadFile.name,
        module: draftModule,
        category: draftCategory,
        status: 'DRAFT',
        tags: [draftCategory.toLowerCase(), draftModule.toLowerCase(), 'uploaded'],
        storagePath: `/uploads/${projectId}/${uploaded.document.diskName}`,
      });

      const nextArchive = mergeArchiveDocument(plan.documentArchive, {
        ...archiveDoc,
        id: uploaded.document.id,
        uploadedAt: uploaded.document.receivedTime || archiveDoc.uploadedAt,
      });

      onUpdatePlan('documentArchive', nextArchive);
      setUploadMessage(`Dokument uppladdat och köat för indexering: ${uploaded.document.originalName}`);
      setUploadFile(null);
      setDraftName('');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Uppladdningen misslyckades.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleOpenArchiveDocument = async (documentId: string, filename: string) => {
    if (typeof window === 'undefined') {
      setUploadMessage('Dokument kan bara öppnas i webbläsaren.');
      return;
    }

    const token = String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
    if (!token) {
      setUploadMessage('Adminsession saknas. Logga in igen.');
      return;
    }

    setOpeningDocumentId(documentId);
    setUploadMessage('');

    try {
      await openProjectDocument({ documentId, token, filename });
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Dokumentet kunde inte öppnas.');
    } finally {
      setOpeningDocumentId('');
    }
  };

  const handleDownloadArchiveDocument = async (documentId: string, filename: string) => {
    if (typeof window === 'undefined') {
      setUploadMessage('Document can only be downloaded in the browser.');
      return;
    }

    const token = String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
    if (!token) {
      setUploadMessage('Admin session is missing. Log in again.');
      return;
    }

    setDownloadingDocumentId(documentId);
    setUploadMessage('');

    try {
      await downloadProjectDocument({ documentId, token, filename });
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'The document could not be downloaded.');
    } finally {
      setDownloadingDocumentId('');
    }
  };

  const handleDeleteArchiveDocument = async (documentId: string) => {
    const isPersistedDocument = !String(documentId).startsWith('DOC-');
    if (typeof window === 'undefined') {
      setUploadMessage('Archive updates can only be performed in the browser.');
      return;
    }

    if (!window.confirm(isPersistedDocument ? 'Delete this uploaded document from the server and archive?' : 'Remove this archive entry?')) {
      return;
    }

    if (!isPersistedDocument) {
      onUpdatePlan(
        'documentArchive',
        plan.documentArchive.filter((doc) => doc.id !== documentId)
      );
      setUploadMessage('Archive entry removed.');
      return;
    }

    const token = String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
    if (!token) {
      setUploadMessage('Admin session is missing. Log in again.');
      return;
    }

    setDeletingDocumentId(documentId);
    setUploadMessage('');

    try {
      await deleteProjectDocument({ documentId, token });
      onUpdatePlan(
        'documentArchive',
        plan.documentArchive.filter((doc) => doc.id !== documentId)
      );
      setUploadMessage('Document removed from the server and archive.');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'The document could not be deleted.');
    } finally {
      setDeletingDocumentId('');
    }
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_auto_auto]">
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
            <span className="truncate pr-3">{uploadFile ? uploadFile.name : 'Välj fil för riktig uppladdning'}</span>
            <span className="rounded-lg bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700">
              Bläddra
            </span>
            <input type="file" className="hidden" onChange={handleFileSelection} />
          </label>

          <button
            onClick={addArchiveDocument}
            className="px-5 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all"
          >
            Add to archive
          </button>

          <button
            onClick={() => void handleUploadToArchive()}
            disabled={!uploadFile || isUploading}
            className="px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {isUploading ? 'Uploading...' : 'Upload file'}
          </button>
        </div>

        {uploadMessage && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-600">
            {uploadMessage}
          </div>
        )}

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
                <div className="flex items-center gap-3">
                  <p className="text-[10px] font-mono text-slate-500">{doc.storagePath}</p>
                  {!String(doc.id).startsWith('DOC-') && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleOpenArchiveDocument(doc.id, doc.name)}
                        disabled={openingDocumentId === doc.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {openingDocumentId === doc.id ? 'Opening...' : 'Open'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadArchiveDocument(doc.id, doc.name)}
                        disabled={downloadingDocumentId === doc.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {downloadingDocumentId === doc.id ? 'Downloading...' : 'Download'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteArchiveDocument(doc.id)}
                    disabled={deletingDocumentId === doc.id}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {deletingDocumentId === doc.id ? 'Deleting...' : String(doc.id).startsWith('DOC-') ? 'Remove' : 'Delete'}
                  </button>
                </div>
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
