import React, { useCallback, useEffect, useMemo, useState } from 'react';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

type CatalogSource = {
  name: string;
  activation: 'IMMEDIATE' | 'PERMIT_REQUIRED';
  reason: string;
  implementationKey?: string;
};

type OpenSyncResult = {
  source: string;
  ok: boolean;
  endpoint: string;
  status?: number;
  details?: string;
};

type SluProductStatus = {
  product: string;
  hasApiKey: boolean;
  hasBasePath: boolean;
};

type DispatchProvider = 'MOCK_FRAKTBORS' | 'TIMOCOM' | 'TRANS_EU';

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

const FALLBACK_CARDS: IntegrationCard[] = [
  {
    id: 'fallback-lant',
    name: 'Topografisk webbkarta',
    provider: 'Lantmateriet',
    dataType: 'WMS/WMTS fastighetsgranser',
    status: 'CONNECTED',
    lastSync: 'Fallback',
    complexity: 2,
    reason: 'Lokal fallbackvy nar API-token saknas.',
    activation: 'IMMEDIATE',
  },
  {
    id: 'fallback-nv',
    name: 'Natura 2000',
    provider: 'Naturvardsverket',
    dataType: 'Skyddade omraden (spatial)',
    status: 'CONNECTED',
    lastSync: 'Fallback',
    complexity: 3,
    reason: 'Lokal fallbackvy nar API-token saknas.',
    activation: 'IMMEDIATE',
  },
  {
    id: 'fallback-smhi',
    name: 'Oversvamningsrisk',
    provider: 'SMHI',
    dataType: 'Hydrologiska modeller',
    status: 'CONNECTED',
    lastSync: 'Fallback',
    complexity: 5,
    reason: 'Lokal fallbackvy nar API-token saknas.',
    activation: 'IMMEDIATE',
  },
  {
    id: 'fallback-slu',
    name: 'Artportalen',
    provider: 'SLU',
    dataType: 'Bioinventeringar',
    status: 'DISCONNECTED',
    lastSync: 'Permit required',
    complexity: 4,
    reason: 'SLU API kraver nyckel och baspath.',
    activation: 'PERMIT_REQUIRED',
  },
];

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
}

function providerIcon(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('lantmateriet') || p.includes('lantm')) return 'fa-map';
  if (p.includes('naturvardsverket') || p.includes('natura')) return 'fa-leaf';
  if (p.includes('sgu') || p.includes('geolog')) return 'fa-mountain';
  if (p.includes('lansstyrelsen')) return 'fa-landmark';
  if (p.includes('riksantikvarie') || p.includes('kultur')) return 'fa-monument';
  if (p.includes('msb')) return 'fa-water';
  if (p.includes('hav')) return 'fa-water';
  if (p.includes('slu') || p.includes('art')) return 'fa-bugs';
  if (p.includes('bolagsverket')) return 'fa-building';
  if (p.includes('bankid')) return 'fa-fingerprint';
  if (p.includes('smhi')) return 'fa-cloud-bolt';
  if (p.includes('smp') || p.includes('miljorapporteringsportalen')) return 'fa-file-contract';
  if (p.includes('trafikverket')) return 'fa-road';
  if (p.includes('scb')) return 'fa-chart-line';
  if (p.includes('boverket')) return 'fa-house';
  if (p.includes('diarier')) return 'fa-folder-open';
  if (p.includes('kontaktuppgifter')) return 'fa-address-book';
  return 'fa-network-wired';
}

function statusBadge(status: IntegrationStatus): { tone: string; label: string } {
  if (status === 'CONNECTED') {
    return { tone: 'bg-emerald-50 text-emerald-700', label: 'Aktiv' };
  }
  if (status === 'ERROR') {
    return { tone: 'bg-rose-50 text-rose-700', label: 'Fel' };
  }
  return { tone: 'bg-amber-50 text-amber-700', label: 'Krav saknas' };
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
  if (item.implementationKey === 'smp') return 'Miljorapportering och arendehantering (behorighetsstyrd)';
  if (item.implementationKey === 'trafikverket') return 'Transport- och anlaggningsdata (API)';
  if (item.implementationKey === 'bolagsverket') return 'Foretagsdata (avtalsstyrd API)';
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
  return 'Mock fraktbors';
}

const IntegrationsDashboard: React.FC = () => {
  const [cards, setCards] = useState<IntegrationCard[]>(FALLBACK_CARDS);
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
      setCards(FALLBACK_CARDS);
      setDispatchStatus(null);
      setDispatchCheckedAt(new Date().toISOString());
      setError('');
      setInfo('Admin-token saknas. Visar fallbackvy tills inloggning ar aktiv.');
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

    try {
      setError('');
      setInfo('');

      const catalogReq = fetchJson<{ ok: true; sources: CatalogSource[] }>('/api/datasources/catalog', 'GET');
      const lantReq = fetchJson<{ ok: true; result: { ok: boolean; status: number } }>('/api/datasources/lantmateriet/open/status', 'GET');
      const sluReq = fetchJson<{ ok: true; products: SluProductStatus[] }>('/api/datasources/slu/status', 'GET');
      const dispatchReq = fetchJson<{ ok: true; dispatch: DispatchRuntimeStatus; checkedAt?: string }>('/api/admin/dispatch/provider', 'GET');
      const openReq = withLiveCheck
        ? fetchJson<{ ok: true; results: OpenSyncResult[] }>('/api/datasources/open/sync', 'POST')
        : Promise.resolve(null);

      const [catalog, lant, slu, dispatch, openSync] = await Promise.all([catalogReq, lantReq, sluReq, dispatchReq, openReq]);

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
        const openResult = source.implementationKey ? openResultsByKey.get(source.implementationKey) : undefined;

        let status: IntegrationStatus = source.activation === 'PERMIT_REQUIRED' ? 'DISCONNECTED' : 'CONNECTED';
        let reason = source.reason;
        let endpoint: string | undefined;
        let latencyMs: number | undefined;
        let statusCode: number | undefined;

        if (source.implementationKey === 'slu') {
          status = allSluReady ? 'CONNECTED' : 'DISCONNECTED';
          reason = allSluReady ? 'SLU produkter har API-nyckel och path konfigurerat.' : 'SLU saknar API-nyckel eller base-path.';
          latencyMs = slu.latencyMs;
          statusCode = slu.status;
        } else if (source.implementationKey === 'smp') {
          if (openResult?.ok) {
            status = 'DISCONNECTED';
            reason = 'SMP portalen svarar, men behorig inloggning kravs for faktisk datatkomst.';
            endpoint = openResult.endpoint;
            statusCode = openResult.status;
          } else if (openResult) {
            status = 'ERROR';
            reason = openResult.details || 'SMP portalen kunde inte nas.';
            endpoint = openResult.endpoint;
            statusCode = openResult.status;
          }
        } else if (source.implementationKey?.startsWith('lantmateriet')) {
          status = lant.json.result.ok ? 'CONNECTED' : 'ERROR';
          reason = `Lantmateriet statuskod: ${lant.json.result.status}`;
          latencyMs = lant.latencyMs;
          statusCode = lant.json.result.status;
        }

        if (openResult && source.implementationKey !== 'smp') {
          status = openResult.ok ? 'CONNECTED' : 'ERROR';
          reason = openResult.ok
            ? `Livecheck OK (${openResult.status || 'n/a'})`
            : openResult.details || `Livecheck failed (${openResult.status || 'n/a'})`;
          endpoint = openResult.endpoint;
          statusCode = openResult.status;
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
      setInfo(withLiveCheck ? 'Livecheck genomford mot oppna datakallor.' : 'Integrationskatalog laddad.');
      setLastUpdatedAt(new Date().toISOString());
    } catch (loadError) {
      setCards(FALLBACK_CARDS);
      setDispatchStatus(null);
      setDispatchCheckedAt(new Date().toISOString());
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte ladda integrationsstatus.');
      setInfo('Fallbackvy aktiv tills API-session fungerar.');
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
  const permitRequiredCount = useMemo(() => cards.filter((card) => card.activation === 'PERMIT_REQUIRED').length, [cards]);
  const dispatchTone: 'default' | 'ok' | 'warn' = dispatchStatus
    ? dispatchStatus.fallbackActive
      ? 'warn'
      : 'ok'
    : 'default';
  const dispatchValue = dispatchStatus ? dispatchProviderLabel(dispatchStatus.activeProvider) : 'Ej tillgänglig';
  const avgLatency = useMemo(() => {
    const samples = cards.filter((card) => typeof card.latencyMs === 'number').map((card) => Number(card.latencyMs));
    if (samples.length === 0) return null;
    const sum = samples.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / samples.length);
  }, [cards]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in duration-500">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">Systemarkitektur och API</h2>
            <p className="mt-2 text-sm text-slate-600">
              Visar aktuell integrationsstatus for datakallor, tillstandsbehov och live-checkar.
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
          <Metric label="Fraktbors-provider" value={dispatchValue} tone={dispatchTone} />
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>Token: <span className="font-bold">{hasToken ? 'AKTIV' : 'SAKNAS'}</span></span>
          {dispatchStatus && (
            <span>
              Dispatch: <span className="font-bold">{dispatchProviderLabel(dispatchStatus.activeProvider)}</span>
              {dispatchStatus.fallbackActive ? ` (fallback fran ${dispatchProviderLabel(dispatchStatus.requestedProvider)})` : ''}
            </span>
          )}
          {avgLatency !== null && <span>Snittlatens: <span className="font-bold">{avgLatency} ms</span></span>}
          {lastUpdatedAt && <span>Senast uppdaterad: <span className="font-bold">{new Date(lastUpdatedAt).toLocaleString('sv-SE')}</span></span>}
          {dispatchCheckedAt && <span>Dispatch kollad: <span className="font-bold">{new Date(dispatchCheckedAt).toLocaleString('sv-SE')}</span></span>}
        </div>
        {dispatchStatus?.fallbackActive && (
          <p className="mt-2 text-xs text-amber-700">
            Konfigurerad provider saknar credentials. Runtime fallback anvands tills nycklar ar satta.
          </p>
        )}
        {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
        {info && <p className="mt-1 text-xs text-slate-600">{info}</p>}
      </header>

      {loading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-slate-600">Laddar integrationsstatus...</p>
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
                      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{card.provider}</p>
                    </div>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${badge.tone}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-slate-700">
                  <p>Datatyp: <span className="font-semibold">{card.dataType}</span></p>
                  <p>Komplexitet: <span className="font-semibold">{card.complexity}/5</span></p>
                  <p>Sync: <span className="font-semibold">{card.lastSync}</span></p>
                  <p>Aktivering: <span className="font-semibold">{card.activation === 'IMMEDIATE' ? 'Immediate' : 'Permit required'}</span></p>
                </div>

                <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">{card.reason}</p>
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
          Dashboarden visar nu faktisk API-status for katalog, Lantmateriet open status, SLU-konfiguration och valfri livecheck mot oppna kallor.
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
