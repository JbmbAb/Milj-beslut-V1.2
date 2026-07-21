import React, { useState } from 'react';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

interface GdprExportResult {
  userId: string;
  email?: string;
  name?: string;
  exportedAt: string;
  projects: unknown[];
  documents: unknown[];
  auditEntries: unknown[];
}

interface MaintenanceResult {
  deletedExpiredSessions?: number;
  anonymizedOldAuditEntries?: number;
  purgedSoftDeleted?: number;
}

const AdminGdprPanel: React.FC = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) || '' : '';

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Self-service export (Art. 20)
  const [exportResult, setExportResult] = useState<GdprExportResult | null>(null);

  // Admin: delete user
  const [deleteUserId, setDeleteUserId] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deletedAt: string } | null>(null);

  // Admin: maintenance
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceResult | null>(null);

  const clearStatus = () => {
    setError('');
    setInfo('');
  };

  const secureReq = async <T,>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE' | 'PUT',
    payload?: Record<string, unknown>,
  ): Promise<T> => {
    if (!token) throw new Error('Ingen admin-token – logga in i Admin sökcenter först');
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: ['POST', 'PUT'].includes(method) ? JSON.stringify(payload ?? {}) : undefined,
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
    return json as T;
  };

  const handleExportMyData = async () => {
    clearStatus();
    setBusy('export');
    try {
      const data = await secureReq<{ ok: true; data: GdprExportResult }>('/api/gdpr/me/export', 'GET');
      setExportResult(data.data);
      setInfo('Personuppgifter exporterade (Art. 20).');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export misslyckades');
    } finally {
      setBusy('');
    }
  };

  const handleDownloadExport = () => {
    if (!exportResult) return;
    const blob = new Blob([JSON.stringify(exportResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gdpr-export-${exportResult.userId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteUser = async () => {
    if (!deleteUserId.trim()) {
      setError('Ange ett användar-ID');
      return;
    }
    if (!deleteConfirm) {
      setError('Bekräfta radering genom att markera checkboxen');
      return;
    }
    clearStatus();
    setBusy('delete');
    try {
      const data = await secureReq<{ ok: true; deletedAt: string }>(
        `/api/admin/gdpr/users/${encodeURIComponent(deleteUserId.trim())}`,
        'DELETE',
      );
      setDeleteResult({ deletedAt: data.deletedAt });
      setInfo(`Användare ${deleteUserId} raderad (Art. 17).`);
      setDeleteUserId('');
      setDeleteConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Radering misslyckades');
    } finally {
      setBusy('');
    }
  };

  const handleMaintenance = async () => {
    clearStatus();
    setBusy('maint');
    try {
      const data = await secureReq<{ ok: true } & MaintenanceResult>('/api/admin/gdpr/maintenance', 'POST');
      setMaintenanceResult({
        deletedExpiredSessions: data.deletedExpiredSessions,
        anonymizedOldAuditEntries: data.anonymizedOldAuditEntries,
        purgedSoftDeleted: data.purgedSoftDeleted,
      });
      setInfo('GDPR-underhåll kört.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Underhåll misslyckades');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-black text-slate-900">GDPR-hantering</h2>
        <p className="mt-1 text-sm text-slate-500">
          Artikel 15, 17 och 20 – dataexport, rätt till radering och periodiskt underhåll.
        </p>
      </div>

      {/* Status banner */}
      {(error || info) && (
        <div
          data-testid="gdpr-status-banner"
          className="rounded-xl border border-slate-200 bg-white p-3 text-xs"
        >
          {error && (
            <p data-testid="gdpr-status-error" className="font-bold text-rose-600">
              {error}
            </p>
          )}
          {info && (
            <p data-testid="gdpr-status-info" className="text-slate-700">
              {info}
            </p>
          )}
        </div>
      )}

      {/* Art. 20 – Dataportabilitet */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black uppercase text-blue-700">
            Art. 20
          </span>
          <h3 className="font-black text-slate-900">Exportera mina personuppgifter</h3>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Exporterar alla personuppgifter kopplade till ditt konto: projekt, dokument och händelselogg.
        </p>
        <div className="flex items-center gap-3">
          <button
            data-testid="gdpr-export-button"
            type="button"
            disabled={busy === 'export'}
            onClick={handleExportMyData}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'export' ? 'Exporterar...' : 'Exportera mina uppgifter'}
          </button>
          {exportResult && (
            <button
              type="button"
              onClick={handleDownloadExport}
              className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
            >
              Ladda ned JSON
            </button>
          )}
        </div>
        {exportResult && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
            <p>
              <span className="font-bold">Användar-ID:</span> {exportResult.userId}
            </p>
            {exportResult.email && (
              <p>
                <span className="font-bold">E-post:</span> {exportResult.email}
              </p>
            )}
            {exportResult.name && (
              <p>
                <span className="font-bold">Namn:</span> {exportResult.name}
              </p>
            )}
            <p>
              <span className="font-bold">Exportdatum:</span>{' '}
              {new Date(exportResult.exportedAt).toLocaleString('sv-SE')}
            </p>
            <p>
              <span className="font-bold">Projekt:</span> {exportResult.projects?.length ?? 0} st
            </p>
            <p>
              <span className="font-bold">Dokument:</span> {exportResult.documents?.length ?? 0} st
            </p>
            <p>
              <span className="font-bold">Händelser:</span> {exportResult.auditEntries?.length ?? 0} st
            </p>
          </div>
        )}
      </section>

      {/* Art. 17 – Rätt till radering */}
      <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-black uppercase text-rose-700">
            Art. 17
          </span>
          <h3 className="font-black text-slate-900">Radera användares personuppgifter</h3>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
            ADMIN
          </span>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Permanent radering av alla personuppgifter för angiven användare. Åtgärden kan inte ångras.
        </p>
        <div className="space-y-3">
          <input
            data-testid="gdpr-delete-userid-input"
            type="text"
            value={deleteUserId}
            onChange={(e) => setDeleteUserId(e.target.value)}
            placeholder="Användar-ID (UUID)"
            className="w-full max-w-sm rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono focus:border-rose-500 focus:outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              data-testid="gdpr-delete-confirm-checkbox"
              type="checkbox"
              checked={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-rose-600"
            />
            Jag bekräftar att radering av denna användare är korrekt och juridiskt godkänd
          </label>
          <button
            data-testid="gdpr-delete-button"
            type="button"
            disabled={busy === 'delete' || !deleteUserId.trim() || !deleteConfirm}
            onClick={handleDeleteUser}
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy === 'delete' ? 'Raderar...' : 'Radera användare permanent'}
          </button>
        </div>
        {deleteResult && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            Raderad: {new Date(deleteResult.deletedAt).toLocaleString('sv-SE')}
          </div>
        )}
      </section>

      {/* Periodiskt underhåll */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-700">
            Underhåll
          </span>
          <h3 className="font-black text-slate-900">GDPR-underhåll</h3>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
            ADMIN
          </span>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Kör periodisk rensning: utgångna sessioner, anonymisering av gammal händelselogg och rensning av
          mjukt raderade poster.
        </p>
        <button
          data-testid="gdpr-maintenance-button"
          type="button"
          disabled={busy === 'maint'}
          onClick={handleMaintenance}
          className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy === 'maint' ? 'Kör underhåll...' : 'Kör GDPR-underhåll'}
        </button>
        {maintenanceResult && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
            {maintenanceResult.deletedExpiredSessions !== undefined && (
              <p>
                <span className="font-bold">Raderade utgångna sessioner:</span>{' '}
                {maintenanceResult.deletedExpiredSessions}
              </p>
            )}
            {maintenanceResult.anonymizedOldAuditEntries !== undefined && (
              <p>
                <span className="font-bold">Anonymiserade händelseposter:</span>{' '}
                {maintenanceResult.anonymizedOldAuditEntries}
              </p>
            )}
            {maintenanceResult.purgedSoftDeleted !== undefined && (
              <p>
                <span className="font-bold">Rensade mjukt raderade:</span>{' '}
                {maintenanceResult.purgedSoftDeleted}
              </p>
            )}
          </div>
        )}
      </section>

      <p className="text-[11px] text-slate-400">
        Alla GDPR-åtgärder loggas i revisionsloggen (audit trail) för spårbarhet. Kräver admin-inloggning via
        Admin sökcenter.
      </p>
    </div>
  );
};

export default AdminGdprPanel;
