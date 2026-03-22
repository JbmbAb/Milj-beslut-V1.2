import React, { useMemo, useState } from 'react';
import type { Permit } from '../types';
import MapView from './MapView';
import WeatherRisk from './WeatherRisk';

interface PermitPortalMapPanelProps {
  permits: Permit[];
}

const PermitPortalMapPanel: React.FC<PermitPortalMapPanelProps> = ({ permits }) => {
  const [selectedMuni, setSelectedMuni] = useState('');

  const municipalities = useMemo(
    () => Array.from(new Set(permits.map((permit) => permit.municipality))).sort(),
    [permits]
  );
  const hasPermitData = municipalities.length > 0;
  const activeMunicipality =
    selectedMuni && municipalities.includes(selectedMuni) ? selectedMuni : municipalities[0] || '';

  const selectedWeatherCoordinates = useMemo(() => {
    const permitWithCoordinates = permits.find(
      (permit) =>
        permit.municipality === activeMunicipality &&
        typeof permit.lat === 'number' &&
        Number.isFinite(permit.lat) &&
        typeof permit.lng === 'number' &&
        Number.isFinite(permit.lng)
    );

    return permitWithCoordinates
      ? { lat: permitWithCoordinates.lat as number, lng: permitWithCoordinates.lng as number }
      : null;
  }, [activeMunicipality, permits]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Oversikt</p>
        <h2 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">Kartbaserad insikt med riskstod</h2>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Kombinera vaderdata, markforhallanden och miljoskyddsobjekt for snabb nulagesbedomning.
        </p>
      </section>

      {hasPermitData ? (
        <>
          <WeatherRisk municipality={activeMunicipality} coordinates={selectedWeatherCoordinates} />

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4 md:flex md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Karta</p>
                <h3 className="text-lg font-black text-slate-900">Interaktiv kartutforskare</h3>
              </div>
              <div className="mt-3 w-full md:mt-0 md:w-56">
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Kommun</label>
                <select
                  value={activeMunicipality}
                  onChange={(event) => setSelectedMuni(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800"
                >
                  {municipalities.map((municipality) => (
                    <option key={municipality} value={municipality}>
                      {municipality}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="h-[420px] md:h-[620px]">
              <MapView permits={permits} onSelectPermit={() => undefined} />
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">Kartutforskare</p>
          <h3 className="mt-2 text-xl font-black text-slate-900">Ingen verifierad permitdata tillganglig</h3>
          <p className="mt-3 max-w-3xl text-sm text-slate-700">
            Vaderkort, kommunval och kartinsikt visas forst nar riktiga arendeposter med kommun och koordinater finns i
            databasen. Syntetiska permit-poster anvands inte langre som fallback.
          </p>
        </section>
      )}

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm md:flex md:items-center md:justify-between md:gap-8">
        <div className="flex items-start gap-4">
          <div className="mt-1 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/15 text-blue-300">
            <i className="fas fa-satellite-dish" />
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Data fusion</p>
            <h4 className="mt-1 text-lg font-black">Spatial AI engine aktiv</h4>
            <p className="mt-2 text-sm text-slate-300">
              Lantmateriet, SLU och SMHI underlag sammanfogas till ett gemensamt beslutslager med tydlig prioritering av
              risker.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mt-4 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] md:mt-0"
        >
          Exportera spatial audit
        </button>
      </section>
    </div>
  );
};

export default PermitPortalMapPanel;
