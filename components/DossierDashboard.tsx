import React, { useEffect, useMemo, useState } from 'react';
import type { EnvironmentalDataInput } from '../services/orchestrator/vertexDirigentService';
import MapComponent from '../app/components/MapComponent';

interface DossierData {
  propertyId: string;
  inputData: EnvironmentalDataInput;
  analysis: {
    summary: string;
    riskClass: 'LÅG' | 'MEDEL' | 'HÖG';
    recommendations: Array<{
      text: string;
      citation: {
        lawChapter: string;
        sourceText: string;
      };
    }>;
  };
}

export const DossierDashboard: React.FC = () => {
  const defaultProperty = 'ORSA STACKMORA 3:12';
  const [data, setData] = useState<DossierData | null>(null);
  const [propertyInput, setPropertyInput] = useState(defaultProperty);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propertySuggestions = useMemo(
    () => ['ORSA STACKMORA 3:12', 'GAVLE BRYNAS 1:1', 'STOCKHOLM NEDRE NORRMALM 1:1'],
    [],
  );

  const loadData = async (property: string) => {
    const trimmed = property.trim();
    if (!trimmed) {
      setError('Ange en fastighetsbeteckning innan analys körs.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/dossier/${encodeURIComponent(trimmed)}`);
      const payload = (await response.json()) as { error?: string } & Partial<DossierData>;

      if (!response.ok) {
        throw new Error(payload.error || 'Misslyckades att hämta dossier-data.');
      }

      setData(payload as DossierData);
      setPropertyInput(trimmed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Okänt fel vid hämtning av dossier.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData(defaultProperty);
  }, []);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    void loadData(propertyInput);
  };

  if (isLoading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa]">
        <div className="rounded-2xl border border-[#0f5238]/20 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-[#0f5238]" />
          <p className="font-medium text-[#191c1d]">Analyserar fastighet med Vertex AI...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto min-h-screen max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
          <p className="text-sm font-black uppercase tracking-wider">Dossier kunde inte laddas</p>
          <p className="mt-2 font-semibold">{error}</p>
          <button
            type="button"
            onClick={() => void loadData(propertyInput)}
            className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
          >
            Försök igen
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { analysis, inputData, propertyId } = data;

  // Extrahera koordinater för kartan (GeoJSON [lng, lat]).
  const coords = inputData.geometry?.coordinates || [14.6152, 61.1215];
  const mapCenter: [number, number] = [coords[1], coords[0]];

  const recommendations = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans text-[#191c1d]">
      <div className="mx-auto max-w-[1440px] p-6">
        <header className="mb-8 rounded-2xl border border-[#707973]/10 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <nav className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#404943]">
                <span>Registry</span>
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                <span className="text-[#0f5238]">{propertyId}</span>
              </nav>
              <h1 className="text-2xl font-extrabold tracking-tight text-[#191c1d] md:text-3xl">
                Fastighetsdossier: {propertyId}
              </h1>
            </div>
            <div className="flex gap-3">
              <a
                href={`/api/dossier/${encodeURIComponent(propertyId)}?format=pdf`}
                download
                className="flex items-center gap-2 rounded-lg border border-[#0f5238] bg-white px-4 py-2.5 text-sm font-semibold text-[#0f5238] transition-all hover:bg-slate-50"
              >
                <i className="fas fa-file-pdf" /> Exportera PDF
              </a>
              <button
                type="button"
                onClick={() => void loadData(propertyId)}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-lg bg-[#0f5238] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <i className={`fas ${isLoading ? 'fa-spinner fa-spin' : 'fa-sync'}`} />
                Uppdatera analys
              </button>
            </div>
          </div>

          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={propertyInput}
              onChange={(event) => setPropertyInput(event.target.value)}
              placeholder="Ange fastighetsbeteckning, t.ex. GAVLE BRYNAS 1:1"
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 outline-none ring-[#0f5238] placeholder:text-slate-400 focus:ring-2"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Kör ny analys
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {propertySuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setPropertyInput(suggestion);
                  void loadData(suggestion);
                }}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">
            Human-in-the-loop: juridisk slutgranskning krävs.
          </p>
          {error ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              Senaste körningen gav varning: {error}
            </p>
          ) : null}
        </header>

        <section className="mb-8">
          <div
            className={`group relative flex items-center justify-between overflow-hidden rounded-xl p-8 ${
              analysis.riskClass === 'HÖG'
                ? 'bg-[#b91f20]'
                : analysis.riskClass === 'MEDEL'
                  ? 'bg-[#e67e22]'
                  : 'bg-[#0f5238]'
            }`}
          >
            <div className="relative z-10 flex gap-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-white/20 text-3xl text-white backdrop-blur-md">
                <i
                  className={`fas ${analysis.riskClass === 'HÖG' ? 'fa-triangle-exclamation' : 'fa-circle-info'}`}
                />
              </div>
              <div>
                <h2 className="mb-1 text-3xl font-black uppercase tracking-tight text-white">
                  Riskklass: {analysis.riskClass}
                </h2>
                <p className="max-w-xl font-medium text-white/80">{analysis.summary}</p>
              </div>
            </div>
            <div className="z-10 text-right">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-white/60">Confidence</p>
              <p className="text-5xl font-black text-white">AI</p>
            </div>
          </div>
        </section>

        <section className="mb-8 grid grid-cols-12 gap-6">
          <div className="relative col-span-12 h-[500px] overflow-hidden rounded-2xl border border-[#707973]/10 lg:col-span-8">
            <MapComponent propertyId={propertyId} center={mapCenter} />
            <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#404943]">
                Lokaliseringskarta
              </p>
              <p className="font-mono text-[11px] text-[#191c1d]">
                {mapCenter[0].toFixed(4)}, {mapCenter[1].toFixed(4)}
              </p>
            </div>
          </div>

          <div className="col-span-12 flex flex-col gap-6 lg:col-span-4">
            <div className="rounded-2xl border border-[#707973]/10 bg-white p-6 shadow-sm">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#404943]">
                Primär Jordart
              </p>
              <h3 className="text-2xl font-black text-[#191c1d]">{inputData.sgu.soilTypes[0] || 'Okänt'}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#404943]">
                {inputData.sgu.soilTypes.length > 0
                  ? `Fastigheten domineras av ${inputData.sgu.soilTypes.join(', ')}.`
                  : 'Ingen jordartsdata tillgänglig för denna plats.'}
              </p>
            </div>

            <div className="rounded-2xl border border-[#707973]/10 bg-white p-6 shadow-sm">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#404943]">
                Avstånd till ytvatten
              </p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-3xl font-black text-[#94000e]">
                  {inputData.hydrography.distanceToSurfaceWaterMeters !== null
                    ? Math.round(inputData.hydrography.distanceToSurfaceWaterMeters)
                    : '?'}
                </h3>
                <span className="text-lg font-bold text-[#191c1d] opacity-50">meter</span>
              </div>
              <p className="mt-2 text-sm text-[#404943]">
                {inputData.hydrography.distanceToSurfaceWaterMeters !== null &&
                inputData.hydrography.distanceToSurfaceWaterMeters < 50
                  ? 'Fastigheten ligger nära vattenförekomst.'
                  : 'Fastigheten ligger på säkert avstånd från kända vattenförekomster.'}
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-[#404943]">
            AI Rekommendationer med källhänvisning
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {recommendations.length === 0 ? (
              <div className="rounded-xl border border-[#707973]/10 bg-white p-5 text-sm font-medium text-slate-600 shadow-sm">
                Inga rekommendationer kunde genereras för vald fastighet.
              </div>
            ) : (
              recommendations.map((rec, idx) => (
                <div
                  key={`${rec.text}-${idx}`}
                  className="flex flex-col gap-3 rounded-xl border border-[#707973]/10 bg-white p-5 shadow-sm"
                >
                  <p className="text-sm font-medium leading-relaxed text-[#191c1d]">{rec.text}</p>
                  <div className="mt-auto border-t border-slate-50 pt-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#0f5238]">
                      <i className="fas fa-gavel text-[10px]" />
                      {rec.citation.lawChapter}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] italic text-[#404943]/60">
                      "{rec.citation.sourceText}"
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
