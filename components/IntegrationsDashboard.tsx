import React, { useCallback, useEffect, useMemo, useState } from 'react';

const PRIMARY_TOKEN_KEY = 'miljobeslut_admin_bearer';
const LEGACY_TOKEN_KEY = 'riskguard_admin_bearer';

type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
type DispatchProvider = 'MOCK_FRAKTBORS' | 'TIMOCOM' | 'TRANS_EU' | 'NOT_CONFIGURED';

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

type PublicSummaryResponse = {
  ok: boolean;
  summary?: {
    cards: IntegrationCard[];
    dispatch: DispatchRuntimeStatus;
    checkedAt: string;
  };
  error?: string;
};

const FALLBACK_CARDS: IntegrationCard[] = [
  {
    id: 'fallback-nvr',
    name: 'Skyddad natur',
    provider: 'Naturvardsverket',
    dataType: 'API',
    status: 'CONNECTED',
    lastSync: 'Fallback',
    complexity: 3,
    reason: 'Lokal fallbackvy tills publikt summary-svar finns.',
    activation: 'IMMEDIATE',
  },
  {
    id: 'fallback-sgu',
    name: 'SGU risklager',
    provider: 'SGU',
    dataType: 'PostGIS och OGC',
    status: 'CONNECTED',
    lastSync: 'Fallback',
    complexity: 4,
    reason: 'Full import finns i lokal databas.',
    activation: 'IMMEDIATE',
  },
  {
    id: 'fallback-hydro',
    name: 'Hydrologisk audit',
    provider: 'Lokal hydro / VISS API',
    dataType: 'Audit',
    status: 'DISCONNECTED',
    lastSync: 'Fallback',
    complexity: 4,
    reason: 'Fallbackvyn antar inte anonym VISS-livekoppling. Lokal hydrotabell eller riktig VISS-behorighet kravs.',
    activation: 'IMMEDIATE',
  },
];

function hasAdminToken(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    String(window.localStorage.getItem(PRIMARY_TOKEN_KEY) || '').trim() ||
      String(window.localStorage.getItem(LEGACY_TOKEN_KEY) || '').trim(),
  );
}

function providerIcon(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('lantmateriet') || p.includes('lantm')) return 'fa-map';
  if (p.includes('naturvardsverket') || p.includes('natura')) return 'fa-leaf';
  if (p.includes('sgu') || p.includes('geolog')) return 'fa-mountain';
  if (p.includes('lansstyrelsen')) return 'fa-landmark';
  if (p.includes('riksantikvarie') || p.includes('kultur')) return 'fa-monument';
  if (p.includes('msb') || p.includes('smhi') || p.includes('hav')) return 'fa-water';
  if (p.includes('slu') || p.includes('art')) return 'fa-bugs';
  if (p.includes('trafikverket')) return 'fa-road';
  if (p.includes('bankid')) return 'fa-fingerprint';
  if (p.includes('scb')) return 'fa-chart-line';
  return 'fa-network-wired';
}

function statusBadge(status: IntegrationStatus): { tone: string; label: string } {
  if (status === 'CONNECTED') return { tone: 'bg-emerald-50 text-emerald-700', label: 'Aktiv' };
  if (status === 'ERROR') return { tone: 'bg-rose-50 text-rose-700', label: 'Fel' };
  return { tone: 'bg-amber-50 text-amber-700', label: 'Krav saknas' };
}

function dispatchProviderLabel(provider: DispatchProvider): string {
  if (provider === 'TIMOCOM') return 'TIMOCOM';
  if (provider === 'TRANS_EU') return 'Trans.eu';
  if (provider === 'NOT_CONFIGURED') return 'Ej konfigurerad';
  return 'Historisk mockdata';
}

const IntegrationsDashboard: React.FC = () => {
  const [cards, setCards] = useState<IntegrationCard[]>(FALLBACK_CARDS);
  const [dispatchStatus, setDispatchStatus] = useState<DispatchRuntimeStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  const loadSummary = useCallback(async (forceRefresh: boolean) => {
    try {
      setError('');
      const suffix = forceRefresh ? '?refresh=1' : '';
      const response = await fetch(`/api/datasources/public-summary${suffix}`);
      const payload = (await response.json()) as PublicSummaryResponse;
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      setCards(payload.summary.cards);
      setDispatchStatus(payload.summary.dispatch);
      setCheckedAt(payload.summary.checkedAt);
      setInfo(forceRefresh ? 'Livecheck genomford mot publika datakallor.' : 'Publik integrationssammanstallning laddad.');
      setLastUpdatedAt(new Date().toISOString());
    } catch (loadError) {
      setCards(FALLBACK_CARDS);
      setDispatchStatus(null);
      setCheckedAt(new Date().toISOString());
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte ladda integrationsstatus.');
      setInfo('Fallbackvy aktiv tills summary-endpointen svarar igen.');
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary(false);
  }, [loadSummary]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadSummary(false);
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [loadSummary]);

  const connectedCount = useMemo(() => cards.filter((card) => card.status === 'CONNECTED').length, [cards]);
  const errorCount = useMemo(() => cards.filter((card) => card.status === 'ERROR').length, [cards]);
  const permitRequiredCount = useMemo(() => cards.filter((card) => card.activation === 'PERMIT_REQUIRED').length, [cards]);
  const bankIdCard = useMemo(() => cards.find((card) => card.id === 'bankid'), [cards]);
  const averageComplexity = useMemo(() => {
    if (cards.length === 0) return null;
    const sum = cards.reduce((acc, card) => acc + card.complexity, 0);
    return (sum / cards.length).toFixed(1);
  }, [cards]);
  const dispatchTone: 'default' | 'ok' | 'warn' = dispatchStatus
    ? dispatchStatus.fallbackActive || dispatchStatus.activeProvider === 'NOT_CONFIGURED'
      ? 'warn'
      : 'ok'
    : 'default';

  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in duration-500">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">Systemarkitektur och API</h2>
            <p className="mt-2 text-sm text-slate-600">
              Publik runtime-status for datakallor, tillgang och human-in-the-loop-krav.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void loadSummary(false);
              }}
              className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700"
            >
              Uppdatera
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={() => {
                setSyncing(true);
                void loadSummary(true);
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
          <Metric label="Tillstånd krävs" value={String(permitRequiredCount)} />
          <Metric label="Dispatch" value={dispatchStatus ? dispatchProviderLabel(dispatchStatus.activeProvider) : 'Ej tillganglig'} tone={dispatchTone} />
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>Admin-token: <span className="font-bold">{hasAdminToken() ? 'AKTIV' : 'EJ KRAVD FOR STATUSVY'}</span></span>
          {averageComplexity && <span>Snittkomplexitet: <span className="font-bold">{averageComplexity}/5</span></span>}
          {lastUpdatedAt && <span>Senast uppdaterad: <span className="font-bold">{new Date(lastUpdatedAt).toLocaleString('sv-SE')}</span></span>}
          {checkedAt && <span>Summary kollad: <span className="font-bold">{new Date(checkedAt).toLocaleString('sv-SE')}</span></span>}
        </div>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-black uppercase tracking-[0.14em] text-[11px]">MVP-notering</p>
          <p className="mt-1">
            BankID ar sista oppna punkt innan MVP-lansering. Ovriga publika UI-korrigeringar ar stangda, men human in the loop kvarstar i alla steg.
          </p>
          {bankIdCard && (
            <p className="mt-2 text-xs text-amber-800">
              Nuvarande BankID-status: <span className="font-bold">{bankIdCard.status}</span>. {bankIdCard.reason}
            </p>
          )}
        </div>

        {dispatchStatus && (dispatchStatus.fallbackActive || dispatchStatus.activeProvider === 'NOT_CONFIGURED') && (
          <p className="mt-2 text-xs text-amber-700">
            Konfigurerad dispatch-provider saknar credentials. Transportflodet ar blockerat tills riktiga nycklar ar satta.
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
                  <p>Aktivering: <span className="font-semibold">{card.activation === 'IMMEDIATE' ? 'Omedelbar' : 'Tillstånd krävs'}</span></p>
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
          Dashboarden visar nu faktisk publikt lasbar runtime-status. Juridiskt skarpa bedomningar ligger fortsatt i audit-floden med manuell granskning.
        </p>
      </section>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; tone?: 'default' | 'ok' | 'warn' }> = ({ label, value, tone = 'default' }) => {
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
