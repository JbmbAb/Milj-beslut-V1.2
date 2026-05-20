import React, { useEffect, useState } from 'react';
import { fetchSmhiWeatherRisk } from '../services/weatherService';
import { WeatherRisk as WeatherRiskType } from '../types';

function formatMetric(value: number | null | undefined, unit: string): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return `${value.toFixed(1)} ${unit}`;
}

const WeatherRisk: React.FC<{ municipality: string; coordinates?: { lat: number; lng: number } | null }> = ({
  municipality,
  coordinates,
}) => {
  const [risk, setRisk] = useState<WeatherRiskType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadRisk = async () => {
      setLoading(true);

      if (!coordinates) {
        if (!cancelled) {
          setRisk({
            level: 'Medel',
            description: `SMHI-prognos kraver punktkoordinater. Ingen verifierad platsdata hittades for ${municipality}.`,
            action:
              'Valj ett arende med karta eller komplettera koordinater innan vaderbedomning anvands i beslut.',
            source: 'manual_review',
            municipality,
            fetchedAt: new Date().toISOString(),
          });
          setLoading(false);
        }
        return;
      }

      try {
        const result = await fetchSmhiWeatherRisk({
          lat: coordinates.lat,
          lng: coordinates.lng,
          municipality,
        });
        if (!cancelled) {
          setRisk(result);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setRisk({
            level: 'Medel',
            description: `Kunde inte hamta SMHI-prognos for ${municipality}. Kontroll kravs manuellt innan vaderberoende arbete startas.`,
            action:
              'Kontrollera SMHI manuellt och dokumentera nederbord, vind och eventuella driftbegransningar.',
            source: 'manual_review',
            municipality,
            coordinates,
            fetchedAt: new Date().toISOString(),
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadRisk();

    return () => {
      cancelled = true;
    };
  }, [municipality, coordinates]);

  if (loading) {
    return (
      <div className="bg-slate-900 p-8 rounded-[2.5rem] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div
      className={`p-8 rounded-[2.5rem] border shadow-2xl transition-all duration-500 flex items-center gap-8 ${
        risk?.level === 'Hög'
          ? 'bg-rose-950 border-rose-800'
          : risk?.level === 'Medel'
            ? 'bg-amber-950 border-amber-800'
            : 'bg-slate-900 border-slate-800'
      }`}
    >
      <div
        className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-inner ${
          risk?.level === 'Hög'
            ? 'bg-rose-500 text-white'
            : risk?.level === 'Medel'
              ? 'bg-amber-500 text-white'
              : 'bg-blue-600 text-white'
        }`}
      >
        <i className={`fas ${risk?.level === 'Hög' ? 'fa-cloud-showers-heavy' : 'fa-cloud-sun'}`}></i>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            SMHI Prediktion
          </span>
          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
              risk?.level === 'Hög' ? 'bg-rose-500 text-white' : 'text-slate-400 border border-slate-700'
            }`}
          >
            Risk: {risk?.level}
          </span>
        </div>
        <h4 className="text-xl font-black text-white italic tracking-tight">Vaderpaverkan vid schakt</h4>
        <p className="text-slate-400 text-xs mt-2 leading-relaxed">{risk?.description}</p>
        {risk?.summary && (
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
            {formatMetric(risk.summary.airTemperatureC, 'C') && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Temp {formatMetric(risk.summary.airTemperatureC, 'C')}
              </span>
            )}
            {formatMetric(risk.summary.precipitationMmPerHour, 'mm/h') && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Regn {formatMetric(risk.summary.precipitationMmPerHour, 'mm/h')}
              </span>
            )}
            {formatMetric(risk.summary.gustMs, 'm/s') && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Byar {formatMetric(risk.summary.gustMs, 'm/s')}
              </span>
            )}
            {typeof risk.summary.thunderstormRiskPct === 'number' && risk.summary.thunderstormRiskPct > 0 && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Aska {risk.summary.thunderstormRiskPct.toFixed(0)}%
              </span>
            )}
          </div>
        )}
        <div className="mt-4 flex items-center gap-2 text-blue-400 text-[10px] font-black uppercase tracking-widest">
          <i className="fas fa-hand-holding-medical"></i> Rekommendation: {risk?.action}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <i className="fas fa-satellite-dish"></i>
          Kalla: {risk?.source === 'smhi_pmp3g' ? 'SMHI PMP3G' : 'Manuell kontroll'}
        </div>
      </div>
    </div>
  );
};

export default WeatherRisk;
