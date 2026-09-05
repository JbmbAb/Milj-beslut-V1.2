import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { csrfFetch } from '../services/csrfClient';
import { triggerBrowserDownload } from '../services/pdfExportClient';
import type {
  AdminRequirementCase,
  AdminRequirementCitation,
  AdminRequirementRow,
  AdminRequirementsSummary,
  AdminVerifyCitationPayload,
  AdminVerifyRequirementPayload,
  RequirementVerificationStatus,
} from '../types';

type RequirementCaseReviewStatus = 'AUTO' | 'NEEDS_REVIEW' | 'VERIFIED' | 'LOCKED';

interface AdminReviewRequirementCasePayload {
  caseReviewStatus: RequirementCaseReviewStatus;
  validatedBy?: string;
  notes?: string;
}

type StatusFilter = RequirementVerificationStatus | 'ALL';

interface AdminRequirementsStudioProps {
  token: string;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS: RequirementVerificationStatus[] = ['AUTO', 'REVIEWED', 'VERIFIED', 'REJECTED'];
const CASE_STATUS_OPTIONS: RequirementCaseReviewStatus[] = ['AUTO', 'NEEDS_REVIEW', 'VERIFIED', 'LOCKED'];

const statusTone: Record<RequirementVerificationStatus, string> = {
  AUTO: 'bg-slate-100 text-slate-700 border-slate-200',
  REVIEWED: 'bg-blue-50 text-blue-700 border-blue-200',
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
};

const caseStatusTone: Record<RequirementCaseReviewStatus, string> = {
  AUTO: 'bg-slate-100 text-slate-700 border-slate-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LOCKED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

function parseFilenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const basic = /filename="?([^"]+)"?/i.exec(header);
  if (!basic?.[1]) return fallback;
  try {
    return decodeURIComponent(basic[1]);
  } catch {
    return basic[1];
  }
}

const AdminRequirementsStudio: React.FC<AdminRequirementsStudioProps> = ({ token, onError, onInfo }) => {
  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');

  const [cases, setCases] = useState<AdminRequirementCase[]>([]);
  const [rows, setRows] = useState<AdminRequirementRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [casesTotal, setCasesTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [citations, setCitations] = useState<AdminRequirementCitation[]>([]);
  const [summary, setSummary] = useState<AdminRequirementsSummary | null>(null);
  const [includePreliminarySummary, setIncludePreliminarySummary] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [municipalityFilter, setMunicipalityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('');

  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [selectedRequirementCode, setSelectedRequirementCode] = useState('');
  const [selectedCitationCode, setSelectedCitationCode] = useState('');

  const [verifiedBy, setVerifiedBy] = useState('');
  const [caseStatusDraft, setCaseStatusDraft] = useState<RequirementCaseReviewStatus>('AUTO');
  const [caseNotesDraft, setCaseNotesDraft] = useState('');
  const [requirementStatusDraft, setRequirementStatusDraft] = useState<RequirementVerificationStatus>('AUTO');
  const [validationComment, setValidationComment] = useState('');
  const [requirementErrorType, setRequirementErrorType] = useState('');

  const [citationStatusDraft, setCitationStatusDraft] = useState<RequirementVerificationStatus>('AUTO');
  const [citationPageNumber, setCitationPageNumber] = useState('');
  const [citationComment, setCitationComment] = useState('');

  const selectedRow = useMemo(
    () => rows.find((item) => item.requirementCode === selectedRequirementCode) || null,
    [rows, selectedRequirementCode],
  );

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) || null,
    [cases, selectedCaseId],
  );

  const selectedCitation = useMemo(
    () => citations.find((item) => item.citationCode === selectedCitationCode) || null,
    [citations, selectedCitationCode],
  );

  const fetchJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      if (!token) {
        throw new Error('Admin-token saknas.');
      }

      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers || {}),
        },
      });

      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      if (!response.ok || !(json as { ok?: boolean } | null)?.ok) {
        const errorMessage = (json as { error?: string } | null)?.error || `HTTP ${response.status}`;
        if (response.status === 401 || /bearer token|invalid token|access token/i.test(errorMessage)) {
          throw new Error('Adminsessionen har gått ut. Klicka "Refresh token" eller logga in igen.');
        }
        throw new Error(errorMessage);
      }
      return json as T;
    },
    [token],
  );

  const loadRows = useCallback(async () => {
    if (!token) return;
    setBusy('rows');
    setLocalError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      params.set('includePreliminary', 'true');
      if (statusFilter !== 'ALL') params.set('verificationStatus', statusFilter);
      if (municipalityFilter.trim()) params.set('municipality', municipalityFilter.trim());
      if (categoryFilter.trim()) params.set('category', categoryFilter.trim());
      if (documentTypeFilter.trim()) params.set('documentType', documentTypeFilter.trim());

      const data = await fetchJson<{
        ok: true;
        items: AdminRequirementRow[];
        total: number;
        page: number;
      }>(`/api/admin/requirements/rows?${params.toString()}`);

      setRows(data.items || []);
      setRowsTotal(Number(data.total || 0));
      setPage(Math.max(1, Number(data.page || 1)));

      if (!data.items?.some((item) => item.requirementCode === selectedRequirementCode)) {
        setSelectedRequirementCode(data.items?.[0]?.requirementCode || '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte hamta kravrader.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  }, [
    token,
    page,
    statusFilter,
    municipalityFilter,
    categoryFilter,
    documentTypeFilter,
    selectedRequirementCode,
    fetchJson,
    onError,
  ]);

  const loadCases = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '100');
      if (statusFilter !== 'ALL') params.set('verificationStatus', statusFilter);
      if (municipalityFilter.trim()) params.set('municipality', municipalityFilter.trim());
      if (documentTypeFilter.trim()) params.set('documentType', documentTypeFilter.trim());

      const data = await fetchJson<{ ok: true; total: number; items: AdminRequirementCase[] }>(
        `/api/admin/requirements/cases?${params.toString()}`,
      );
      setCases(data.items || []);
      setCasesTotal(Number(data.total || 0));

      if (!data.items?.some((item) => item.id === selectedCaseId)) {
        setSelectedCaseId(data.items?.[0]?.id || '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte hamta arenden.';
      setLocalError(message);
      onError(message);
    }
  }, [token, statusFilter, municipalityFilter, documentTypeFilter, fetchJson, onError, selectedCaseId]);

  const loadCitations = useCallback(async () => {
    if (!token || !selectedRequirementCode) {
      setCitations([]);
      setSelectedCitationCode('');
      return;
    }

    setBusy('citations');
    setLocalError('');
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '100');
      params.set('includePreliminary', 'true');
      params.set('requirementCode', selectedRequirementCode);

      const data = await fetchJson<{
        ok: true;
        items: AdminRequirementCitation[];
      }>(`/api/admin/requirements/citations?${params.toString()}`);

      setCitations(data.items || []);
      setSelectedCitationCode(data.items?.[0]?.citationCode || '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte hamta citat.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  }, [token, selectedRequirementCode, fetchJson, onError]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setBusy('summary');
    setLocalError('');
    try {
      const path = `/api/admin/requirements/reports/summary?includePreliminary=${includePreliminarySummary ? 'true' : 'false'}`;
      const data = await fetchJson<{ ok: true; summary: AdminRequirementsSummary }>(path);
      setSummary(data.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte hamta rapportsummering.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  }, [token, includePreliminarySummary, fetchJson, onError]);

  useEffect(() => {
     
    setPage(1);
  }, [statusFilter, municipalityFilter, categoryFilter, documentTypeFilter]);

  useEffect(() => {
    if (!token) return;
    const timeoutId = window.setTimeout(() => {
       
      loadRows();
       
      loadCases();
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [token, loadRows, loadCases]);

  useEffect(() => {
    if (!token) return;
     
    loadSummary();
  }, [token, includePreliminarySummary, loadSummary]);

  useEffect(() => {
    if (!token) return;
     
    loadCitations();
  }, [token, selectedRequirementCode, loadCitations]);

  useEffect(() => {
    if (!selectedRow) return;
     
    setRequirementStatusDraft(selectedRow.verificationStatus);
     
    setValidationComment(selectedRow.validationComment || '');
     
    setRequirementErrorType(selectedRow.errorType || '');
  }, [selectedRow]);

  useEffect(() => {
    if (!selectedCase) return;
     
    setCaseStatusDraft(selectedCase.caseReviewStatus);
     
    setCaseNotesDraft(selectedCase.notes || '');
  }, [selectedCase]);

  useEffect(() => {
    if (!selectedCitation) return;
     
    setCitationStatusDraft(selectedCitation.verificationStatus);
     
    setCitationPageNumber(selectedCitation.pageNumber != null ? String(selectedCitation.pageNumber) : '');
     
    setCitationComment(selectedCitation.comment || '');
  }, [selectedCitation]);

  const allCitationsReviewed = useMemo(() => {
    if (!citations.length) return false;
    return citations.every(
      (citation) => citation.verificationStatus === 'REVIEWED' || citation.verificationStatus === 'VERIFIED',
    );
  }, [citations]);

  const canSetRequirementVerified = verifiedBy.trim().length > 0 && allCitationsReviewed;
  const canSaveCase = caseStatusDraft === 'AUTO' || verifiedBy.trim().length > 0;
  const canSaveRequirement = requirementStatusDraft !== 'VERIFIED' || canSetRequirementVerified;

  const parsedCitationPageNumber = citationPageNumber.trim() ? Number(citationPageNumber.trim()) : undefined;
  const canSetCitationVerified =
    verifiedBy.trim().length > 0 &&
    ((parsedCitationPageNumber != null &&
      Number.isFinite(parsedCitationPageNumber) &&
      parsedCitationPageNumber > 0) ||
      citationComment.trim().length > 0 ||
      Boolean(selectedCitation?.comment) ||
      selectedCitation?.pageNumber != null);
  const canSaveCitation = citationStatusDraft !== 'VERIFIED' || canSetCitationVerified;

  const saveRequirement = async () => {
    if (!selectedRow) return;
    if (!canSaveRequirement) {
      const message = 'Kravrad kan inte sattas till VERIFIED utan verifierare och REVIEWED/VERIFIED citat.';
      setLocalError(message);
      onError(message);
      return;
    }

    setBusy('verify-requirement');
    setLocalError('');
    try {
      const payload: AdminVerifyRequirementPayload = {
        verificationStatus: requirementStatusDraft,
        verifiedBy: verifiedBy.trim() || undefined,
        validationComment: validationComment.trim() || undefined,
        errorType: requirementErrorType.trim() || undefined,
      };

      await fetchJson(
        `/api/admin/requirements/rows/${encodeURIComponent(selectedRow.requirementCode)}/verify`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );

      onInfo(`Kravrad ${selectedRow.requirementCode} uppdaterad (${requirementStatusDraft}).`);
      await Promise.all([loadRows(), loadCitations(), loadSummary()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte verifiera kravrad.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  };

  const saveCase = async () => {
    if (!selectedCase) return;
    if (!canSaveCase) {
      const message = 'Arende kan inte sattas till manuell status utan granskare.';
      setLocalError(message);
      onError(message);
      return;
    }

    setBusy('verify-case');
    setLocalError('');
    try {
      const payload: AdminReviewRequirementCasePayload = {
        caseReviewStatus: caseStatusDraft,
        validatedBy: verifiedBy.trim() || undefined,
        notes: caseNotesDraft.trim() || undefined,
      };

      await fetchJson(`/api/admin/requirements/cases/${encodeURIComponent(selectedCase.id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      onInfo(`Arende ${selectedCase.caseKey} uppdaterat (${caseStatusDraft}).`);
      await Promise.all([loadCases(), loadRows(), loadSummary()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte uppdatera arendet.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  };

  const saveCitation = async () => {
    if (!selectedCitation) return;
    if (!canSaveCitation) {
      const message = 'Citat kan inte sattas till VERIFIED utan verifierare och pageNumber eller kommentar.';
      setLocalError(message);
      onError(message);
      return;
    }

    setBusy('verify-citation');
    setLocalError('');
    try {
      const payload: AdminVerifyCitationPayload = {
        verificationStatus: citationStatusDraft,
        verifiedBy: verifiedBy.trim() || undefined,
        comment: citationComment.trim() || undefined,
        pageNumber:
          parsedCitationPageNumber != null &&
          Number.isFinite(parsedCitationPageNumber) &&
          parsedCitationPageNumber > 0
            ? Math.trunc(parsedCitationPageNumber)
            : undefined,
      };

      await fetchJson(
        `/api/admin/requirements/citations/${encodeURIComponent(selectedCitation.citationCode)}/verify`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );

      onInfo(`Citat ${selectedCitation.citationCode} uppdaterat (${citationStatusDraft}).`);
      await Promise.all([loadRows(), loadCitations(), loadSummary()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte verifiera citat.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  };

  const openDocument = async (documentId: string) => {
    if (!documentId || !token) return;
    setBusy('document');
    setLocalError('');
    try {
      const response = await fetch(
        `/api/admin/requirements/documents/${encodeURIComponent(documentId)}/view`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const json = (await response.json()) as { error?: string };
          message = json.error || message;
        } catch {
          // ignore parse failure
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte oppna dokument.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  };

  const downloadPdfReport = async () => {
    if (!token) return;
    setBusy('export');
    setLocalError('');
    try {
      const response = await csrfFetch('/api/admin/requirements/reports/export.pdf', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includePreliminary: includePreliminarySummary }),
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const json = (await response.json()) as { error?: string };
          message = json.error || message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const filename = parseFilenameFromDisposition(
        response.headers.get('content-disposition'),
        'kravrapport.pdf',
      );
      triggerBrowserDownload(blob, filename);
      onInfo('Kravrapport som PDF har laddats ner.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'PDF-export misslyckades.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  };

  const downloadBinary = async (url: string, method: 'GET' | 'POST', fallbackFilename: string) => {
    if (!token) return;
    setBusy('export');
    setLocalError('');
    try {
      const response = await csrfFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          method === 'POST' ? JSON.stringify({ includePreliminary: includePreliminarySummary }) : undefined,
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const json = (await response.json()) as { error?: string };
          message = json.error || message;
        } catch {
          // ignore parse failure
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = parseFilenameFromDisposition(
        response.headers.get('content-disposition'),
        fallbackFilename,
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      onInfo(`Export klar: ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export misslyckades.';
      setLocalError(message);
      onError(message);
    } finally {
      setBusy('');
    }
  };

  const totalPages = Math.max(1, Math.ceil(rowsTotal / PAGE_SIZE));

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
            Kravrapport Studio
          </p>
          <h3 className="mt-1 text-lg font-black text-slate-900">
            Verifieringsko, dokumentvisning och rapportexport
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Human-in-the-loop: inga auto-uppgraderingar till VERIFIED tillats.
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          Rapportresultat bygger endast pa VERIFIED.
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <select
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          <option value="ALL">Alla statusar</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <input
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Kommun"
          value={municipalityFilter}
          onChange={(event) => setMunicipalityFilter(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Kategori"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Dokumenttyp"
          value={documentTypeFilter}
          onChange={(event) => setDocumentTypeFilter(event.target.value)}
        />
        <input
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Verifierad av"
          value={verifiedBy}
          onChange={(event) => setVerifiedBy(event.target.value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            <span>Case-review ({casesTotal} arenden)</span>
            <span>{cases.length} visade</span>
          </div>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Arendenyckel</th>
                  <th className="px-3 py-2">Kommun</th>
                  <th className="px-3 py-2">Diarie</th>
                  <th className="px-3 py-2">Case-status</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr
                    key={item.id}
                    className={`cursor-pointer border-b border-slate-100 ${
                      selectedCaseId === item.id ? 'bg-blue-50' : 'bg-white'
                    }`}
                    onClick={() => setSelectedCaseId(item.id)}
                  >
                    <td className="px-3 py-2 font-bold text-slate-900">{item.caseKey}</td>
                    <td className="px-3 py-2 text-slate-700">{item.municipality || '-'}</td>
                    <td className="px-3 py-2 text-slate-700">{item.diarienummer || '-'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-lg border px-2 py-1 text-[10px] font-black ${caseStatusTone[item.caseReviewStatus]}`}
                      >
                        {item.caseReviewStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cases.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Inga arenden matchar filter.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-black">Casegranskning</p>
          {!selectedCase && (
            <p className="mt-2 text-sm text-slate-500">Valj ett arende for manuell granskning.</p>
          )}
          {selectedCase && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-lg border px-2 py-1 text-[10px] font-black ${caseStatusTone[selectedCase.caseReviewStatus]}`}
                >
                  {selectedCase.caseReviewStatus}
                </span>
                <span
                  className={`rounded-lg border px-2 py-1 text-[10px] font-black ${statusTone[selectedCase.reviewStatus]}`}
                >
                  {selectedCase.reviewStatus}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <MiniKpi label="Kommun" value={selectedCase.municipality || '-'} />
                <MiniKpi label="Diarienummer" value={selectedCase.diarienummer || '-'} />
                <MiniKpi label="Dokumenttyp" value={selectedCase.documentType || '-'} />
                <MiniKpi label="Verifierad av" value={selectedCase.validatedBy || '-'} />
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                <p className="font-bold text-slate-900">Subject</p>
                <p className="mt-1">{selectedCase.sourceSubject || '(saknas subject)'}</p>
                <p className="mt-3 font-bold text-slate-900">Fil</p>
                <p className="mt-1 break-all">{selectedCase.sourceFile}</p>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2">
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={caseStatusDraft}
                  onChange={(event) => setCaseStatusDraft(event.target.value as RequirementCaseReviewStatus)}
                >
                  {CASE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <textarea
                  className="min-h-[96px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Notering fran manuell granskning"
                  value={caseNotesDraft}
                  onChange={(event) => setCaseNotesDraft(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    disabled={busy === 'document'}
                    onClick={() => openDocument(selectedCase.documentId)}
                  >
                    Oppna källdokument
                  </button>
                  <button
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    disabled={busy === 'verify-case' || !canSaveCase}
                    onClick={saveCase}
                  >
                    {busy === 'verify-case' ? 'Sparar...' : 'Spara case-status'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            <span>
              Verifieringsko ({rowsTotal} kravrader, {casesTotal} arenden)
            </span>
            <span>
              Sida {page}/{totalPages}
            </span>
          </div>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Kravkod</th>
                  <th className="px-3 py-2">Kommun</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Dokument</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.requirementCode}
                    className={`cursor-pointer border-b border-slate-100 ${
                      selectedRequirementCode === row.requirementCode ? 'bg-blue-50' : 'bg-white'
                    }`}
                    onClick={() => setSelectedRequirementCode(row.requirementCode)}
                  >
                    <td className="px-3 py-2 font-bold text-slate-900">{row.requirementCode}</td>
                    <td className="px-3 py-2 text-slate-700">{row.case?.municipality || '-'}</td>
                    <td className="px-3 py-2 text-slate-700">{row.category}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-lg border px-2 py-1 text-[10px] font-black ${statusTone[row.verificationStatus]}`}
                      >
                        {row.verificationStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700"
                        onClick={(event) => {
                          event.stopPropagation();
                          openDocument(row.documentId);
                        }}
                      >
                        Oppna PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Ingen rad matchar filter.</p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs">
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-bold text-slate-700 disabled:opacity-50"
              disabled={page <= 1 || busy === 'rows'}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Forra
            </button>
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-bold text-slate-700 disabled:opacity-50"
              disabled={page >= totalPages || busy === 'rows'}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Nasta
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-black">Kravdetalj</p>
            {!selectedRow && <p className="mt-2 text-sm text-slate-500">Valj en kravrad for detaljer.</p>}
            {selectedRow && (
              <>
                <p className="mt-2 text-xs text-slate-600">
                  {selectedRow.case?.authorityName || 'Okand myndighet'} |{' '}
                  {selectedRow.case?.municipality || 'Okand kommun'}
                </p>
                <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  {selectedRow.requirementTextQuote}
                </p>
                <p className="mt-2 text-xs text-slate-600">{selectedRow.interpretedRequirement}</p>

                <div className="mt-3 grid grid-cols-1 gap-2">
                  <select
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={requirementStatusDraft}
                    onChange={(event) =>
                      setRequirementStatusDraft(event.target.value as RequirementVerificationStatus)
                    }
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Valideringskommentar"
                    value={validationComment}
                    onChange={(event) => setValidationComment(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Error type (vid REJECTED)"
                    value={requirementErrorType}
                    onChange={(event) => setRequirementErrorType(event.target.value)}
                  />
                  <button
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    disabled={busy === 'verify-requirement' || !canSaveRequirement}
                    onClick={saveRequirement}
                  >
                    {busy === 'verify-requirement' ? 'Sparar...' : 'Spara kravstatus'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-black">Citat</p>
            {citations.length === 0 && (
              <p className="mt-2 text-sm text-slate-500">Ingen citation kopplad till kravraden.</p>
            )}
            {citations.length > 0 && (
              <>
                <div className="mt-2 max-h-28 space-y-2 overflow-auto">
                  {citations.map((citation) => (
                    <button
                      key={citation.citationCode}
                      className={`w-full rounded-lg border px-2 py-1 text-left text-xs ${
                        selectedCitationCode === citation.citationCode
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200 bg-white'
                      }`}
                      onClick={() => setSelectedCitationCode(citation.citationCode)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800">{citation.citationCode}</span>
                        <span
                          className={`rounded border px-2 py-0.5 text-[10px] font-black ${statusTone[citation.verificationStatus]}`}
                        >
                          {citation.verificationStatus}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-600">
                        {citation.quoteText.slice(0, 110)}
                        {citation.quoteText.length > 110 ? '...' : ''}
                      </p>
                    </button>
                  ))}
                </div>

                {selectedCitation && (
                  <div className="mt-3 space-y-2">
                    <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                      {selectedCitation.quoteText}
                    </p>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      value={citationStatusDraft}
                      onChange={(event) =>
                        setCitationStatusDraft(event.target.value as RequirementVerificationStatus)
                      }
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="Sidnummer"
                      value={citationPageNumber}
                      onChange={(event) => setCitationPageNumber(event.target.value)}
                    />
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="Kommentar"
                      value={citationComment}
                      onChange={(event) => setCitationComment(event.target.value)}
                    />
                    <button
                      className="w-full rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      disabled={busy === 'verify-citation' || !canSaveCitation}
                      onClick={saveCitation}
                    >
                      {busy === 'verify-citation' ? 'Sparar...' : 'Spara citatstatus'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-black">Rapportpanel</p>
            <h4 className="text-base font-black text-slate-900">Tabeller A-D, KPI och exporter</h4>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={includePreliminarySummary}
                onChange={(event) => setIncludePreliminarySummary(event.target.checked)}
              />
              Inkludera preliminara (markerad varning)
            </label>
            <button
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              disabled={busy === 'summary'}
              onClick={loadSummary}
            >
              Uppdatera summary
            </button>
            <button
              className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              disabled={busy === 'export'}
              onClick={() =>
                downloadBinary(
                  `/api/admin/requirements/reports/export.csv?includePreliminary=${includePreliminarySummary ? 'true' : 'false'}`,
                  'GET',
                  'kravrapport.zip',
                )
              }
            >
              Export CSV (zip)
            </button>
            <button
              className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              disabled={busy === 'export'}
              onClick={() =>
                downloadBinary('/api/admin/requirements/reports/export.docx', 'POST', 'kravrapport.docx')
              }
            >
              Export DOCX
            </button>
            <button
              className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              disabled={busy === 'export'}
              onClick={() => void downloadPdfReport()}
            >
              Export PDF
            </button>
          </div>
        </div>

        {!summary && <p className="mt-3 text-sm text-slate-500">Ingen summary hamtad an.</p>}
        {summary && (
          <>
            {summary.warning && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                {summary.warning}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <MiniKpi label="Kravrader i scope" value={String(summary.totals.requirements)} />
              <MiniKpi label="Arenden i scope" value={String(summary.totals.cases)} />
              <MiniKpi label="Verifierade krav" value={String(summary.totals.verifiedRequirements)} />
              <MiniKpi label="Verifieringsgrad" value={`${summary.quality.verifiedRequirementsPct}%`} />
              <MiniKpi label="Kommuntackning" value={`${summary.quality.municipalityCoveragePct}%`} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <SimpleTable
                title="Tabell A - myndighet/dokumenttyp"
                headers={['Myndighetstyp', 'Myndighet', 'Doktyp', 'Antal']}
                rows={summary.tableA
                  .slice(0, 8)
                  .map((row) => [row.authorityType, row.authorityName, row.documentType, row.caseCount])}
              />
              <SimpleTable
                title="Tabell B - kravfrekvens kategori"
                headers={['Kategori', 'Antal']}
                rows={summary.tableB.slice(0, 8).map((row) => [row.category, row.requirementCount])}
              />
              <SimpleTable
                title="Tabell C - kommunskillnader"
                headers={['Kommun', 'Ytkonstruktion', 'DagvattenLakvatten']}
                rows={summary.tableC
                  .slice(0, 8)
                  .map((row) => [row.municipality, row.ytkonstruktion, row.dagvattenLakvatten])}
              />
              <SimpleTable
                title="Tabell D - avfallsslag/EWC"
                headers={['Avfallsslag', 'EWC', 'Antal']}
                rows={summary.tableD
                  .slice(0, 8)
                  .map((row) => [row.wasteType, row.ewcCode, row.requirementCount])}
              />
            </div>
          </>
        )}
      </div>

      {(localError || busy) && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          {busy && <p className="text-slate-600">Arbetar: {busy}</p>}
          {localError && <p className="font-bold text-rose-600">{localError}</p>}
        </div>
      )}
    </section>
  );
};

const MiniKpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500">{label}</p>
    <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
  </div>
);

const SimpleTable: React.FC<{ title: string; headers: string[]; rows: Array<Array<string | number>> }> = ({
  title,
  headers,
  rows,
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-200">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
      {title}
    </div>
    <div className="max-h-56 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.1em] text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${title}-${rowIndex}`} className="border-b border-slate-100">
              {row.map((value, cellIndex) => (
                <td key={`${title}-${rowIndex}-${cellIndex}`} className="px-3 py-2 text-slate-700">
                  {String(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">Inga rader.</p>}
    </div>
  </div>
);

export default AdminRequirementsStudio;
