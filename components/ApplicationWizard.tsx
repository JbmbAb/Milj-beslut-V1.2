import React, { useEffect, useMemo, useState } from 'react';

const ACCESS_TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_TOKEN_KEY = 'miljobeslut_admin_refresh';
const DEFAULT_COORDS = { lat: '64.1107808', lng: '19.01208091' };
const STOCKHOLM_COORDS = { lat: '59.3293', lng: '18.0686' };
const MAX_BANKID_POLLS = 60;

type StepId = 1 | 2 | 3 | 4;
type BankIdStatus = 'idle' | 'starting' | 'pending' | 'complete' | 'manual_review' | 'failed';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type SourceRef = { web?: { title: string; uri: string } };

type BankIdState = {
  status: BankIdStatus;
  orderRef: string | null;
  autoStartToken: string | null;
  qrPayload: string | null;
  hintCode: string | null;
  pollCount: number;
  error: string | null;
  user: { id: string; organisationId: string; role: string } | null;
};

type AuditBundle = {
  lat: number;
  lng: number;
  spatial: any | null;
  climate: any | null;
  heritage: any | null;
  water: any | null;
  issues: string[];
};

type SummaryCardModel = {
  title: string;
  tone: 'ok' | 'warn' | 'critical' | 'manual';
  status: string;
  description: string;
};

const STEPS: Array<{ id: StepId; title: string; icon: string }> = [
  { id: 1, title: 'Identitet', icon: 'fa-fingerprint' },
  { id: 2, title: 'Plats', icon: 'fa-location-crosshairs' },
  { id: 3, title: 'Auditsvar', icon: 'fa-shield-check' },
  { id: 4, title: 'Manuell grind', icon: 'fa-user-check' },
];

function parseCoordinate(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinatesAreValid(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function extractError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  if (typeof record.details === 'string' && record.details.trim()) return record.details;
  return fallback;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractError(payload, `HTTP ${response.status}`));
  }
  return payload as T;
}

function bankIdDeepLink(autoStartToken: string | null): string | null {
  if (!autoStartToken) return null;
  return `bankid:///?autostarttoken=${encodeURIComponent(autoStartToken)}&redirect=null`;
}

function formatDistance(distance: number | null | undefined): string {
  if (distance == null || !Number.isFinite(distance)) return 'okant avstand';
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toFixed(1)} km`;
}

function riskLabel(risk: RiskLevel | null): string {
  if (risk === 'HIGH') return 'Hog';
  if (risk === 'MEDIUM') return 'Medel';
  if (risk === 'LOW') return 'Lag';
  return 'Okand';
}

function cardToneFromRisk(risk: RiskLevel): SummaryCardModel['tone'] {
  if (risk === 'HIGH') return 'critical';
  if (risk === 'MEDIUM') return 'warn';
  return 'ok';
}

function computeOverallRisk(bundle: AuditBundle | null): RiskLevel | null {
  if (!bundle) return null;
  if (bundle.spatial?.isProtected) return 'HIGH';
  if (bundle.spatial?.sgu?.riskLevel === 'HIGH') return 'HIGH';
  if (bundle.climate?.isFlooded) return 'HIGH';
  if (bundle.heritage?.hasHeritageRisk || bundle.water?.hasWaterRisk || bundle.spatial?.sgu?.riskLevel === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

function buildSourceList(bundle: AuditBundle | null): SourceRef[] {
  if (!bundle) return [];
  const sources: SourceRef[] = [...(bundle.spatial?.sources || [])];
  if (bundle.heritage?.source === 'raa_live' || bundle.heritage?.source === 'local_postgis') {
    sources.push({
      web: {
        title: 'RAA lamningar',
        uri: 'https://pub.raa.se/visning/lamningar_v1/wfs?service=WFS&request=GetCapabilities',
      },
    });
  }
  if (bundle.climate?.source === 'msb_live' || bundle.climate?.source === 'local_postgis') {
    sources.push({
      web: {
        title: 'MSB oversvamningskartering',
        uri: 'https://inspire.msb.se/geoserver/oversvamning/wms?service=WMS&request=GetCapabilities',
      },
    });
  }
  const seen = new Set<string>();
  return sources.filter((source) => {
    const uri = source.web?.uri;
    if (!uri || seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });
}

function buildSummaryCards(bundle: AuditBundle | null): SummaryCardModel[] {
  if (!bundle) return [];
  const cards: SummaryCardModel[] = [];
  if (bundle.spatial) {
    cards.push({
      title: 'Skyddad natur',
      tone: !bundle.spatial.protectedAreaAvailable ? 'manual' : bundle.spatial.isProtected ? 'critical' : 'ok',
      status: !bundle.spatial.protectedAreaAvailable ? 'Manuell kontroll' : bundle.spatial.isProtected ? 'Traff' : 'Ingen traff',
      description: !bundle.spatial.protectedAreaAvailable
        ? bundle.spatial.protectedAreaWarning || 'Skyddad natur kunde inte verifieras lokalt.'
        : bundle.spatial.isProtected
          ? `Platsen overlappar ${bundle.spatial.hits.length} skyddat omrade.`
          : 'Ingen overlapptreff mot lokal NVR/Natura 2000.',
    });

    const nearestSgu = bundle.spatial.sgu?.landslideFeatures?.hits?.[0];
    cards.push({
      title: 'SGU georisk',
      tone: bundle.spatial.sgu?.coverageMode === 'sample' && !nearestSgu ? 'manual' : cardToneFromRisk(bundle.spatial.sgu?.riskLevel || 'LOW'),
      status: `${riskLabel(bundle.spatial.sgu?.riskLevel || null)} risk`,
      description: nearestSgu
        ? `${nearestSgu.featureLabel || 'Geotekniskt objekt'} inom ${formatDistance(nearestSgu.distanceMeters)}. ${bundle.spatial.sgu?.groundLayer?.hit?.layerLabel || 'Grundlager okant'}.`
        : bundle.spatial.sgu?.summary || 'Ingen SGU-sammanfattning tillganglig.',
    });
  }

  if (bundle.water) {
    const nearestWater = bundle.water.hits?.[0];
    cards.push({
      title: 'Vatten',
      tone: bundle.water.hasWaterRisk ? 'warn' : bundle.water.sourceAvailable ? 'ok' : 'manual',
      status: bundle.water.hasWaterRisk ? 'Nara vatten' : bundle.water.sourceAvailable ? 'Ingen nara traff' : 'Manuell kontroll',
      description: bundle.water.hasWaterRisk && nearestWater
        ? `${nearestWater.name || 'Vattenforekomst'} inom ${formatDistance(nearestWater.distance)}. Ekologisk status: ${nearestWater.status_ecological || 'okand'}.`
        : bundle.water.warning || 'Ingen vattenrisk inom granskningsradie.',
    });
  }

  if (bundle.heritage) {
    const nearestHeritage = bundle.heritage.hits?.[0];
    cards.push({
      title: 'Kulturmiljo',
      tone: bundle.heritage.hasHeritageRisk ? 'warn' : bundle.heritage.sourceAvailable ? 'ok' : 'manual',
      status: bundle.heritage.hasHeritageRisk ? 'Traff inom skyddsavstand' : bundle.heritage.sourceAvailable ? 'Ingen nara traff' : 'Manuell kontroll',
      description: bundle.heritage.hasHeritageRisk && nearestHeritage
        ? `${nearestHeritage.object_type} ${formatDistance(nearestHeritage.distance)} fran platsen.`
        : bundle.heritage.warning || 'Ingen fornlarnings- eller kulturmiljotraff i aktuell radie.',
    });
  }

  if (bundle.climate) {
    cards.push({
      title: 'Klimat och flode',
      tone: bundle.climate.isFlooded ? 'critical' : bundle.climate.sourceAvailable ? 'ok' : 'manual',
      status: bundle.climate.isFlooded ? 'Oversvamningssignal' : bundle.climate.sourceAvailable ? 'Ingen traff' : 'Manuell kontroll',
      description: bundle.climate.isFlooded
        ? `MSB signalerar oversvamningsrisk i provpunkten. Traffar: ${bundle.climate.hitCount}.`
        : bundle.climate.warning || 'Ingen MSB-traff registrerad for provpunkten.',
    });
  }

  return cards;
}

const ApplicationWizard: React.FC = () => {
  const [step, setStep] = useState<StepId>(1);
  const [latInput, setLatInput] = useState(DEFAULT_COORDS.lat);
  const [lngInput, setLngInput] = useState(DEFAULT_COORDS.lng);
  const [loading, setLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string[]>([]);
  const [auditBundle, setAuditBundle] = useState<AuditBundle | null>(null);
  const [bankId, setBankId] = useState<BankIdState>({ status: 'idle', orderRef: null, autoStartToken: null, qrPayload: null, hintCode: null, pollCount: 0, error: null, user: null });

  const parsedLat = useMemo(() => parseCoordinate(latInput), [latInput]);
  const parsedLng = useMemo(() => parseCoordinate(lngInput), [lngInput]);
  const coordinatesValid = useMemo(() => coordinatesAreValid(parsedLat, parsedLng), [parsedLat, parsedLng]);
  const overallRisk = useMemo(() => computeOverallRisk(auditBundle), [auditBundle]);
  const summaryCards = useMemo(() => buildSummaryCards(auditBundle), [auditBundle]);
  const sources = useMemo(() => buildSourceList(auditBundle), [auditBundle]);

  const manualReviewRequired = useMemo(() => {
    if (!auditBundle) return true;
    return (
      bankId.status !== 'complete' ||
      Boolean(auditBundle.issues.length) ||
      Boolean(auditBundle.spatial?.manualReviewRequired) ||
      Boolean(auditBundle.water?.manualReviewRequired) ||
      Boolean(auditBundle.heritage?.manualReviewRequired) ||
      Boolean(auditBundle.climate?.manualReviewRequired)
    );
  }, [auditBundle, bankId.status]);

  useEffect(() => {
    if (bankId.status !== 'pending' || !bankId.orderRef) return;
    if (bankId.pollCount >= MAX_BANKID_POLLS) {
      setBankId((current) => ({ ...current, status: 'failed', error: 'BankID svarade inte inom rimlig tid. Fortsatt manuell kontroll kravs.' }));
      return;
    }

    const timerId = window.setTimeout(async () => {
      try {
        const payload = await postJson<BankIdCollectResponse>('/api/auth/bankid/collect', { orderRef: bankId.orderRef });
        if (payload.status === 'complete' && payload.accessToken) {
          window.localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken);
          if (payload.refreshToken) window.localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
          setBankId({ status: 'complete', orderRef: bankId.orderRef, autoStartToken: bankId.autoStartToken, qrPayload: bankId.qrPayload, hintCode: null, pollCount: bankId.pollCount, error: null, user: payload.user || null });
          setStep(2);
          return;
        }
        if (payload.status === 'failed') {
          setBankId((current) => ({ ...current, status: 'failed', hintCode: payload.hintCode || current.hintCode, error: payload.hintCode ? `BankID stoppad: ${payload.hintCode}` : 'BankID misslyckades.' }));
          return;
        }
        setBankId((current) => ({ ...current, status: 'pending', hintCode: payload.hintCode || current.hintCode, pollCount: current.pollCount + 1 }));
      } catch (error) {
        setBankId((current) => ({ ...current, status: 'failed', error: error instanceof Error ? error.message : 'BankID collect misslyckades.' }));
      }
    }, 2000);

    return () => window.clearTimeout(timerId);
  }, [bankId.autoStartToken, bankId.orderRef, bankId.pollCount, bankId.qrPayload, bankId.status]);

  async function startBankId(): Promise<void> {
    setBankId({ status: 'starting', orderRef: null, autoStartToken: null, qrPayload: null, hintCode: null, pollCount: 0, error: null, user: null });
    try {
      const payload = await postJson<BankIdInitResponse>('/api/auth/bankid/init', {});
      if (!payload.ok || !payload.orderRef) throw new Error(payload.error || 'BankID kunde inte startas.');
      setBankId({ status: 'pending', orderRef: payload.orderRef, autoStartToken: payload.autoStartToken || null, qrPayload: payload.qrPayload || null, hintCode: null, pollCount: 0, error: null, user: null });
    } catch (error) {
      setBankId({ status: 'failed', orderRef: null, autoStartToken: null, qrPayload: null, hintCode: null, pollCount: 0, error: error instanceof Error ? error.message : 'BankID kunde inte startas.', user: null });
    }
  }

  async function continueWithManualReview(): Promise<void> {
    if (bankId.orderRef) void postJson('/api/auth/bankid/cancel', { orderRef: bankId.orderRef }).catch(() => null);
    setBankId((current) => ({ ...current, status: 'manual_review' }));
    setStep(2);
  }

  async function runAuditRequest<T>(label: string, url: string, lat: number, lng: number): Promise<AuditRequestResult<T>> {
    setAnalysisStatus((current) => [...current, `${label}: startad`]);
    try {
      const data = await postJson<T>(url, { lat, lng });
      setAnalysisStatus((current) => [...current, `${label}: klar`]);
      return { data, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okant fel';
      setAnalysisStatus((current) => [...current, `${label}: ${message}`]);
      return { data: null, error: message };
    }
  }

  async function runFullAudit(): Promise<void> {
    if (!coordinatesValid || parsedLng === null) {
      setAnalysisStatus(['Koordinater saknas eller ar ogiltiga.']);
      return;
    }

    setLoading(true);
    setAuditBundle(null);
    setAnalysisStatus(['Forbereder auditkorning...']);

    const spatial = await runAuditRequest<any>('Skyddad natur och SGU', '/api/spatial-audit', parsedLat, parsedLng);
    const climate = await runAuditRequest<any>('Klimat och flode', '/api/climate/smhi-audit', parsedLat, parsedLng);
    const heritage = await runAuditRequest<any>('Kulturmiljo', '/api/culture/heritage-audit', parsedLat, parsedLng);
    const water = await runAuditRequest<any>('Hydrologi och vatten', '/api/hydro/water-audit', parsedLat, parsedLng);

    const issues = [spatial.error, climate.error, heritage.error, water.error].filter((value): value is string => Boolean(value));
    setAuditBundle({ lat: parsedLat, lng: parsedLng, spatial: spatial.data, climate: climate.data, heritage: heritage.data, water: water.data, issues });
    setStep(3);
    setLoading(false);
  }

  const bankIdUrl = bankIdDeepLink(bankId.autoStartToken);

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-500">
      <div className="relative flex items-center justify-between px-6 md:px-10">
        <div className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-slate-200" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }} />
        {STEPS.map((currentStep) => (
          <div key={currentStep.id} className="relative z-10 flex flex-col items-center gap-3">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border-4 transition-all ${step >= currentStep.id ? 'border-emerald-100 bg-emerald-600 text-white shadow-xl' : 'border-slate-100 bg-white text-slate-300'}`}>
              <i className={`fas ${currentStep.icon} text-lg`} />
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${step >= currentStep.id ? 'text-emerald-700' : 'text-slate-400'}`}>{currentStep.title}</span>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl">
        {loading ? (
          <div className="flex min-h-[560px] flex-col items-center justify-center gap-8 bg-slate-50/50 p-10">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            <div className="w-full max-w-xl space-y-3 rounded-3xl border border-slate-200 bg-white p-6">
              {analysisStatus.map((line, index) => (
                <div key={`${line}-${index}`} className="flex items-center gap-3 text-sm text-slate-700">
                  <i className="fas fa-circle-check text-emerald-500" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {step === 1 && (
              <section className="flex min-h-[560px] flex-col justify-center gap-8 p-10 md:p-16">
                <div className="text-center">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600"><i className="fas fa-fingerprint text-4xl" /></div>
                  <h3 className="text-3xl font-black tracking-tight text-slate-900">Identitet och ansvar</h3>
                  <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600">BankID korning ar verklig om certifikat och behorig anvandare finns. Om det inte gar fortsatter flodet med manuell kontroll. Ingen automatisk slutsats eller inskickning sker utan manniska i loopen.</p>
                </div>

                <div className="grid gap-6 md:grid-cols-[1.4fr,1fr]">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                    <h4 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">BankID-status</h4>
                    <div className="mt-4 space-y-3">
                      <StatusRow label="Status" value={bankId.status === 'manual_review' ? 'Manuell kontroll' : bankId.status} />
                      <StatusRow label="OrderRef" value={bankId.orderRef || 'Ej startad'} />
                      <StatusRow label="HintCode" value={bankId.hintCode || 'Ingen'} />
                      <StatusRow label="Anvandare" value={bankId.user ? `${bankId.user.role} / ${bankId.user.organisationId}` : 'Ej autentiserad'} />
                    </div>
                    {bankId.error && <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{bankId.error}</p>}
                    {bankId.qrPayload && <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">QR payload</p><p className="mt-2 break-all font-mono text-[11px] text-slate-700">{bankId.qrPayload}</p></div>}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-6">
                    <h4 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">Val</h4>
                    <div className="mt-4 space-y-3">
                      <button type="button" onClick={() => void startBankId()} disabled={bankId.status === 'starting' || bankId.status === 'pending'} className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-xs font-black uppercase tracking-[0.14em] text-white disabled:opacity-50">{bankId.status === 'starting' ? 'Startar...' : bankId.status === 'pending' ? 'Vantar pa svar...' : 'Starta BankID'}</button>
                      {bankIdUrl && <a href={bankIdUrl} className="flex w-full items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Oppna BankID-appen</a>}
                      <button type="button" onClick={() => void continueWithManualReview()} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700">Fortsatt manuell kontroll</button>
                    </div>
                    <p className="mt-4 text-xs text-slate-500">BankID ar en identitetskontroll, inte ett godkannande av plats eller regeluppfyllelse.</p>
                  </div>
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="min-h-[560px] space-y-8 p-10 md:p-16">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-3xl font-black tracking-tight text-slate-900">Plats och auditkorning</h3>
                    <p className="mt-2 text-sm text-slate-600">Ange koordinater och kor verkliga publika audits. Resultatet ar beslutsstod och maste alltid granskas manuellt.</p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">Identitet: {bankId.status === 'complete' ? 'BankID klar' : 'Manuell kontroll'}</div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <label className="space-y-2"><span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Latitud</span><input value={latInput} onChange={(event) => setLatInput(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500" placeholder="59.3293" /></label>
                  <label className="space-y-2"><span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Longitud</span><input value={lngInput} onChange={(event) => setLngInput(event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500" placeholder="18.0686" /></label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => { setLatInput(DEFAULT_COORDS.lat); setLngInput(DEFAULT_COORDS.lng); }} className="rounded-full border border-slate-300 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">SGU-demo</button>
                  <button type="button" onClick={() => { setLatInput(STOCKHOLM_COORDS.lat); setLngInput(STOCKHOLM_COORDS.lng); }} className="rounded-full border border-slate-300 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">Stockholm-demo</button>
                  {!coordinatesValid && <span className="rounded-full bg-amber-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">Ogiltiga koordinater</span>}
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <AuditScope title="Skyddad natur" icon="fa-shield-halved" description="NVR och Natura 2000 mot lokal PostGIS eller livefallback." />
                  <AuditScope title="SGU georisk" icon="fa-mountain" description="Grundlager och jordskred-raviner vags in som indikativ risk." />
                  <AuditScope title="Vatten" icon="fa-water" description="Hydrologiskt auditpaket mot lokala lager. Saknas lokal tabell kravs manuell kontroll eller riktig VISS-behorighet." />
                  <AuditScope title="Kulturmiljo och klimat" icon="fa-landmark" description="RAA och MSB korning utan att skapa automatisk beslutseffekt." />
                </div>

                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                  <div className="flex items-start gap-3">
                    <i className="fas fa-triangle-exclamation mt-0.5 text-amber-600" />
                    <div>
                      <p className="font-black uppercase tracking-[0.14em]">Human in the loop</p>
                      <p className="mt-2">Korningen genererar beslutsstod. Slutlig bedomning, avgransning och eventuell inskickning gor manniska efter manuell granskning.</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <button type="button" onClick={() => setStep(1)} className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700">Tillbaka</button>
                  <button type="button" onClick={() => void runFullAudit()} disabled={!coordinatesValid} className="rounded-2xl bg-emerald-600 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-50">Kor full audit</button>
                </div>
              </section>
            )}

            {step === 3 && auditBundle && (
              <section className="min-h-[560px] space-y-8 p-10 md:p-16">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-3xl font-black tracking-tight text-slate-900">Samlad riskbild</h3>
                    <p className="mt-2 text-sm text-slate-600">Sammanstallningen bygger pa verkliga auditsvar. Negativa resultat utan full tackning maste tolkas forsiktigt och granskas manuellt.</p>
                  </div>
                  <div className={`rounded-3xl px-5 py-4 text-center ${overallRisk === 'HIGH' ? 'bg-rose-50 text-rose-700' : overallRisk === 'MEDIUM' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em]">Samlad risk</p>
                    <p className="mt-1 text-2xl font-black">{riskLabel(overallRisk)}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {summaryCards.map((card) => (
                    <SummaryCard key={card.title} card={card} />
                  ))}
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Narrativ sammanfattning</p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">{auditBundle.spatial?.text || 'Ingen spatial narrativ sammanfattning tillganglig.'}</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <StatusRow label="Koordinater" value={`${auditBundle.lat.toFixed(6)}, ${auditBundle.lng.toFixed(6)}`} />
                    <StatusRow label="Manuell grind" value={manualReviewRequired ? 'Kravs' : 'Kan fortfarande rekommenderas'} />
                  </div>
                </div>

                {auditBundle.issues.length > 0 && (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">Delvisa fel eller fallback</p>
                    <ul className="mt-3 space-y-2 text-sm text-amber-800">
                      {auditBundle.issues.map((issue) => (
                        <li key={issue} className="flex items-start gap-2">
                          <i className="fas fa-circle-exclamation mt-1 text-xs" />
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-3xl border border-slate-200 bg-white p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Kallor</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {sources.length > 0 ? (
                      sources.map((source) => (
                        <a key={source.web?.uri} href={source.web?.uri} target="_blank" rel="noreferrer" className="rounded-full border border-slate-300 px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-700">
                          {source.web?.title || source.web?.uri}
                        </a>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">Inga explicita kallor returnerades i auditpaketet.</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <button type="button" onClick={() => setStep(2)} className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700">Andra koordinater</button>
                  <button type="button" onClick={() => setStep(4)} className="rounded-2xl bg-slate-900 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-white">Ga till manuell grind</button>
                </div>
              </section>
            )}

            {step === 4 && auditBundle && (
              <section className="min-h-[560px] space-y-8 p-10 md:p-16">
                <div>
                  <h3 className="text-3xl font-black tracking-tight text-slate-900">Manuell grind och ansvar</h3>
                  <p className="mt-2 text-sm text-slate-600">Detta steg ersatter automatisk signering. Beslutsstodet far inte behandlas som slutligt utan manuell verifiering, dokumentbedomning och juridisk kontroll.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Granskningskort</p>
                    <div className="mt-4 space-y-3">
                      <StatusRow label="Identitet" value={bankId.status === 'complete' ? 'BankID verifierad' : 'Manuell identitetskontroll'} />
                      <StatusRow label="Koordinater" value={`${auditBundle.lat.toFixed(6)}, ${auditBundle.lng.toFixed(6)}`} />
                      <StatusRow label="Samlad risk" value={riskLabel(overallRisk)} />
                      <StatusRow label="Skyddad natur" value={auditBundle.spatial?.isProtected ? 'Traff' : auditBundle.spatial?.protectedAreaAvailable ? 'Ingen traff' : 'Ej verifierat'} />
                      <StatusRow label="Manuell granskning" value={manualReviewRequired ? 'Obligatorisk' : 'Fortfarande rekommenderad'} />
                    </div>
                  </div>

                  <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-rose-700">Bindande regel</p>
                    <p className="mt-3">Ingen automatisk ansokan, inget slutligt ja/nej och ingen juridisk slutsats far produceras utan manniska i loopen. Resultat med fallback, stickprov eller oklara kallor ska eskaleras till manuell granskning.</p>
                    <ul className="mt-4 space-y-2">
                      <li>Verifiera platsen mot primarkallor om risknivan ar medel eller hog.</li>
                      <li>Bekrafta att skyddad natur och georisk ar rimligt tolkade i aktuell skala.</li>
                      <li>Dokumentera granskaren innan materialet anvands vidare.</li>
                    </ul>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Slutsteg</p>
                  <p className="mt-3 text-sm text-slate-700">Det har steget stoppar medvetet fore inskickning. Granskaren maste nu ta over, lasa underlagen och fatta beslut om fortsatt handlaggning.</p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <button type="button" onClick={() => setStep(3)} className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700">Tillbaka till auditsvar</button>
                  <button type="button" onClick={() => { setAuditBundle(null); setAnalysisStatus([]); setStep(2); }} className="rounded-2xl bg-emerald-600 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-white">Ny korning</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

type AuditRequestResult<T> = {
  data: T | null;
  error: string | null;
};

type BankIdInitResponse = {
  ok: boolean;
  orderRef?: string;
  autoStartToken?: string | null;
  qrPayload?: string | null;
  error?: string;
};

type BankIdCollectResponse = {
  ok: boolean;
  status: 'pending' | 'complete' | 'failed';
  hintCode?: string | null;
  accessToken?: string;
  refreshToken?: string | null;
  user?: { id: string; organisationId: string; role: string } | null;
  error?: string;
};

const toneClassMap: Record<SummaryCardModel['tone'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
  manual: 'border-slate-200 bg-slate-50 text-slate-800',
};

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <span className="font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function AuditScope({ title, icon, description }: { title: string; icon: string; description: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          <i className={`fas ${icon}`} />
        </div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">{title}</p>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function SummaryCard({ card }: { card: SummaryCardModel }) {
  return (
    <article className={`rounded-3xl border p-6 ${toneClassMap[card.tone]}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.14em]">{card.title}</p>
      <p className="mt-3 text-xl font-black">{card.status}</p>
      <p className="mt-3 text-sm leading-7">{card.description}</p>
    </article>
  );
}

export default ApplicationWizard;
