import React, { useCallback, useState } from 'react';
import { callApi, getActiveProjectId } from '../../../../services/coreApiClient';

type GateDecision = 'PERMIT_REQUIRED' | 'NOTIFICATION_REQUIRED' | 'EXEMPT' | 'UNKNOWN_CODE';

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
  const [propertyDesignation, setPropertyDesignation] = useState('GÄVLE BRYNÄS 1:1');
  const [caseId, setCaseId] = useState('');
  const [mellanlagring, setMellanlagring] = useState<OperationDraft>(emptyOp('MELLANLAGRING'));
  const [deponi, setDeponi] = useState<OperationDraft>(emptyOp('DEPONI'));
  const [gateM, setGateM] = useState<GateDecision | null>(null);
  const [gateD, setGateD] = useState<GateDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setLoading(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ett fel uppstod');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const validateOne = async (op: OperationDraft, setter: (g: GateDecision) => void) => {
    const res = await callApi<{
      ok: boolean;
      gateDecision: GateDecision;
    }>('/api/c-notification/mass/validate-codes', {
      method: 'POST',
      body: {
        propertyDesignation,
        operationType: op.operationType,
        quantityPerYear: Number(op.quantityPerYear),
        ewcCode: op.ewcCode,
        sniCode: op.sniCode || undefined,
      },
    });
    if (res.ok) setter(res.gateDecision);
  };

  return (
    <div className="min-h-full bg-slate-50 px-8 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            C-anmälan — schaktmassor
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Massflöde och MPF/EWC</h1>
          <p className="mt-2 text-sm text-slate-600">
            Separat modul från kemikalie-C-anmälan. Mellanlagring och deponi bedöms var för sig.
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {message}
          </div>
        )}

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
            disabled={loading}
            className="rounded bg-slate-900 px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
            onClick={() =>
              run(async () => {
                const res = await callApi<{ ok: boolean; result?: unknown; warnings?: string[] }>(
                  '/api/c-notification/mass/property-search',
                  {
                    method: 'POST',
                    body: { projectId, propertyDesignation, purpose: 'c_anmalan_mass' },
                  },
                );
                setMessage(
                  res.ok
                    ? `Fastighet hittad. ${(res.warnings ?? []).join(' ') || ''}`.trim()
                    : 'Fastighetssök misslyckades',
                );
              })
            }
          >
            Sök fastighet
          </button>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
            2. Delbeslut (MPF + EWC)
          </h2>
          {(['MELLANLAGRING', 'DEPONI'] as const).map((type) => {
            const op = type === 'MELLANLAGRING' ? mellanlagring : deponi;
            const setOp = type === 'MELLANLAGRING' ? setMellanlagring : setDeponi;
            const gate = type === 'MELLANLAGRING' ? gateM : gateD;
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
                  onClick={() => run(() => validateOne(op, type === 'MELLANLAGRING' ? setGateM : setGateD))}
                >
                  Validera kod
                </button>
                {gate && (
                  <p className="text-xs text-slate-600">
                    Gate: <strong>{gate}</strong>
                  </p>
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
                  warnings?: string[];
                }>('/api/c-notification/mass/operations', {
                  method: 'POST',
                  body: {
                    caseId: caseId || undefined,
                    projectId,
                    propertyDesignation,
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
                  setCaseId(res.caseId);
                  setMessage(`Ärende ${res.caseId} sparat. ${(res.warnings ?? []).join(' ')}`);
                }
              })
            }
          >
            Spara delbeslut
          </button>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
            3. Underlag och inlämning
          </h2>
          <p className="text-xs text-slate-500">Ärende-ID: {caseId || '— skapa delbeslut först —'}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading || !caseId}
              className="rounded border px-3 py-2 text-xs font-bold disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  await callApi('/api/c-notification/mass/generate-documents', {
                    method: 'POST',
                    body: { caseId },
                  });
                  setMessage('Underlag genererat');
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
                  const res = await callApi<{ ok: boolean; export: unknown }>(
                    `/api/c-notification/mass/${encodeURIComponent(caseId)}/export`,
                  );
                  setExportJson(JSON.stringify(res.export, null, 2));
                  setMessage('Export hämtad');
                })
              }
            >
              Export
            </button>
            <button
              type="button"
              disabled={loading || !caseId}
              className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const res = await callApi<{ ok: boolean; referenceNumber: string }>(
                    '/api/c-notification/mass/submit',
                    { method: 'POST', body: { caseId } },
                  );
                  setMessage(`Inlämnad: ${res.referenceNumber}`);
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
      </div>
    </div>
  );
};

export default CNotificationMassUI;
