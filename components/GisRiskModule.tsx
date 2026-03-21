import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MapLayerKey, Permit } from "../types";
import MapView from "./MapView";
import { useProjectStructure } from "./ProjectStructureContext";

const TOKEN_KEY = "miljobeslut_admin_bearer";
const PROJECT_KEY = "miljobeslut_admin_project";

type UploadedGeoJson = {
  type: string;
  features?: Array<{ geometry?: { type?: string } }>;
};

type AnalysisResult = {
  score: number;
  conflicts: Array<{ text: string; layer?: string }>;
  recommendation: string;
  gateStatus: string;
};

function isGeoJsonLike(value: unknown): value is UploadedGeoJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as UploadedGeoJson;
  return typeof candidate.type === "string";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface GisRiskModuleProps {
  permits?: Permit[];
}

const GisRiskModule: React.FC<GisRiskModuleProps> = ({ permits = [] }) => {
  const { evaluateGate, addArchiveDocument, markModuleReady } = useProjectStructure();
  const [uploadedData, setUploadedData] = useState<UploadedGeoJson | null>(null);

  // Property designation (beteckning) search state
  const [beteckning, setBeteckning] = useState("");
  const [propertyGeoJson, setPropertyGeoJson] = useState<object | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyError, setPropertyError] = useState("");
  const [propertyDemo, setPropertyDemo] = useState(false);
  const [foundBeteckning, setFoundBeteckning] = useState("");

  const searchProperty = async () => {
    const trimmed = beteckning.trim();
    if (!trimmed) return;
    setPropertyLoading(true);
    setPropertyError("");
    setPropertyGeoJson(null);
    setPropertyDemo(false);
    setFoundBeteckning("");
    try {
      const token = typeof window !== "undefined" ? (localStorage.getItem(TOKEN_KEY) ?? "") : "";
      const projectId = typeof window !== "undefined" ? (localStorage.getItem(PROJECT_KEY) ?? "") : "";
      if (!token) {
        setPropertyError("Du måste vara inloggad för att söka fastigheter. Logga in via Admin Console.");
        return;
      }
      if (!projectId) {
        setPropertyError("Inget aktivt projekt hittades. Öppna ett projekt innan du söker.");
        return;
      }
      const response = await fetch("/api/property/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId,
          propertyDesignation: trimmed,
          purpose: "KARTVISNING",
        }),
      });
      const json = (await response.json()) as { ok: boolean; result?: { geometry?: unknown; _demo?: boolean; designation?: string }; error?: string };
      if (!json.ok) {
        setPropertyError(json.error ?? "Sökningen misslyckades");
      } else if (!json.result?.geometry) {
        setPropertyError("Ingen geometri returnerades för beteckningen.");
      } else {
        setPropertyGeoJson(json.result.geometry as object);
        setPropertyDemo(!!json.result._demo);
        setFoundBeteckning(json.result.designation ?? trimmed);
      }
    } catch (err: unknown) {
      setPropertyError(err instanceof Error ? err.message : "Nätverksfel vid fastighetssökning.");
    } finally {
      setPropertyLoading(false);
    }
  };

  // Merge uploaded GeoJSON and property search result for map display
  const mapData = useMemo(() => {
    const features: unknown[] = [];
    if (uploadedData) {
      if (uploadedData.type === "FeatureCollection" && Array.isArray(uploadedData.features)) {
        features.push(...uploadedData.features);
      } else {
        features.push({ type: "Feature", geometry: uploadedData, properties: {} });
      }
    }
    if (propertyGeoJson) {
      features.push({ type: "Feature", geometry: propertyGeoJson, properties: { label: foundBeteckning } });
    }
    if (features.length === 0) return null;
    return { type: "FeatureCollection", features };
  }, [uploadedData, propertyGeoJson, foundBeteckning]);

  const [riskParameters, setRiskParameters] = useState({
    bufferDistance: 100,
    sensitivityLevel: "Medium" as "Low" | "Medium" | "High",
    includeFloodRisk: true,
    includeProtectedAreas: true,
  });
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [highlightedLayer, setHighlightedLayer] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [fileError, setFileError] = useState("");

  const featureCount = useMemo(() => {
    if (!uploadedData?.features || !Array.isArray(uploadedData.features)) return 0;
    return uploadedData.features.length;
  }, [uploadedData]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const json = JSON.parse(String(loadEvent.target?.result || ""));
        if (!isGeoJsonLike(json)) {
          setFileError("Filen ar inte giltig GeoJSON.");
          setUploadedData(null);
          return;
        }
        setFileError("");
        setMessage(`GeoJSON laddad (${Array.isArray(json.features) ? json.features.length : 0} features).`);
        setUploadedData(json);
        setAnalysisResult(null);
      } catch {
        setFileError("Kunde inte lasa filen. Kontrollera JSON-format.");
        setUploadedData(null);
      }
    };
    reader.readAsText(file);
  };

  const runAnalysis = async () => {
    if (!uploadedData) return;
    setIsAnalyzing(true);
    setHighlightedLayer(undefined);
    setMessage("");

    const geometryTypes = new Set(
      (uploadedData.features || [])
        .map((item) => item.geometry?.type)
        .filter((item): item is string => Boolean(item))
    );

    const conflicts: Array<{ text: string; layer?: string }> = [];
    if (riskParameters.includeFloodRisk) {
      conflicts.push({
        text: "Overlapp med 100-ars oversvamningszon (MSB).",
        layer: "smhi_flood",
      });
    }
    if (riskParameters.includeProtectedAreas) {
      conflicts.push({
        text: "Narhet till Natura 2000-omrade (< 200m).",
        layer: "nv_natura",
      });
      conflicts.push({
        text: "Potentiell paverkan pa fornlamningar i naromradet.",
        layer: "raa_fornsok",
      });
    }
    if (geometryTypes.has("Point")) {
      conflicts.push({ text: "Punktgeometrier kraver validering mot fastighetsgranser.", layer: "sgu_jordart" });
    }

    const sensitivityWeight =
      riskParameters.sensitivityLevel === "High" ? 18 : riskParameters.sensitivityLevel === "Medium" ? 10 : 4;
    const floodWeight = riskParameters.includeFloodRisk ? 14 : 0;
    const protectedWeight = riskParameters.includeProtectedAreas ? 12 : 0;
    const featureWeight = clamp(Math.round(featureCount * 0.8), 3, 20);
    const bufferWeight = clamp(Math.round(riskParameters.bufferDistance / 25), 2, 20);
    const score = clamp(25 + sensitivityWeight + floodWeight + protectedWeight + featureWeight + bufferWeight, 0, 100);

    const recommendation =
      score >= 75
        ? "Hog riskprofil: kraver fordjupad miljo- och geoteknisk granskning innan inskick."
        : score >= 55
          ? "Medelhog riskprofil: komplettera med skyddsavstand, avvattningsplan och kontrollprogram."
          : "Lagre riskprofil: underlag ar anvandbart men verifiera lokala skyddsobjekt fore slutlig inlamning.";

    const enabledLayers: MapLayerKey[] = ["CADASTRE"];
    if (riskParameters.includeFloodRisk) enabledLayers.push("FLOOD_RISK");
    if (riskParameters.includeProtectedAreas) enabledLayers.push("NATURA2000", "PROTECTED_SPECIES");

    const gate = await evaluateGate("gate-RISK_REVIEW", {
      mapLayerAvailable: enabledLayers,
      note: `GIS risk score ${score}/100 (buffer ${riskParameters.bufferDistance}m).`,
    });

    addArchiveDocument({
      name: `GIS-Riskrapport-${new Date().toISOString().slice(0, 10)}`,
      module: "PERMIT_PORTAL",
      category: "RISK",
      status: "DRAFT",
      tags: ["gis", "risk", `score-${score}`],
    });
    markModuleReady("PERMIT_PORTAL", `GIS risk analysis completed. Gate status: ${gate.status}.`);

    setAnalysisResult({
      score,
      conflicts,
      recommendation,
      gateStatus: gate.status,
    });
    setMessage(`Riskanalys klar. Gate RISK_REVIEW: ${gate.status}.`);
    setIsAnalyzing(false);
  };

  return (
    <div className="flex h-full flex-col gap-8 animate-in fade-in duration-500 lg:flex-row">
      <div className="w-full shrink-0 space-y-6 lg:w-96">

        {/* Beteckningssökning på karta */}
        <div className="rounded-[2.5rem] border border-blue-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-xl text-blue-600">
              <i className="fas fa-map-location-dot" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight">Sök fastighet</h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Beteckning på karta</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fastighetsbeteckning</label>
            <input
              type="text"
              placeholder="t.ex. NACKA BOO 1:1"
              value={beteckning}
              onChange={(e) => setBeteckning(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void searchProperty(); }}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 placeholder-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              disabled={!beteckning.trim() || propertyLoading}
              onClick={() => void searchProperty()}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-xs font-black uppercase tracking-widest transition-all ${
                !beteckning.trim()
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
              }`}
            >
              {propertyLoading ? (
                <><i className="fas fa-spinner fa-spin" /> Söker...</>
              ) : (
                <><i className="fas fa-search" /> Visa på karta</>
              )}
            </button>
            {propertyError && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
                <i className="fas fa-triangle-exclamation mr-1" />{propertyError}
              </p>
            )}
            {propertyGeoJson && !propertyError && (
              <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${propertyDemo ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                {propertyDemo
                  ? <><i className="fas fa-flask mr-1" />Demo-koordinater — {foundBeteckning} visas på kartan</>
                  : <><i className="fas fa-check-circle mr-1" />{foundBeteckning} visas på kartan</>}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-xl text-rose-600">
              <i className="fas fa-shield-virus" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight">Risk-konfigurator</h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Spatial parametrisering</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Spatial data (GeoJSON)</label>
              <label className="group flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 transition-all hover:bg-slate-50">
                <div className="flex flex-col items-center justify-center pb-6 pt-5">
                  <i
                    className={`fas ${uploadedData ? "fa-check-circle text-emerald-500" : "fa-file-import text-slate-400"} mb-2 text-2xl transition-transform group-hover:scale-110`}
                  />
                  <p className="text-xs font-bold text-slate-500">{uploadedData ? "Data laddad" : "Dra och slapp GeoJSON"}</p>
                </div>
                <input type="file" className="hidden" accept=".json,.geojson" onChange={handleFileUpload} />
              </label>
              {fileError && <p className="text-xs font-semibold text-rose-600">{fileError}</p>}
              {uploadedData && <p className="text-xs text-slate-500">Features: {featureCount}</p>}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Buffertzon (m)</label>
                  <span className="text-[10px] font-black text-blue-600">{riskParameters.bufferDistance}m</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="10"
                  value={riskParameters.bufferDistance}
                  onChange={(event) =>
                    setRiskParameters((prev) => ({ ...prev, bufferDistance: Number.parseInt(event.target.value, 10) }))
                  }
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-100 accent-blue-600"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kanslighetsniva</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["Low", "Medium", "High"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setRiskParameters((prev) => ({ ...prev, sensitivityLevel: level }))}
                      className={`rounded-xl border py-2 text-[10px] font-black uppercase transition-all ${
                        riskParameters.sensitivityLevel === level
                          ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                          : "border-slate-100 bg-white text-slate-400 hover:border-slate-300"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <Toggle
                  label="Inkludera oversvamning"
                  active={riskParameters.includeFloodRisk}
                  onClick={() =>
                    setRiskParameters((prev) => ({ ...prev, includeFloodRisk: !prev.includeFloodRisk }))
                  }
                />
                <Toggle
                  label="Skyddade omraden"
                  active={riskParameters.includeProtectedAreas}
                  onClick={() =>
                    setRiskParameters((prev) => ({ ...prev, includeProtectedAreas: !prev.includeProtectedAreas }))
                  }
                />
              </div>
            </div>

            <button
              type="button"
              disabled={!uploadedData || isAnalyzing}
              onClick={() => void runAnalysis()}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-xs font-black uppercase tracking-widest transition-all ${
                !uploadedData
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-blue-600 text-white shadow-xl shadow-blue-200 hover:bg-blue-700"
              }`}
            >
              {isAnalyzing ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Analyserar...
                </>
              ) : (
                <>
                  <i className="fas fa-wand-magic-sparkles" /> Kor risk-analys
                </>
              )}
            </button>
            {message && <p className="text-xs text-slate-600">{message}</p>}
          </div>
        </div>

        <AnimatePresence>
          {analysisResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6 rounded-[2.5rem] bg-slate-900 p-8 text-white shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-widest text-blue-400">Analysresultat</h4>
                <div className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black">SCORE: {analysisResult.score}/100</div>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gate: {analysisResult.gateStatus}</p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Identifierade konflikter</p>
                  <ul className="space-y-2">
                    {analysisResult.conflicts.map((conflict) => (
                      <li
                        key={`${conflict.layer}-${conflict.text}`}
                        onClick={() => conflict.layer && setHighlightedLayer(conflict.layer)}
                        className={`cursor-pointer rounded-xl p-2 text-xs transition-all ${
                          highlightedLayer === conflict.layer ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"
                        }`}
                      >
                        <i className={`fas ${highlightedLayer === conflict.layer ? "fa-eye" : "fa-triangle-exclamation text-amber-500"} mr-2 mt-0.5`} />
                        {conflict.text}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-emerald-400">Rekommendation</p>
                  <p className="text-xs italic leading-relaxed text-slate-300">"{analysisResult.recommendation}"</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative min-h-[600px] flex-1 overflow-hidden rounded-[3rem] border border-slate-200 bg-white shadow-sm">
        <MapView
          permits={permits}
          geoJsonData={mapData}
          bufferDistance={riskParameters.bufferDistance}
          highlightLayer={highlightedLayer}
        />
        {isAnalyzing && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-4 rounded-[2rem] bg-white p-8 shadow-2xl">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-900">Spatial korsreferenskorning...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Toggle: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button type="button" onClick={onClick} className="group flex w-full items-center justify-between">
    <span className="text-xs font-bold text-slate-600 transition-colors group-hover:text-slate-900">{label}</span>
    <div className={`relative h-5 w-10 rounded-full transition-all ${active ? "bg-blue-600" : "bg-slate-200"}`}>
      <div className={`absolute top-1 h-3 w-3 rounded-full bg-white transition-all ${active ? "right-1" : "left-1"}`} />
    </div>
  </button>
);

export default GisRiskModule;
