import React, { useMemo, useState } from 'react';
import { ShieldAlert, CheckCircle, FileText, Download, CheckSquare, Square, AlertTriangle, ArrowLeft, ArrowRight, RotateCw, RefreshCw } from 'lucide-react';
import MapView from '../MapView';
import { callMvp } from '../../services/mvpApiClient';

type WizardState = {
  moduleType: 'ENSKILT_AVLOPP' | 'C_ANMALAN' | 'LU';
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

const toneClassMap: Record<SummaryCardModel['tone'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
  manual: 'border-slate-200 bg-slate-50 text-slate-800',
};

function formatDistance(distance: number | null | undefined): string {
  if (distance == null || !Number.isFinite(distance)) return 'okänt avstånd';
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toFixed(1)} km`;
}

function riskLabel(risk: 'LOW' | 'MEDIUM' | 'HIGH' | null): string {
  if (risk === 'HIGH') return 'Hög';
  if (risk === 'MEDIUM') return 'Medel';
  if (risk === 'LOW') return 'Låg';
  return 'Okänd';
}

function cardToneFromRisk(risk: 'LOW' | 'MEDIUM' | 'HIGH'): SummaryCardModel['tone'] {
  if (risk === 'HIGH') return 'critical';
  if (risk === 'MEDIUM') return 'warn';
  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Location and Spatial Auditing
// ─────────────────────────────────────────────────────────────────────────────

interface LocationAuditStepProps {
  wizardState: WizardState;
  loading: boolean;
  analysisStatus: string[];
  auditBundle: AuditBundle | null;
  onBack: () => void;
  onContinue: () => void;
  onReRunAudit: () => void;
  onLocationChange: (lat: string, lng: string) => void;
}

export const LocationAuditStep: React.FC<LocationAuditStepProps> = ({
  wizardState,
  loading,
  analysisStatus,
  auditBundle,
  onBack,
  onContinue,
  onReRunAudit,
  onLocationChange,
}) => {
  // Determine buffer zone distance based on module type
  const bufferDist = useMemo(() => {
    if (wizardState.moduleType === 'ENSKILT_AVLOPP') return 50; // 50m to wells
    if (wizardState.moduleType === 'C_ANMALAN') return 100; // 100m to protected/water
    return 200; // 200m for B-activity
  }, [wizardState.moduleType]);

  // Construct GeoJSON point to display property location
  const propertyGeoJson = useMemo(() => {
    const latNum = Number(wizardState.lat);
    const lngNum = Number(wizardState.lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lngNum, latNum],
          },
          properties: {
            name: wizardState.propertyId || 'Vald position',
          },
        },
      ],
    };
  }, [wizardState.lat, wizardState.lng, wizardState.propertyId]);

  const isOutOfSync = useMemo(() => {
    if (!auditBundle) return false;
    return (
      Math.abs(auditBundle.lat - Number(wizardState.lat)) > 0.0001 ||
      Math.abs(auditBundle.lng - Number(wizardState.lng)) > 0.0001
    );
  }, [auditBundle, wizardState.lat, wizardState.lng]);

  return (
    <section className="min-h-[600px] p-6 md:p-10 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600 block">Steg 2</span>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight">Karta & Spatial Analys</h3>
          <p className="mt-1 text-sm text-slate-500">
            Verifiera lokalisering på kartan och kör geofence-granskning mot nationella skyddslager.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-100 px-4 py-2 rounded-full self-start md:self-auto">
          <span>Skyddsavstånd:</span>
          <span className="font-black text-slate-800">{bufferDist} m</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* Left column: Leaflet Map View */}
        <div className="h-[400px] lg:h-[550px] relative rounded-3xl overflow-hidden border border-slate-200 shadow-md">
          {propertyGeoJson ? (
            <MapView
              permits={[]}
              geoJsonData={propertyGeoJson}
              bufferDistance={bufferDist}
              onLocationChange={onLocationChange}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-slate-100 text-slate-400">
              Kartan kunde inte laddas på grund av ogiltiga koordinater.
            </div>
          )}
        </div>

        {/* Right column: Audit Status and Logs */}
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 flex flex-col justify-between shadow-sm">
          <div className="space-y-4">
            <h4 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">Geofence Status</h4>
            
            {loading ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 py-2">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-700">Analys pågår...</span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 rounded-2xl bg-white border border-slate-100 p-4 font-mono text-xs text-slate-600">
                  {analysisStatus.map((statusLine, idx) => (
                    <div key={`${statusLine}-${idx}`} className="flex items-center gap-2">
                      <span className="text-emerald-500">▶</span>
                      <span>{statusLine}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : auditBundle ? (
              <div className="space-y-4">
                {isOutOfSync ? (
                  <div className="flex flex-col gap-3 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-905 animate-in fade-in slide-in-from-top-1 duration-300">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
                      <span className="text-xs font-black uppercase tracking-wider">Positionen har ändrats</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-700">
                      Du har flyttat markören på kartan. Kör en ny analys för att uppdatera skyddszoner och geofencing för den nya platsen.
                    </p>
                    <button
                      type="button"
                      onClick={onReRunAudit}
                      disabled={loading}
                      className="w-full rounded-xl bg-amber-600 py-2.5 text-center text-xs font-black uppercase tracking-wider text-white hover:bg-amber-700 transition"
                    >
                      Uppdatera analys för ny plats
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-800">
                    <CheckCircle size={18} />
                    <span className="text-xs font-bold">Spatial analys slutförd för {wizardState.propertyId || 'vald fastighet'}.</span>
                  </div>
                )}

                <div className="space-y-2">
                  {/* Natura 2000 Protection */}
                  <AuditResultItem
                    title="Skyddad natur (NVR)"
                    status={auditBundle.spatial?.isProtected ? 'TRÄFF' : 'INGEN TRÄFF'}
                    isWarning={auditBundle.spatial?.isProtected}
                    desc={auditBundle.spatial?.isProtected ? 'Fastigheten ligger helt eller delvis inom Natura 2000 eller naturreservat.' : 'Ingen överlappning mot kända naturreservat.'}
                  />

                  {/* SMHI flood risk */}
                  <AuditResultItem
                    title="Översvämningsrisk (MSB)"
                    status={auditBundle.climate?.isFlooded ? 'VARNING' : 'INGEN TRÄFF'}
                    isWarning={auditBundle.climate?.isFlooded}
                    desc={auditBundle.climate?.isFlooded ? 'MSB indikerar översvämningsrisk vid 100-årsflöde i området.' : 'Låg risk för översvämning enligt screening.'}
                  />

                  {/* Water protection */}
                  <AuditResultItem
                    title="Recipient / Vattenskydd"
                    status={auditBundle.water?.hasWaterRisk ? 'NÄRHET' : 'OK'}
                    isWarning={auditBundle.water?.hasWaterRisk}
                    desc={auditBundle.water?.hasWaterRisk ? 'Närhet till känslig vattenförekomst eller skyddsklassat område.' : 'Inga omedelbara vattenrisker identifierade.'}
                  />

                  {/* SGU Georisk */}
                  <AuditResultItem
                    title="SGU Georisk & Jordart"
                    status={auditBundle.spatial?.sgu?.riskLevel || 'LÅG'}
                    isWarning={auditBundle.spatial?.sgu?.riskLevel === 'HIGH' || auditBundle.spatial?.sgu?.riskLevel === 'MEDIUM'}
                    desc={auditBundle.spatial?.sgu?.summary || `Jordart: ${wizardState.soilType}. Inga geotekniska riskflaggor.`}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 rounded-2xl border-2 border-dashed border-slate-200 bg-white">
                <AlertTriangle size={32} className="text-slate-400" />
                <p className="text-xs text-slate-500 max-w-xs">
                  Ingen spatial geofence-analys har körts för de valda koordinaterna än.
                </p>
                <button
                  type="button"
                  onClick={onReRunAudit}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-black transition"
                >
                  Kör analys
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-6">
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl border border-slate-300 bg-white py-3.5 text-xs font-black uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <ArrowLeft size={14} /> Föregående
            </button>
            <button
              type="button"
              onClick={onContinue}
              disabled={loading || !auditBundle || isOutOfSync}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 py-3.5 text-xs font-black uppercase tracking-[0.12em] text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isOutOfSync ? 'Uppdatera analys först' : 'Gå till sammanställning'} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

function AuditResultItem({ title, status, isWarning, desc }: { title: string; status: string; isWarning: boolean; desc: string }) {
  return (
    <div className={`p-3 rounded-xl border text-xs leading-5 transition ${
      isWarning ? 'border-amber-200 bg-amber-50/50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'
    }`}>
      <div className="flex justify-between items-center mb-1 font-bold">
        <span>{title}</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${
          isWarning ? 'bg-amber-200 text-amber-850' : 'bg-slate-100 text-slate-500'
        }`}>{status}</span>
      </div>
      <p className="text-slate-500">{desc}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Summary and AI Draft Document Export
// ─────────────────────────────────────────────────────────────────────────────

interface RiskSummaryStepProps {
  wizardState: WizardState;
  auditBundle: AuditBundle;
  onBack: () => void;
  onReset: () => void;
}

type PermitDraftResponse = {
  document_type: string;
  draft_text: string;
};

export const RiskSummaryStep: React.FC<RiskSummaryStepProps> = ({
  wizardState,
  auditBundle,
  onBack,
  onReset,
}) => {
  const [draft, setDraft] = useState<PermitDraftResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Checklist states for manual validation steps
  const [checklist, setChecklist] = useState<Array<{ id: number; text: string; checked: boolean }>>([
    { id: 1, text: 'Kontrollera skyddsavstånd till närliggande brunnar (avlopp/kemikalier)', checked: false },
    { id: 2, text: 'Verifiera hårdgjord yta och dagvattenavledning på situationskartan', checked: false },
    { id: 3, text: 'Stäm av med tillsynsvägledning för gällande kommunspecifika taxor', checked: false },
    { id: 4, text: 'Säkerställ att skyddsåtgärder (invallning/absorbent) finns dokumenterade', checked: false },
  ]);

  const toggleChecklistItem = (id: number) => {
    setChecklist(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };

  // Compile inputs and trigger LLM generation
  const handleGenerateDraft = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Map inputs to match the expected permit backend structure
      const processDesc = wizardState.moduleType === 'ENSKILT_AVLOPP'
        ? `Inrättande av enskilt avlopp för ${wizardState.peCount} PE. Typ av anläggning: ${wizardState.systemType}. Jordart: ${wizardState.soilType}. Mottagare: ${wizardState.recipient}.`
        : wizardState.moduleType === 'C_ANMALAN'
          ? wizardState.projectDescription
          : `Lokaliseringsutredning för etablering av ${wizardState.activityCodeLU}. Skyddsobjekt i närheten: ${wizardState.luSensitiveReceptors}. Beskrivning: ${wizardState.luProjectDescription}. Utredda alternativ: ${wizardState.luAlternatives}.`;

      const response = await callMvp<PermitDraftResponse>('/api/v1/permit/generate', {
        method: 'POST',
        body: {
          project_data: {
            name: `Lokaliseringsutredning ${wizardState.propertyId}`,
            municipality: wizardState.municipality || 'Haninge',
            property_id: wizardState.propertyId,
            ewc_code: 'N/A',
            volume_tons: 0,
          },
          process_description: processDesc,
          water_management: wizardState.moduleType === 'LU' ? wizardState.luWaterImpact : 'Ej tillämpligt',
          storage_safety: 'Ej tillämpligt',
        },
      });
      setDraft(response);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Ett fel uppstod vid generering av utkastet.');
    } finally {
      setGenerating(false);
    }
  };

  // Export draft text to Word/docx
  const handleDownloadDocx = async () => {
    if (!draft?.draft_text) return;
    try {
      const blob = await callMvp<Blob>('/api/v1/document/export', {
        method: 'POST',
        body: {
          document_type: draft.document_type,
          draft_text: draft.draft_text,
        },
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Underlag_${wizardState.moduleType}_${wizardState.propertyId.replace(/ /g, '_')}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(anchor);
    } catch (e) {
      console.error('Kunde inte exportera Word-dokument:', e);
      // Fallback plain text download
      const blob = new Blob([draft.draft_text], { type: 'text/plain; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Underlag_${wizardState.moduleType}_${wizardState.propertyId.replace(/ /g, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <section className="min-h-[600px] p-6 md:p-10 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600 block">Steg 3</span>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight">Sammanställning & AI-dokument</h3>
          <p className="mt-1 text-sm text-slate-500">
            Granska dina valda värden och generera det färdiga anmälningsunderlaget med AI-stöd.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.4fr] gap-6">
        {/* Left column: Summary details and trigger */}
        <div className="space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Sammanfattning Fastighet</h4>
              <div className="grid grid-cols-2 gap-3 text-xs leading-4">
                <div>
                  <span className="text-slate-400 block mb-0.5">Fastighet</span>
                  <span className="font-bold text-slate-800">{wizardState.propertyId}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Kommun</span>
                  <span className="font-bold text-slate-800">{wizardState.municipality}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Koordinater</span>
                  <span className="font-mono text-slate-700">{Number(wizardState.lat).toFixed(4)}, {Number(wizardState.lng).toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Ärendetyp</span>
                  <span className="font-bold text-slate-800">{wizardState.moduleType}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Ärendeuppgifter</h4>
              <div className="text-xs leading-5 text-slate-700 space-y-2">
                {wizardState.moduleType === 'ENSKILT_AVLOPP' && (
                  <>
                    <p><strong>Belastning:</strong> {wizardState.peCount} PE</p>
                    <p><strong>Anläggningstyp:</strong> {wizardState.systemType}</p>
                    <p><strong>Recipient:</strong> {wizardState.recipient}</p>
                    <p><strong>Jordart:</strong> {wizardState.soilType}</p>
                  </>
                )}
                {wizardState.moduleType === 'C_ANMALAN' && (
                  <>
                    <p><strong>Verksamhetskod:</strong> {wizardState.activityCode}</p>
                    <p><strong>Avfallskod (EWC):</strong> {wizardState.ewcCode}</p>
                    <p><strong>Volym:</strong> {wizardState.volumeTons} ton</p>
                    <p className="text-slate-500 italic mt-1">"{wizardState.projectDescription}"</p>
                  </>
                )}
                {wizardState.moduleType === 'LU' && (
                  <>
                    <p><strong>Projekttyp:</strong> {wizardState.activityCodeLU}</p>
                    <p><strong>Bostäder/skyddsobjekt:</strong> {wizardState.luSensitiveReceptors}</p>
                    <p><strong>Utredda alternativ:</strong> {wizardState.luAlternatives}</p>
                    <p className="text-slate-500 italic mt-1">"{wizardState.luProjectDescription}"</p>
                  </>
                )}
              </div>
            </div>

            {/* Compliance checklist */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">Manuell checklist-kontroll</h4>
              <div className="space-y-2">
                {checklist.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleChecklistItem(item.id)}
                    className="w-full flex items-start gap-2.5 text-left text-xs text-slate-600 hover:text-slate-900 py-1 transition"
                  >
                    {item.checked ? (
                      <CheckSquare size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <Square size={16} className="text-slate-300 mt-0.5 shrink-0" />
                    )}
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onBack}
              disabled={generating}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl border border-slate-300 bg-white py-3.5 text-xs font-black uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <ArrowLeft size={14} /> Föregående
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={generating}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl border border-slate-300 bg-slate-50 py-3.5 text-xs font-black uppercase tracking-[0.12em] text-slate-650 hover:bg-slate-100 disabled:opacity-50 transition"
            >
              Börja om
            </button>
          </div>
        </div>

        {/* Right column: Generated Document View */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-md p-6 flex flex-col justify-between h-[550px]">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex justify-between items-center pb-4 border-b border-slate-150 shrink-0">
              <h4 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">Ansökningsdokument</h4>
              {draft && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-800 transition"
                  >
                    <i className="fas fa-print text-xs"></i> Skriv ut / Spara PDF
                  </button>
                  <span className="text-slate-200">|</span>
                  <button
                    type="button"
                    onClick={handleDownloadDocx}
                    className="flex items-center gap-1.5 text-xs font-black text-emerald-600 hover:text-emerald-800 transition"
                  >
                    <Download size={15} /> Ladda ned Word-fil
                  </button>
                </div>
              )}
            </div>

            <style>{`
              @media print {
                body {
                  background: white !important;
                }
                body * {
                  visibility: hidden;
                }
                .printable-document, .printable-document * {
                  visibility: visible;
                }
                .printable-document {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  background: white !important;
                  color: black !important;
                  font-size: 11pt !important;
                  line-height: 1.6;
                  margin: 0 !important;
                  padding: 1.5cm !important;
                  border: none !important;
                  box-shadow: none !important;
                  overflow: visible !important;
                  height: auto !important;
                  white-space: pre-wrap !important;
                }
              }
            `}</style>

            {generating ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">AI skapar underlag...</span>
              </div>
            ) : draft ? (
              <div className="printable-document flex-1 overflow-y-auto mt-4 pr-1 font-['Plus_Jakarta_Sans'] text-xs leading-relaxed text-slate-700 whitespace-pre-wrap border border-slate-100 rounded-2xl bg-slate-50/50 p-5 shadow-inner">
                {draft.draft_text}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                <FileText size={48} className="text-slate-300" />
                <div>
                  <p className="text-xs font-bold text-slate-500">Inget utkast genererat än</p>
                  <p className="mt-1 text-[11px] text-slate-400 max-w-xs leading-4">
                    Klicka på knappen nedan för att generera ett AI-understött anmälningsdokument baserat på din indata och geofence-analys.
                  </p>
                </div>
                {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
                <button
                  type="button"
                  onClick={() => void handleGenerateDraft()}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-black transition"
                >
                  Generera utkast
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
