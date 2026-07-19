import React, { Suspense, lazy, useEffect, useMemo, useState, useRef } from 'react';
import { ShieldAlert, CheckCircle, FileText, ArrowRight, ArrowLeft, Search, Check } from 'lucide-react';

// Lazy-loaded step views for performance and decoupling
const LocationAuditStep = lazy(() =>
  import('./applicationWizard/ApplicationWizardDeferredViews').then((module) => ({
    default: module.LocationAuditStep,
  }))
);
const RiskSummaryStep = lazy(() =>
  import('./applicationWizard/ApplicationWizardDeferredViews').then((module) => ({
    default: module.RiskSummaryStep,
  }))
);

const ACCESS_TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_TOKEN_KEY = 'miljobeslut_admin_refresh';
const DEFAULT_COORDS = { lat: '59.186', lng: '18.131' }; // Defaulting to Haninge (Länna 1:45)
const MAX_BANKID_POLLS = 60;

export type ModuleType = 'ENSKILT_AVLOPP' | 'C_ANMALAN' | 'LU';
export type StepId = 1 | 2 | 3;
export type BankIdStatus = 'idle' | 'starting' | 'pending' | 'complete' | 'manual_review' | 'failed';

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

type WizardState = {
  moduleType: ModuleType;
  propertyId: string;
  municipality: string;
  lat: string;
  lng: string;

  // Enskilt Avlopp specific
  peCount: number;
  systemType: string;
  recipient: string;
  soilType: string;

  // C-anmälan specific
  activityCode: string;
  ewcCode: string;
  volumeTons: number;
  projectDescription: string;

  // LU (Lokaliseringsutredning) specific
  activityCodeLU: string;
  luProjectDescription: string;
  luAlternatives: string;
  luWaterImpact: string;
  luSensitiveReceptors: string;
};

const STEPS: Array<{ id: StepId; title: string; icon: string }> = [
  { id: 1, title: 'Grunduppgifter', icon: 'fa-file-lines' },
  { id: 2, title: 'Karta & Analys', icon: 'fa-map-location-dot' },
  { id: 3, title: 'Sammanställning', icon: 'fa-file-export' },
];

const StepFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex min-h-[560px] items-center justify-center bg-slate-50/50 p-10">
    <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
    </div>
  </div>
);

// Mock property data for local verification
const MOCK_PROPERTIES = [
  { name: 'Länna 1:45', municipality: 'Haninge', lat: '59.186', lng: '18.131' },
  { name: 'Segeltorp 4:12', municipality: 'Huddinge', lat: '59.270', lng: '17.935' },
  { name: 'Orminge 7:8', municipality: 'Nacka', lat: '59.327', lng: '18.258' },
  { name: 'Orsa Stackmora 3:12', municipality: 'Orsa', lat: '61.134', lng: '14.665' },
];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload as T;
}

const ApplicationWizard: React.FC = () => {
  const [step, setStep] = useState<StepId>(1);
  const [loading, setLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string[]>([]);
  const [auditBundle, setAuditBundle] = useState<AuditBundle | null>(null);

  const auditIdRef = useRef(0);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);
  
  // BankID Authentication State
  const [bankId, setBankId] = useState<BankIdState>({
    status: 'idle',
    orderRef: null,
    autoStartToken: null,
    qrPayload: null,
    hintCode: null,
    pollCount: 0,
    error: null,
    user: null,
  });

  // Wizard state with default form values
  const [wizardState, setWizardState] = useState<WizardState>({
    moduleType: 'C_ANMALAN',
    propertyId: '',
    municipality: '',
    lat: DEFAULT_COORDS.lat,
    lng: DEFAULT_COORDS.lng,

    peCount: 5,
    systemType: 'Infiltration',
    recipient: 'Mark/Grundvatten',
    soilType: 'Sand/Grus',

    activityCode: '90.30',
    ewcCode: '17 05 04',
    volumeTons: 1500,
    projectDescription: 'Mellanlagringsplatta för rena schaktmassor.',

    activityCodeLU: 'Krossning/Sortering',
    luProjectDescription: 'Etablering av kross- och sorteringsanläggning med tillhörande fordonsrörelser.',
    luAlternatives: 'Alternativplats A (Orminge 7:8) samt nollalternativet har utretts.',
    luWaterImpact: 'Låg påverkan; dagvatten leds via sedimenteringsdamm till intilliggande dike.',
    luSensitiveReceptors: 'Närmaste bostadsfastighet ligger 280 m nordost om utredningsområdet.',
  });

  const [propertyQuery, setPropertyQuery] = useState('');
  const [propertySearchResult, setPropertySearchResult] = useState<string | null>(null);

  // Search property and auto-fill coordinates + municipality
  const handlePropertySearch = () => {
    const query = propertyQuery.trim().toLowerCase();
    const hit = MOCK_PROPERTIES.find((p) => p.name.toLowerCase().includes(query));
    if (hit) {
      setWizardState((prev) => ({
        ...prev,
        propertyId: hit.name,
        municipality: hit.municipality,
        lat: hit.lat,
        lng: hit.lng,
      }));
      setPropertySearchResult(`Träff: ${hit.name} i ${hit.municipality} kommun. Koordinater laddade.`);
      void runFullGeofenceAudit(Number(hit.lat), Number(hit.lng));
    } else {
      setPropertySearchResult('Ingen verifierad fastighetstext matchade. Standardkoordinater används.');
    }
  };

  // Poll BankID
  useEffect(() => {
    if (bankId.status !== 'pending' || !bankId.orderRef) return;
    if (bankId.pollCount >= MAX_BANKID_POLLS) {
      setBankId((current) => ({
        ...current,
        status: 'failed',
        error: 'BankID svarade inte inom rimlig tid. Fortsätt med manuell identitetskontroll.',
      }));
      return;
    }

    const timerId = window.setTimeout(async () => {
      try {
        const payload = await postJson<any>('/api/auth/bankid/collect', { orderRef: bankId.orderRef });
        if (payload.status === 'complete' && payload.accessToken) {
          window.localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken);
          if (payload.refreshToken) window.localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
          setBankId({
            status: 'complete',
            orderRef: bankId.orderRef,
            autoStartToken: bankId.autoStartToken,
            qrPayload: bankId.qrPayload,
            hintCode: null,
            pollCount: bankId.pollCount,
            error: null,
            user: payload.user || null,
          });
          return;
        }
        if (payload.status === 'failed') {
          setBankId((current) => ({
            ...current,
            status: 'failed',
            hintCode: payload.hintCode || current.hintCode,
            error: payload.hintCode ? `BankID stoppad: ${payload.hintCode}` : 'BankID misslyckades.',
          }));
          return;
        }
        setBankId((current) => ({
          ...current,
          status: 'pending',
          hintCode: payload.hintCode || current.hintCode,
          pollCount: current.pollCount + 1,
        }));
      } catch (error) {
        setBankId((current) => ({
          ...current,
          status: 'failed',
          error: error instanceof Error ? error.message : 'BankID collect misslyckades.',
        }));
      }
    }, 2000);

    return () => window.clearTimeout(timerId);
  }, [bankId.autoStartToken, bankId.orderRef, bankId.pollCount, bankId.qrPayload, bankId.status]);

  async function startBankId(): Promise<void> {
    setBankId({
      status: 'starting',
      orderRef: null,
      autoStartToken: null,
      qrPayload: null,
      hintCode: null,
      pollCount: 0,
      error: null,
      user: null,
    });
    try {
      const payload = await postJson<any>('/api/auth/bankid/init', {});
      if (!payload.ok || !payload.orderRef) throw new Error(payload.error || 'BankID kunde inte startas.');
      setBankId({
        status: 'pending',
        orderRef: payload.orderRef,
        autoStartToken: payload.autoStartToken || null,
        qrPayload: payload.qrPayload || null,
        hintCode: null,
        pollCount: 0,
        error: null,
        user: null,
      });
    } catch (error) {
      setBankId({
        status: 'failed',
        orderRef: null,
        autoStartToken: null,
        qrPayload: null,
        hintCode: null,
        pollCount: 0,
        error: error instanceof Error ? error.message : 'BankID kunde inte startas.',
        user: null,
      });
    }
  }

  async function continueWithManualReview(): Promise<void> {
    if (bankId.orderRef) void postJson('/api/auth/bankid/cancel', { orderRef: bankId.orderRef }).catch(() => null);
    setBankId((current) => ({ ...current, status: 'manual_review' }));
  }

  async function runAuditRequest<T>(label: string, url: string, lat: number, lng: number): Promise<{ data: T | null; error: string | null }> {
    setAnalysisStatus((current) => [...current, `${label}: startad`]);
    try {
      const data = await postJson<T>(url, { lat, lng });
      setAnalysisStatus((current) => [...current, `${label}: klar`]);
      return { data, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Okänt fel';
      setAnalysisStatus((current) => [...current, `${label}: ${message}`]);
      return { data: null, error: message };
    }
  }

  async function runFullGeofenceAudit(customLat?: number, customLng?: number): Promise<void> {
    const latNum = customLat ?? Number(wizardState.lat);
    const lngNum = customLng ?? Number(wizardState.lng);

    const auditId = auditIdRef.current + 1;
    auditIdRef.current = auditId;

    setLoading(true);
    setAuditBundle(null);
    setAnalysisStatus(['Förbereder spatial geofence-granskning...']);

    const isStale = () => auditId !== auditIdRef.current;

    const spatial = await runAuditRequest<any>('Skyddad natur och SGU', '/api/spatial-audit', latNum, lngNum);
    if (isStale()) return;

    const climate = await runAuditRequest<any>('Klimat och översvämning', '/api/climate/smhi-audit', latNum, lngNum);
    if (isStale()) return;

    const heritage = await runAuditRequest<any>('Kulturmiljö (RAÄ)', '/api/culture/heritage-audit', latNum, lngNum);
    if (isStale()) return;

    const water = await runAuditRequest<any>('Hydrologi och vatten (VISS)', '/api/hydro/water-audit', latNum, lngNum);
    if (isStale()) return;

    const issues = [spatial.error, climate.error, heritage.error, water.error].filter((value): value is string => Boolean(value));
    
    setAuditBundle({
      lat: latNum,
      lng: lngNum,
      spatial: spatial.data,
      climate: climate.data,
      heritage: heritage.data,
      water: water.data,
      issues,
    });
    setLoading(false);
  }

  const handleLocationChange = (newLat: string, newLng: string) => {
    // Instantly update the coordinates so map renders smoothly
    setWizardState((prev) => ({ ...prev, lat: newLat, lng: newLng }));

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
  };

  const isFormValid = wizardState.propertyId !== '';

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-500">
      {/* Wizard Header Progress Bar */}
      <div className="relative flex items-center justify-between px-6 md:px-10">
        <div className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-slate-200" />
        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-emerald-600 transition-all duration-500"
          style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
        />
        {STEPS.map((currentStep) => (
          <div key={currentStep.id} className="relative z-10 flex flex-col items-center gap-3">
            <button
              onClick={() => step > currentStep.id && setStep(currentStep.id)}
              disabled={step < currentStep.id}
              className={`flex h-14 w-14 items-center justify-center rounded-2xl border-4 transition-all ${
                step >= currentStep.id
                  ? 'border-emerald-100 bg-emerald-600 text-white shadow-xl hover:bg-emerald-700'
                  : 'border-slate-100 bg-white text-slate-300 cursor-not-allowed'
              }`}
            >
              <i className={`fas ${currentStep.icon} text-lg`} />
            </button>
            <span
              className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                step >= currentStep.id ? 'text-emerald-700' : 'text-slate-400'
              }`}
            >
              {currentStep.title}
            </span>
          </div>
        ))}
      </div>

      {/* Main Wizard Content Area */}
      <div className="overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl">
        {step === 1 && (
          <section className="flex flex-col gap-8 p-10 md:p-16">
            <div className="text-center">
              <h3 className="text-3xl font-black tracking-tight text-slate-900">Skapa Ansökningsunderlag</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">
                Detta enhetliga flöde förbereder din anmälan. Börja med identitetskontroll, välj fastighet och fyll i ärendespecifika val.
              </p>
            </div>

            {/* Sub-section: BankID Identity Check */}
            <div className="rounded-3xl border border-slate-100 bg-slate-50/50 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">Identitetskontroll (BankID)</h4>
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.1em] ${
                  bankId.status === 'complete' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {bankId.status === 'complete' ? 'Autentiserad' : bankId.status === 'manual_review' ? 'Manuell granskning' : 'Ej verifierad'}
                </span>
              </div>

              {bankId.status !== 'complete' && bankId.status !== 'manual_review' ? (
                <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
                  <div className="text-xs text-slate-500 leading-5">
                    För att registrera ansökan digitalt krävs e-legitimation eller att handläggaren väljer manuell kontroll. 
                    Inga beslut eller inskick sker automatiskt.
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void startBankId()}
                      disabled={bankId.status === 'starting' || bankId.status === 'pending'}
                      className="rounded-xl bg-slate-900 py-3 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-black disabled:opacity-50"
                    >
                      {bankId.status === 'starting' ? 'Startar...' : bankId.status === 'pending' ? 'Väntar...' : 'Starta BankID'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void continueWithManualReview()}
                      className="rounded-xl border border-slate-300 bg-white py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-700 transition hover:bg-slate-50"
                    >
                      Fortsätt manuell kontroll
                    </button>
                    {bankId.error && (
                      <p className="mt-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-xl">
                        {bankId.error}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
                  <CheckCircle size={18} />
                  <span>Identitetskontroll klar. Du kan nu gå vidare och fylla i ansökningsuppgifterna.</span>
                </div>
              )}
            </div>

            {/* Sub-section: Property Search & Module Selection (Unlocked by ID verification) */}
            {(bankId.status === 'complete' || bankId.status === 'manual_review') && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <hr className="border-slate-100" />
                
                {/* Property Search */}
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Sök Fastighet</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        type="text"
                        placeholder="T.ex. Länna 1:45, Segeltorp 4:12..."
                        value={propertyQuery}
                        onChange={(e) => setPropertyQuery(e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 py-3.5 pl-11 pr-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handlePropertySearch}
                      className="rounded-2xl bg-emerald-600 px-6 font-black text-xs uppercase tracking-[0.12em] text-white hover:bg-emerald-700 transition"
                    >
                      Sök
                    </button>
                  </div>
                  {propertySearchResult && (
                    <p className="text-xs font-semibold text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      {propertySearchResult}
                    </p>
                  )}
                </div>

                {/* Module Selector tabs */}
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Välj Ärendetyp</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { type: 'ENSKILT_AVLOPP', label: 'Enskilt Avlopp', desc: 'Inrättande av enskild avloppsanläggning för hushåll.' },
                      { type: 'C_ANMALAN', label: 'C-anmälan (Mellanlagring)', desc: 'Mellanlagring av schaktmassor, ballast eller avfall.' },
                      { type: 'LU', label: 'LU (Lokaliseringsutredning)', desc: 'Utredning av alternativa platser och projektetablering.' },
                    ].map((mod) => (
                      <button
                        key={mod.type}
                        type="button"
                        onClick={() => setWizardState((prev) => ({ ...prev, moduleType: mod.type as ModuleType }))}
                        className={`rounded-2xl border p-5 text-left transition-all ${
                          wizardState.moduleType === mod.type
                            ? 'border-emerald-600 bg-emerald-50/50 shadow-md ring-2 ring-emerald-500/20'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <p className="text-sm font-black text-slate-900">{mod.label}</p>
                        <p className="mt-2 text-xs text-slate-500 leading-5">{mod.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Module Specific Form Fields */}
                <div className="rounded-3xl border border-slate-200 p-6 md:p-8 space-y-6">
                  <h4 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">Ärendespecifika uppgifter</h4>
                  
                  {wizardState.moduleType === 'ENSKILT_AVLOPP' && (
                    <div className="grid gap-6 md:grid-cols-2 animate-in fade-in duration-300">
                      <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Antal anslutna (PE)</span>
                        <input
                          type="number"
                          value={wizardState.peCount}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, peCount: Number(e.target.value) }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Anläggningstyp</span>
                        <select
                          value={wizardState.systemType}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, systemType: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                        >
                          <option>Infiltration</option>
                          <option>Markbädd</option>
                          <option>Minireningsverk</option>
                          <option>Sluten tank</option>
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Mottagare (Recipient)</span>
                        <select
                          value={wizardState.recipient}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, recipient: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                        >
                          <option>Mark/Grundvatten</option>
                          <option>Sjö/Vattendrag</option>
                          <option>Dike/Dagvatten</option>
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Jordart (SGU screening)</span>
                        <select
                          value={wizardState.soilType}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, soilType: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                        >
                          <option>Sand/Grus</option>
                          <option>Morän</option>
                          <option>Lera/Silt</option>
                          <option>Berg i dagen</option>
                        </select>
                      </label>
                    </div>
                  )}

                  {wizardState.moduleType === 'C_ANMALAN' && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                      <div className="grid gap-6 md:grid-cols-3">
                        <label className="space-y-2">
                          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Verksamhetskod (MPF)</span>
                          <select
                            value={wizardState.activityCode}
                            onChange={(e) => setWizardState((prev) => ({ ...prev, activityCode: e.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                          >
                            <option value="90.30">90.30 - Mellanlagring icke-farligt</option>
                            <option value="90.130">90.130 - Återvinning</option>
                            <option value="90.131">90.131 - Ringa risk</option>
                            <option value="90.50">90.50 - Farligt avfall</option>
                          </select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">EWC Avfallskod</span>
                          <select
                            value={wizardState.ewcCode}
                            onChange={(e) => setWizardState((prev) => ({ ...prev, ewcCode: e.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                          >
                            <option value="17 05 04">17 05 04 - Jord & Sten (icke farligt)</option>
                            <option value="17 05 03*">17 05 03* - Farligt avfall (schakt/lera)</option>
                          </select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Maxvolym (ton)</span>
                          <input
                            type="number"
                            value={wizardState.volumeTons}
                            onChange={(e) => setWizardState((prev) => ({ ...prev, volumeTons: Number(e.target.value) }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                          />
                        </label>
                      </div>
                      <label className="space-y-2 block">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Projektbeskrivning</span>
                        <textarea
                          rows={4}
                          value={wizardState.projectDescription}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, projectDescription: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                        />
                      </label>
                    </div>
                  )}

                  {wizardState.moduleType === 'LU' && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                      <div className="grid gap-6 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Typ av Verksamhet / Projekt</span>
                          <input
                            type="text"
                            value={wizardState.activityCodeLU}
                            onChange={(e) => setWizardState((prev) => ({ ...prev, activityCodeLU: e.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Känsliga Skyddsobjekt i närheten</span>
                          <input
                            type="text"
                            value={wizardState.luSensitiveReceptors}
                            onChange={(e) => setWizardState((prev) => ({ ...prev, luSensitiveReceptors: e.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
                          />
                        </label>
                      </div>

                      <label className="space-y-2 block">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">LU Projektbeskrivning</span>
                        <textarea
                          rows={3}
                          value={wizardState.luProjectDescription}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, luProjectDescription: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                          placeholder="Beskriv projektets omfattning och syfte..."
                        />
                      </label>
                      <label className="space-y-2 block">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Utredda Alternativ (Lokaliseringsalternativ)</span>
                        <textarea
                          rows={3}
                          value={wizardState.luAlternatives}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, luAlternatives: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                          placeholder="Beskriv vilka andra platser/fastigheter som har utretts och varför denna valdes..."
                        />
                      </label>
                      <label className="space-y-2 block">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 block">Vattenpåverkan & Dagvattenrecipient</span>
                        <textarea
                          rows={3}
                          value={wizardState.luWaterImpact}
                          onChange={(e) => setWizardState((prev) => ({ ...prev, luWaterImpact: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                          placeholder="Beskriv eventuell påverkan på intilliggande sjöar, vattendrag och grundvatten..."
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Continue button */}
                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (isFormValid) {
                        void runFullGeofenceAudit();
                        setStep(2);
                      }
                    }}
                    disabled={!isFormValid}
                    className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-8 py-4 font-black text-xs uppercase tracking-[0.14em] text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Fortsätt till karta & analys <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <Suspense fallback={<StepFallback label="Laddar lokaliseringskarta..." />}>
            <LocationAuditStep
              wizardState={wizardState}
              loading={loading}
              analysisStatus={analysisStatus}
              auditBundle={auditBundle}
              onBack={() => setStep(1)}
              onContinue={() => setStep(3)}
              onReRunAudit={() => void runFullGeofenceAudit()}
              onLocationChange={handleLocationChange}
            />
          </Suspense>
        )}

        {step === 3 && auditBundle && (
          <Suspense fallback={<StepFallback label="Sammanställer ansökan..." />}>
            <RiskSummaryStep
              wizardState={wizardState}
              auditBundle={auditBundle}
              onBack={() => setStep(2)}
              onReset={() => {
                setAuditBundle(null);
                setAnalysisStatus([]);
                setStep(1);
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default ApplicationWizard;
