import React, { useCallback, useMemo, useState } from 'react';
import { callApi, getActiveProjectId } from '../../../../services/coreApiClient';
import { isSensitiveAreaFromMassGis } from '../../../../services/massSpatialSensitivity';
import type { MassGISAnalysis, MassSiteProfile, MpfDecisionSummary } from '../../../../types';
import { useMassGisAnalysis } from '../../hooks/useMassGisAnalysis';
import MassMapView from './MassMapView';
import MpfGeofenceOverlay from './MpfGeofenceOverlay';
import '../module-common.css';

type MassStep = 'property' | 'operations' | 'submission';

type OperationDraft = {
  operationType: 'MELLANLAGRING' | 'DEPONI';
  ewcCode: string;
  quantityPerYear: string;
  sniCode: string;
  capacityM3: string;
  receiverName: string;
};

const emptyOp = (type: 'MELLANLAGRING' | 'DEPONI'): OperationDraft => ({
  operationType: type,
  ewcCode: type === 'MELLANLAGRING' ? '17 05 04' : '17 05 03*',
  quantityPerYear: '5000',
  sniCode: '',
  capacityM3: '1000',
  receiverName: '',
});

export const CNotificationMassUI: React.FC = () => {
  const projectId = getActiveProjectId() || 'demo-project';
  const [currentStep, setCurrentStep] = useState<MassStep>('property');
  const [propertyDesignation, setPropertyDesignation] = useState('GÄVLE BRYNÄS 1:1');
  const [gisAnalysis, setGisAnalysis] = useState<MassGISAnalysis | null>(null);
  const [siteProfile, setSiteProfile] = useState<MassSiteProfile | null>(null);
  const [caseId, setCaseId] = useState('');
  const [mellanlagring, setMellanlagring] = useState<OperationDraft>(emptyOp('MELLANLAGRING'));
  const [deponi, setDeponi] = useState<OperationDraft>(emptyOp('DEPONI'));
  const [decisionM, setDecisionM] = useState<MpfDecisionSummary | null>(null);
  const [decisionD, setDecisionD] = useState<MpfDecisionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);

  const mergedGeofenceLayers = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...(decisionM?.geofenceLayers ?? []), ...(decisionD?.geofenceLayers ?? [])];
    return merged.filter((layer) => {
      if (seen.has(layer.key)) return false;
      seen.add(layer.key);
      return true;
    });
  }, [decisionM, decisionD]);

  const mergedRequiredMapLayers = useMemo(
    () => mergedGeofenceLayers.map((layer) => layer.key),
    [mergedGeofenceLayers],
  );

  const siteIsSensitive = useMemo(
    () => Boolean(gisAnalysis && isSensitiveAreaFromMassGis(gisAnalysis)),
    [gisAnalysis],
  );

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const buildSituationMapSvg = (payload: Record<string, unknown>) => {
    const gis = (payload.gis as Record<string, unknown> | null) ?? null;
    const centroid = (gis?.centroid as { lat?: number; lng?: number } | undefined) ?? {};
    const recommendedZones = (
      (gis?.recommendedZones as Array<Record<string, unknown>> | undefined) ?? []
    ).slice(0, 8);

    const width = 960;
    const height = 540;
    const centerX = 480;
    const centerY = 260;
    const zoneColors: Record<string, string> = {
      MELLANLAGRING: '#4f46e5',
      DEPONI: '#059669',
      TRANSIT: '#475569',
    };

    const zoneNodes = recommendedZones
      .map((zone, index) => {
        const operationType = String(zone.operationType || 'TRANSIT');
        const label = String(zone.label || operationType);
        const color = zoneColors[operationType] ?? '#475569';
        const angle = (index / Math.max(recommendedZones.length, 1)) * Math.PI * 2;
        const radius = 120;
        const x = Math.round(centerX + Math.cos(angle) * radius);
        const y = Math.round(centerY + Math.sin(angle) * radius);
        return `<g><circle cx="${x}" cy="${y}" r="18" fill="${color}" /><text x="${x}" y="${
          y + 34
        }" text-anchor="middle" font-size="13" fill="#334155">${label}</text></g>`;
      })
      .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <rect x="30" y="30" width="900" height="480" rx="18" fill="#ffffff" stroke="#cbd5e1" />
  <text x="60" y="74" font-size="28" font-weight="700" fill="#0f172a">Situationskarta - C-anmälan schaktmassor</text>
  <text x="60" y="104" font-size="16" fill="#334155">Fastighet: ${propertyDesignation}</text>
  <text x="60" y="130" font-size="14" fill="#475569">Centroid: ${Number(centroid.lat || 0).toFixed(5)}, ${Number(
    centroid.lng || 0,
  ).toFixed(5)}</text>
  <circle cx="${centerX}" cy="${centerY}" r="42" fill="#dbeafe" stroke="#2563eb" stroke-width="2" />
  <text x="${centerX}" y="${centerY + 6}" text-anchor="middle" font-size="14" fill="#1e3a8a">Fastighet</text>
  ${zoneNodes}
  <text x="60" y="486" font-size="12" fill="#64748b">Human-in-the-loop: juridisk slutgranskning krävs</text>
</svg>`;
  };

  const fetchCaseExport = async () => {
    if (!caseId) {
      throw new Error('Ärende-ID saknas. Spara delbeslut först.');
    }
    return callApi<{ ok: boolean; export: Record<string, unknown> }>(
      `/api/c-notification/mass/${encodeURIComponent(caseId)}/export`,
      { method: 'GET' },
    );
  };

  const {
    mutate: runGisAnalysis,
    isPending: isAnalyzingGis,
    error: gisError,
  } = useMassGisAnalysis({
    onSuccess: (data) => {
      setGisAnalysis(data.analysis);
      setSiteProfile(data.siteProfile);
      setMessage(`GIS-analys klar (${data.propertySource}).`);
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const run = useCallback(async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ett fel uppstod');
    } finally {
      setLoading(false);
    }
  }, []);

  const validateOne = async (op: OperationDraft, setter: (decision: MpfDecisionSummary | null) => void) => {
    const res = await callApi<{
      ok: boolean;
      mpfDecision: MpfDecisionSummary;
    }>('/api/c-notification/mass/validate-codes', {
      method: 'POST',
      body: {
        propertyDesignation,
        operationType: op.operationType,
        quantityPerYear: Number(op.quantityPerYear),
        ewcCode: op.ewcCode,
        sniCode: op.sniCode || undefined,
        isSensitiveArea: gisAnalysis ? isSensitiveAreaFromMassGis(gisAnalysis) : undefined,
        siteLat: gisAnalysis?.centroid.lat,
        siteLng: gisAnalysis?.centroid.lng,
      },
    });
    if (res.ok) {
      setter(res.mpfDecision);
    }
  };

  const steps: Array<{ id: MassStep; label: string }> = [
    { id: 'property', label: 'Fastighet & GIS' },
    { id: 'operations', label: 'Delbeslut' },
    { id: 'submission', label: 'Inlämning' },
  ];

  return (
    <div className="min-h-full bg-slate-50 px-8 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            C-anmälan — schaktmassor
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Massflöde, GIS och MPF/EWC</h1>
          <p className="mt-2 text-sm text-slate-600">
            Eget GIS-flöde för schaktmassor — separat från enskilt avlopp och lokaliseringsutredning.
          </p>
        </header>

        <nav className="flex flex-wrap gap-2">
          {steps.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => setCurrentStep(step.id)}
              className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide ${
                currentStep === step.id
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {step.label}
            </button>
          ))}
        </nav>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        )}
        {gisError && currentStep === 'property' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {gisError.message}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {message}
          </div>
        )}

        {currentStep === 'property' && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">1. Fastighet</h2>
              <input
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                value={propertyDesignation}
                onChange={(e) => setPropertyDesignation(e.target.value)}
                placeholder="Fastighetsbeteckning"
              />
              <button
                type="button"
                disabled={isAnalyzingGis || !propertyDesignation.trim()}
                className="rounded bg-slate-900 px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
                onClick={() =>
                  runGisAnalysis({
                    projectId,
                    propertyDesignation: propertyDesignation.trim(),
                  })
                }
              >
                {isAnalyzingGis ? 'Analyserar GIS…' : 'Kör GIS-analys'}
              </button>
            </section>

            {gisAnalysis && siteProfile && (
              <>
                <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
                    2. Platsbedömning
                  </h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded border border-slate-100 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-400">Riskpoäng</p>
                      <p className="text-2xl font-black text-slate-900">{gisAnalysis.overallRiskScore}/100</p>
                    </div>
                    <div className="rounded border border-slate-100 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-400">Logistik</p>
                      <p className="text-sm font-bold text-slate-800">{gisAnalysis.logisticsSuitability}</p>
                    </div>
                    <div className="rounded border border-slate-100 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-400">Marktäcke</p>
                      <p className="text-sm font-bold text-slate-800">
                        {gisAnalysis.markCover?.description ?? 'Ej verifierat'}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {gisAnalysis.siteConstraints.map((item) => (
                      <li key={item.code} className="rounded border border-slate-100 px-3 py-2">
                        <span className="font-bold">{item.severity}</span> — {item.label}
                      </li>
                    ))}
                  </ul>
                  {(gisAnalysis.warnings?.length ?? 0) > 0 && (
                    <ul className="text-xs text-amber-800">
                      {gisAnalysis.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <MassMapView
                  analysis={gisAnalysis}
                  siteProfile={siteProfile}
                  requiredMapLayers={mergedRequiredMapLayers}
                />

                {mergedGeofenceLayers.length > 0 && (
                  <MpfGeofenceOverlay layers={mergedGeofenceLayers} isSensitiveArea={siteIsSensitive} />
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold uppercase text-white"
                    onClick={() => setCurrentStep('operations')}
                  >
                    Fortsätt till delbeslut
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {currentStep === 'operations' && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Delbeslut (MPF + EWC)
            </h2>
            {!gisAnalysis && (
              <p className="text-xs text-amber-700">
                GIS-analys saknas — kör steg 1 först för bättre platsunderlag.
              </p>
            )}
            {(['MELLANLAGRING', 'DEPONI'] as const).map((type) => {
              const op = type === 'MELLANLAGRING' ? mellanlagring : deponi;
              const setOp = type === 'MELLANLAGRING' ? setMellanlagring : setDeponi;
              const decision = type === 'MELLANLAGRING' ? decisionM : decisionD;
              return (
                <div key={type} className="rounded border border-slate-100 p-4 space-y-2">
                  <p className="text-xs font-bold text-slate-700">{type}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="rounded border px-2 py-1 text-sm"
                      placeholder="EWC"
                      value={op.ewcCode}
                      onChange={(e) => setOp({ ...op, ewcCode: e.target.value })}
                    />
                    <input
                      className="rounded border px-2 py-1 text-sm"
                      placeholder="ton/år"
                      value={op.quantityPerYear}
                      onChange={(e) => setOp({ ...op, quantityPerYear: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    className="text-xs font-bold text-indigo-600"
                    onClick={() =>
                      run(() => validateOne(op, type === 'MELLANLAGRING' ? setDecisionM : setDecisionD))
                    }
                  >
                    Validera kod
                  </button>
                  {decision && (
                    <div className="rounded border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                      <p>
                        Gate: <strong>{decision.gateDecision}</strong>
                      </p>
                      <p>
                        Primär källa: <strong>{decision.primaryCodeType ?? 'okänd'}</strong>
                        {decision.activityCode ? ` · MPF-aktivitet ${decision.activityCode}` : ''}
                      </p>
                      {decision.primaryPermitProfile && (
                        <p>
                          Spår: <strong>{decision.primaryPermitProfile.regulatoryTrack}</strong> · Risk:{' '}
                          <strong>{decision.primaryPermitProfile.riskTier}</strong>
                        </p>
                      )}
                      <p>{decision.notes}</p>
                      {decision.advisorySignals.length > 0 && (
                        <ul className="list-disc pl-4 text-amber-800">
                          {decision.advisorySignals.map((signal) => (
                            <li key={signal}>{signal}</li>
                          ))}
                        </ul>
                      )}
                      {decision.requiredMapLayers.length > 0 && (
                        <MpfGeofenceOverlay
                          layers={decision.geofenceLayers}
                          isSensitiveArea={decision.isSensitiveArea}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              disabled={loading}
              className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const res = await callApi<{
                    ok: boolean;
                    caseId: string;
                    decisions?: {
                      mellanlagring?: { mpfDecision?: MpfDecisionSummary | null } | null;
                      deponi?: { mpfDecision?: MpfDecisionSummary | null } | null;
                    };
                    warnings?: string[];
                  }>('/api/c-notification/mass/operations', {
                    method: 'POST',
                    body: {
                      caseId: caseId || undefined,
                      projectId,
                      propertyDesignation,
                      gisSnapshot:
                        gisAnalysis && siteProfile
                          ? {
                              analysis: gisAnalysis,
                              siteProfile,
                              analyzedAt: gisAnalysis.timestamp,
                            }
                          : undefined,
                      operations: [
                        {
                          ...mellanlagring,
                          quantityPerYear: Number(mellanlagring.quantityPerYear),
                          capacityM3: Number(mellanlagring.capacityM3) || undefined,
                        },
                        {
                          ...deponi,
                          quantityPerYear: Number(deponi.quantityPerYear),
                          capacityM3: Number(deponi.capacityM3) || undefined,
                        },
                      ],
                    },
                  });
                  if (res.ok) {
                    setDecisionM(res.decisions?.mellanlagring?.mpfDecision ?? decisionM);
                    setDecisionD(res.decisions?.deponi?.mpfDecision ?? decisionD);
                    setCaseId(res.caseId);
                    setMessage(`Ärende ${res.caseId} sparat. ${(res.warnings ?? []).join(' ')}`);
                    setCurrentStep('submission');
                  }
                })
              }
            >
              Spara delbeslut
            </button>
          </section>
        )}

        {currentStep === 'submission' && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Underlag och inlämning
            </h2>
            <p className="text-xs text-slate-500">Ärende-ID: {caseId || '— skapa delbeslut först —'}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading || !caseId}
                className="rounded border px-3 py-2 text-xs font-bold disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await callApi<{
                      ok: boolean;
                      documents?: { situationsplan?: { title: string } | null };
                      warnings?: string[];
                    }>('/api/c-notification/mass/generate-documents', {
                      method: 'POST',
                      body: { caseId },
                    });
                    const planNote = res.documents?.situationsplan
                      ? 'Situationsplan inkluderad i underlaget.'
                      : 'Situationsplan saknas — kör GIS-analys och spara delbeslut.';
                    const warnNote = (res.warnings ?? []).join(' ');
                    setMessage(['Underlag genererat.', planNote, warnNote].filter(Boolean).join(' '));
                  })
                }
              >
                Generera underlag
              </button>
              <button
                type="button"
                disabled={loading || !caseId}
                className="rounded border px-3 py-2 text-xs font-bold disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await fetchCaseExport();
                    const svg = buildSituationMapSvg(res.export);
                    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                    downloadBlob(blob, `situationskarta-${caseId}.svg`);
                    setMessage('Situationskarta nedladdad.');
                  })
                }
              >
                Ladda ner situationskarta
              </button>
              <button
                type="button"
                disabled={loading || !caseId}
                className="rounded border px-3 py-2 text-xs font-bold disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await fetchCaseExport();
                    const pdfBlob = await callApi<Blob>('/api/export/pdf-json', {
                      method: 'POST',
                      body: {
                        title: `C-anmälan schaktmassor - ${caseId}`,
                        subtitle: `Fastighet ${propertyDesignation}`,
                        json: {
                          ...res.export,
                          exportedAt: new Date().toISOString(),
                          humanInTheLoop:
                            'Underlaget är AI-assisterat. Handläggare ska verifiera uppgifterna innan myndighetsinlämning.',
                        },
                      },
                    });
                    downloadBlob(pdfBlob, `c-anmalan-schaktmassor-${caseId}.pdf`);
                    setMessage('PDF-export klar.');
                  })
                }
              >
                Exportera PDF
              </button>
              <button
                type="button"
                disabled={loading || !caseId}
                className="rounded border px-3 py-2 text-xs font-bold disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await fetchCaseExport();
                    setExportJson(JSON.stringify(res.export, null, 2));
                    setMessage('Export hämtad');
                  })
                }
              >
                Visa exportdata
              </button>
              <button
                type="button"
                disabled={loading || !caseId}
                className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await callApi<{ ok: boolean; referenceNumber: string; warnings?: string[] }>(
                      '/api/c-notification/mass/submit',
                      { method: 'POST', body: { caseId } },
                    );
                    const warningNote = (res.warnings ?? []).join(' ');
                    setMessage(
                      [`Inlämnad: ${res.referenceNumber}`, warningNote].filter(Boolean).join(' '),
                    );
                  })
                }
              >
                Skicka in
              </button>
            </div>
            {exportJson && (
              <pre className="max-h-48 overflow-auto rounded bg-slate-100 p-3 text-[10px]">{exportJson}</pre>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default CNotificationMassUI;
