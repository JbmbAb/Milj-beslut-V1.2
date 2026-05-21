import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getToken } from '../services/coreApiClient';
import { SystemStatus } from './SystemStatus';

export type CatalogSource = {
  name: string;
  activation: 'IMMEDIATE' | 'PERMIT_REQUIRED';
  reason: string;
  implementationKey?: string;
};

export type SluProductStatus = {
  product: string;
  hasApiKey: boolean;
  hasBasePath: boolean;
};

export type OpenSyncResult = {
  source: string;
  status: string;
  ok?: boolean;
  endpoint?: string;
  details?: string;
  [key: string]: unknown;
};

type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
type DispatchProvider = 'TIMOCOM' | 'TRANS_EU' | 'MOCK_FRAKTBORS' | 'NOT_CONFIGURED';

type DispatchRuntimeStatus = {
  requestedProvider: DispatchProvider;
  activeProvider: DispatchProvider;
  fallbackActive: boolean;
  credentials: {
    timocomConfigured: boolean;
    transEuConfigured: boolean;
  };
};

type IntegrationCard = {
  id: string;
  name: string;
  provider: string;
  dataType: string;
  status: IntegrationStatus;
  lastSync: string;
  complexity: 1 | 2 | 3 | 4 | 5;
  reason: string;
  activation: 'IMMEDIATE' | 'PERMIT_REQUIRED';
  latencyMs?: number;
  endpoint?: string;
};

function providerIcon(provider: string): string {
  const normalized = provider.toLowerCase();
  if (normalized.includes('lantmateriet') || normalized.includes('lantm')) return 'fa-map';
  if (normalized.includes('naturvardsverket') || normalized.includes('natura')) return 'fa-leaf';
  if (normalized.includes('sgu') || normalized.includes('geolog')) return 'fa-mountain';
  if (normalized.includes('lansstyrelsen')) return 'fa-landmark';
  if (normalized.includes('riksantikvarie') || normalized.includes('kultur')) return 'fa-monument';
  if (normalized.includes('msb') || normalized.includes('hav')) return 'fa-water';
  if (normalized.includes('slu') || normalized.includes('art')) return 'fa-bugs';
  if (normalized.includes('smed') || normalized.includes('emissions')) return 'fa-smog';
  if (normalized.includes('bolagsverket')) return 'fa-building';
  if (normalized.includes('bankid')) return 'fa-fingerprint';
  if (normalized.includes('smhi')) return 'fa-cloud-bolt';
  if (normalized.includes('smp') || normalized.includes('miljorapporteringsportalen'))
    return 'fa-file-contract';
  if (normalized.includes('trafikverket')) return 'fa-road';
  if (normalized.includes('scb')) return 'fa-chart-line';
  if (normalized.includes('boverket')) return 'fa-house';
  if (normalized.includes('diarier')) return 'fa-folder-open';
  if (normalized.includes('kontaktuppgifter')) return 'fa-address-book';
  return 'fa-network-wired';
}

function statusBadge(status: IntegrationStatus): { tone: string; label: string } {
  if (status === 'CONNECTED') {
    return { tone: 'bg-emerald-50 text-emerald-700', label: 'Aktiv' };
  }
  if (status === 'ERROR') {
    return { tone: 'bg-rose-50 text-rose-700', label: 'Fel' };
  }
  return { tone: 'bg-amber-50 text-amber-700', label: 'Ej verifierad' };
}

function asComplexity(activation: 'IMMEDIATE' | 'PERMIT_REQUIRED', key?: string): 1 | 2 | 3 | 4 | 5 {
  if (activation === 'PERMIT_REQUIRED') return 4;
  if (key === 'smhi' || key === 'msb') return 5;
  if (key === 'sgu' || key === 'slu' || key === 'lansstyrelsen' || key === 'riksantikvarieambetet') return 4;
  if (key === 'scb') return 2;
  if (key === 'kommun_kontakter_csv' || key === 'kommunala_diarier') return 2;
  return 3;
}

function resolveSourceDataType(item: CatalogSource): string {
  if (item.implementationKey === 'smhi') return 'Vader och hydrologiska API-data';
  if (item.implementationKey === 'scb') return 'Statistik API';
  if (item.implementationKey === 'sgu') return 'Geologiska lager och WMS';
  if (item.implementationKey === 'lansstyrelsen') return 'Regional geodata och metadata';
  if (item.implementationKey === 'riksantikvarieambetet') return 'Kulturmiljo och fornlarningsdata';
  if (item.implementationKey === 'naturvardsverket') return 'Miljodata och oppna datakallor';
  if (item.implementationKey?.startsWith('lantmateriet')) return 'Fastighets- och geodata';
  if (item.implementationKey === 'msb') return 'Risk- och oversvamningslager';
  if (item.implementationKey === 'slu') return 'Artobservationer och taxonomi';
  if (item.implementationKey === 'boverket') return 'Bygg- och klimatrelaterad oppen data';
  if (item.implementationKey === 'hav') return 'Marin och vattenrelaterad oppen data';
  if (item.implementationKey === 'kommun_kontakter_csv') return 'Lokal CSV-kalla med kommunkontakter';
  if (item.implementationKey === 'kommunala_diarier') return 'Kommunala diariekallor (index)';
  if (item.implementationKey === 'smp') return 'Miljorapportering och arendehantering';
  if (item.implementationKey === 'trafikverket') return 'Transport- och anlaggningsdata';
  if (item.implementationKey === 'bolagsverket') return 'Foretagsdata';
  if (item.implementationKey === 'bankid') return 'E-legitimering och stark autentisering';
  return item.activation === 'PERMIT_REQUIRED' ? 'Avtalsstyrd integration' : 'Oppna datakallor';
}

function formatLastSync(latencyMs?: number, statusCode?: number): string {
  if (typeof latencyMs === 'number' && typeof statusCode === 'number') {
    return `${statusCode} / ${latencyMs} ms`;
  }
  if (typeof latencyMs === 'number') {
    return `${latencyMs} ms`;
  }
  return 'Ej testad';
}

function dispatchProviderLabel(provider: DispatchProvider): string {
  if (provider === 'TIMOCOM') return 'TIMOCOM';
  if (provider === 'TRANS_EU') return 'Trans.eu';
  if (provider === 'MOCK_FRAKTBORS') return 'Ej verifierad provider';
  return 'Ej konfigurerad';
}

const IntegrationsDashboard: React.FC = () => {
  const [cards, setCards] = useState<IntegrationCard[]>([]);
  const [dispatchStatus, setDispatchStatus] = useState<DispatchRuntimeStatus | null>(null);
  const [dispatchCheckedAt, setDispatchCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  const hasToken = Boolean(getToken());

  const runLoad = useCallback(async (withLiveCheck: boolean) => {
    const token = getToken();
    if (!token) {
      setCards([]);
      setDispatchStatus(null);
      setDispatchCheckedAt(new Date().toISOString());
      setError('');
      setInfo('Inloggning kravs for att verifiera integrationsstatus.');
      setLastUpdatedAt(new Date().toISOString());
      setLoading(false);
      setSyncing(false);
      return;
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const fetchJson = async <T,>(path: string, method: 'GET' | 'POST' = 'GET') => {
      const startedAt = Date.now();
      const response = await fetch(path, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      const latencyMs = Date.now() - startedAt;
      const json = (await response.json()) as T & { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      return { json, latencyMs, status: response.status };
    };

    const fetchHealthJson = async <T,>(path: string, method: 'GET' | 'POST' = 'GET') => {
      const startedAt = Date.now();
      const response = await fetch(path, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      const latencyMs = Date.now() - startedAt;
      const json = (await response.json()) as T;
      return { json, latencyMs, status: response.status };
    };

    try {
      setError('');
      setInfo('');

      const catalogReq = fetchJson<{ ok: true; sources: CatalogSource[] }>('/api/datasources/catalog', 'GET');
      const lantReq = fetchHealthJson<{ ok: boolean; message: string; status: number }>(
        '/api/datasources/lantmateriet',
        'GET',
      );
      const sluReq = fetchJson<{ ok: true; products: SluProductStatus[] }>(
        '/api/datasources/slu/status',
        'GET',
      );
      const dispatchReq = fetchJson<{ ok: true; dispatch: DispatchRuntimeStatus; checkedAt?: string }>(
        '/api/admin/dispatch/provider',
        'GET',
      );
      const openReq = withLiveCheck
        ? fetchJson<{ ok: true; results: OpenSyncResult[] }>('/api/datasources/open/sync', 'POST')
        : Promise.resolve(null);

      const [catalog, lant, slu, dispatch, openSync] = await Promise.all([
        catalogReq,
        lantReq,
        sluReq,
        dispatchReq,
        openReq,
      ]);

      const openResultsByKey = new Map<string, OpenSyncResult>();
      if (openSync?.json?.results) {
        for (const row of openSync.json.results) {
          openResultsByKey.set(row.source, row);
        }
      }

      const allSluReady = Array.isArray(slu.json.products)
        ? slu.json.products.every((product) => product.hasApiKey && product.hasBasePath)
        : false;

      const nextCards: IntegrationCard[] = catalog.json.sources.map((source, index) => {
        const key = source.implementationKey || `catalog-${index}`;
        const openResult = source.implementationKey
          ? openResultsByKey.get(source.implementationKey)
          : undefined;

        let status: IntegrationStatus =
          source.activation === 'PERMIT_REQUIRED' ? 'DISCONNECTED' : 'CONNECTED';
        let reason = source.reason;
        let endpoint: string | undefined;
        let latencyMs: number | undefined;
        let statusCode: number | undefined;

        if (source.implementationKey === 'slu') {
          status = allSluReady ? 'CONNECTED' : 'DISCONNECTED';
          reason = allSluReady
            ? 'SLU-produkter har API-nyckel och base-path konfigurerat.'
            : 'SLU saknar API-nyckel eller base-path.';
          latencyMs = slu.latencyMs;
          statusCode = slu.status;
        } else if (source.implementationKey === 'smp') {
          if (openResult?.ok) {
            status = 'DISCONNECTED';
            reason = 'SMP svarar, men behrorig inloggning kravs for faktisk datatkomst.';
            endpoint = openResult.endpoint;
            statusCode = Number(openResult.status);
          } else if (openResult) {
            status = 'ERROR';
            reason = openResult.details || 'SMP kunde inte nas.';
            endpoint = openResult.endpoint;
            statusCode = Number(openResult.status);
          }
        } else if (source.implementationKey?.startsWith('lantmateriet')) {
          status = lant.json.ok ? 'CONNECTED' : 'ERROR';
          reason = lant.json.message;
          latencyMs = lant.latencyMs;
          statusCode = lant.json.status;
        }

        if (openResult && source.implementationKey !== 'smp') {
          status = openResult.ok ? 'CONNECTED' : 'ERROR';
          reason = openResult.ok
            ? `Livecheck OK (${openResult.status || 'n/a'})`
            : openResult.details || `Livecheck failed (${openResult.status || 'n/a'})`;
          endpoint = openResult.endpoint;
          statusCode = Number(openResult.status);
        }

        return {
          id: key,
          name: source.name,
          provider: source.name,
          dataType: resolveSourceDataType(source),
          status,
          lastSync: formatLastSync(latencyMs, statusCode),
          complexity: asComplexity(source.activation, source.implementationKey),
          reason,
          activation: source.activation,
          latencyMs,
          endpoint,
        };
      });

      setCards(nextCards);
      setDispatchStatus(dispatch.json.dispatch);
      setDispatchCheckedAt(dispatch.json.checkedAt || new Date().toISOString());
      setInfo(
        withLiveCheck
          ? 'Livecheck genomford mot backend och oppna datakallor.'
          : 'Integrationskatalog laddad.',
      );
      setLastUpdatedAt(new Date().toISOString());
    } catch (loadError) {
      setCards([]);
      setDispatchStatus(null);
      setDispatchCheckedAt(new Date().toISOString());
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte ladda integrationsstatus.');
      setInfo('Integrationsstatus kunde inte verifieras utan giltig API-session.');
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void runLoad(false);
  }, [runLoad]);

  useEffect(() => {
    const token = getToken();
    if (!token) return undefined;

    const intervalId = window.setInterval(() => {
      const currentToken = getToken();
      if (!currentToken) return;

      void fetch('/api/admin/dispatch/provider', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
      })
        .then(async (response) => {
          const json = (await response.json()) as {
            ok?: boolean;
            error?: string;
            dispatch?: DispatchRuntimeStatus;
            checkedAt?: string;
          };
          if (!response.ok || !json.ok || !json.dispatch) return;
          setDispatchStatus(json.dispatch);
          setDispatchCheckedAt(json.checkedAt || new Date().toISOString());
        })
        .catch(() => {
          // Keep previous provider status if polling fails.
        });
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const connectedCount = useMemo(() => cards.filter((card) => card.status === 'CONNECTED').length, [cards]);
  const errorCount = useMemo(() => cards.filter((card) => card.status === 'ERROR').length, [cards]);
  const permitRequiredCount = useMemo(
    () => cards.filter((card) => card.activation === 'PERMIT_REQUIRED').length,
    [cards],
  );
  const avgLatency = useMemo(() => {
    const samples = cards
      .filter((card) => typeof card.latencyMs === 'number')
      .map((card) => Number(card.latencyMs));
    if (samples.length === 0) return null;
    const sum = samples.reduce((accumulator, value) => accumulator + value, 0);
    return Math.round(sum / samples.length);
  }, [cards]);

  const dispatchTone: 'default' | 'ok' | 'warn' = dispatchStatus
    ? dispatchStatus.fallbackActive || dispatchStatus.activeProvider === 'NOT_CONFIGURED'
      ? 'warn'
      : 'ok'
    : 'default';
  const dispatchValue = dispatchStatus
    ? dispatchProviderLabel(dispatchStatus.activeProvider)
    : 'Ej tillganglig';

  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in duration-500">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">Systemarkitektur och API</h2>
            <p className="mt-2 text-sm text-slate-600">
              Visar backend-verifierad integrationsstatus for datakallor, tillstandsbehov och livecheckar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void runLoad(false);
              }}
              className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700"
            >
              Uppdatera
            </button>
            <button
              type="button"
              disabled={!hasToken || syncing}
              onClick={() => {
                setSyncing(true);
                void runLoad(true);
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white disabled:opacity-50"
            >
              {syncing ? 'Arbetar...' : 'Kor livecheck'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label="Kallor" value={String(cards.length)} />
          <Metric label="Aktiva" value={String(connectedCount)} tone="ok" />
          <Metric label="Fel" value={String(errorCount)} tone={errorCount > 0 ? 'warn' : 'ok'} />
          <Metric label="Permit required" value={String(permitRequiredCount)} />
          <Metric label="Dispatch" value={dispatchValue} tone={dispatchTone} />
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>
            Token: <span className="font-bold">{hasToken ? 'AKTIV' : 'SAKNAS'}</span>
          </span>
          {dispatchStatus && (
            <span>
              Dispatch:{' '}
              <span className="font-bold">{dispatchProviderLabel(dispatchStatus.activeProvider)}</span>
              {dispatchStatus.fallbackActive
                ? ` (begard provider: ${dispatchProviderLabel(dispatchStatus.requestedProvider)})`
                : ''}
            </span>
          )}
          {avgLatency !== null && (
            <span>
              Snittlatens: <span className="font-bold">{avgLatency} ms</span>
            </span>
          )}
          {lastUpdatedAt && (
            <span>
              Senast uppdaterad:{' '}
              <span className="font-bold">{new Date(lastUpdatedAt).toLocaleString('sv-SE')}</span>
            </span>
          )}
          {dispatchCheckedAt && (
            <span>
              Dispatch kollad:{' '}
              <span className="font-bold">{new Date(dispatchCheckedAt).toLocaleString('sv-SE')}</span>
            </span>
          )}
        </div>

        {dispatchStatus?.fallbackActive && (
          <p className="mt-2 text-xs text-amber-700">
            Transportprovider ar inte verifierad for operativ drift. Flodet blockeras tills riktig integration
            ar konfigurerad.
          </p>
        )}
        {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
        {info && <p className="mt-1 text-xs text-slate-600">{info}</p>}
      </header>

      <section>
        <h3 className="mb-4 ml-1 text-sm font-black uppercase tracking-[0.12em] text-slate-500">
          Infrastruktur
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SystemStatus />
        </div>
      </section>

      {loading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-slate-600">Laddar integrationsstatus...</p>
        </section>
      ) : cards.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">Inga verifierade integrationskort att visa.</p>
          <p className="mt-2 text-sm text-slate-500">
            Logga in med giltig session och kor om laddningen for att hamta backend-verifierad status.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const badge = statusBadge(card.status);
            return (
              <article key={card.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                      <i className={`fas ${providerIcon(card.provider)}`} />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-900">{card.name}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                        {card.provider}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${badge.tone}`}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-slate-700">
                  <p>
                    Datatyp: <span className="font-semibold">{card.dataType}</span>
                  </p>
                  <p>
                    Komplexitet: <span className="font-semibold">{card.complexity}/5</span>
                  </p>
                  <p>
                    Sync: <span className="font-semibold">{card.lastSync}</span>
                  </p>
                  <p>
                    Aktivering:{' '}
                    <span className="font-semibold">
                      {card.activation === 'IMMEDIATE' ? 'Immediate' : 'Permit required'}
                    </span>
                  </p>
                </div>

                <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {card.reason}
                </p>
                {card.endpoint && (
                  <p className="mt-2 truncate text-[10px] font-mono text-slate-500" title={card.endpoint}>
                    {card.endpoint}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm">
        <h3 className="text-lg font-black">Spatial Audit Engine</h3>
        <p className="mt-2 text-sm text-slate-300">
          Dashboarden visar nu endast backend-verifierad status. Nar integrationer saknar session eller
          konfiguration redovisas det som otillgangligt utan ersattningsdata.
        </p>
      </section>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; tone?: 'default' | 'ok' | 'warn' }> = ({
  label,
  value,
  tone = 'default',
}) => {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-800';

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
};

export default IntegrationsDashboard;
