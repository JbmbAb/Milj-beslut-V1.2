/* eslint-disable no-irregular-whitespace */
import React, { useEffect, useState } from 'react';
import { csrfFetch } from '../services/csrfClient';
import PropertyLookupDetails, {
  type GeoJsonGeometry,
  type PropertyLookupResult,
} from './PropertyLookupDetails';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const PROJECT_KEYS = ['miljobeslut_project_id', 'miljobeslut_admin_project'] as const;

/**
 * Extract a representative [lng, lat] coordinate from a GeoJSON geometry.
 * Returns the first ring's first point for Polygon/MultiPolygon, or the first
 * point for Point/MultiPoint/LineString/MultiLineString.
 */
function extractCentroidCoord(geometry: GeoJsonGeometry): [number, number] | null {
  try {
    const coords = geometry.coordinates;
    if (!coords) return null;
    switch (geometry.type) {
      case 'Point':
        if (Array.isArray(coords) && coords.length >= 2) return [Number(coords[0]), Number(coords[1])];
        break;
      case 'MultiPoint':
      case 'LineString':
        if (Array.isArray(coords) && Array.isArray(coords[0]) && (coords[0] as number[]).length >= 2) {
          const pt = coords[0] as number[];
          return [Number(pt[0]), Number(pt[1])];
        }
        break;
      case 'MultiLineString':
      case 'Polygon':
        if (
          Array.isArray(coords) &&
          Array.isArray(coords[0]) &&
          Array.isArray((coords[0] as number[][])[0])
        ) {
          const pt = (coords[0] as number[][])[0];
          return [Number(pt[0]), Number(pt[1])];
        }
        break;
      case 'MultiPolygon':
        if (
          Array.isArray(coords) &&
          Array.isArray(coords[0]) &&
          Array.isArray((coords[0] as number[][][])[0]) &&
          Array.isArray((coords[0] as number[][][])[0][0])
        ) {
          const pt = (coords[0] as number[][][])[0][0] as number[];
          return [Number(pt[0]), Number(pt[1])];
        }
        break;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

interface PropertyRegisterExtractProps {
  propertyId: string;
  projectId?: string;
}

/** Inline map panel shown inside PropertyRegisterExtract when geometry is available. */
const PropertyMap: React.FC<{ geometry: GeoJsonGeometry; designation: string }> = ({
  geometry,
  designation,
}) => {
  const coord = extractCentroidCoord(geometry);
  const geomType = String(geometry.type ?? 'okänd typ');

  if (!coord) {
    return (
      <p className="text-sm text-slate-600">
        Geometrityp: <span className="font-semibold">{geomType}</span> — koordinater kunde inte extraheras.
      </p>
    );
  }

  const [lng, lat] = coord;
  const zoom = 15;
  const osmSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}&layer=mapnik&marker=${lat},${lng}`;
  const osmLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  const label = encodeURIComponent(`${designation} (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
  const googleLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${label}`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Geometrityp: <span className="font-semibold text-slate-700">{geomType}</span>
        {' · '}
        <span className="font-mono">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
      </p>
      <iframe
        title={`Karta för ${designation}`}
        src={osmSrc}
        className="h-56 w-full rounded border border-slate-300"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div className="flex gap-3 text-xs">
        <a
          href={osmLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-800"
        >
          Öppna i OpenStreetMap ↗
        </a>
        <a
          href={googleLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-800"
        >
          Öppna i Google Maps ↗
        </a>
      </div>
    </div>
  );
};

const PropertyRegisterExtract: React.FC<PropertyRegisterExtractProps> = ({ propertyId, projectId }) => {
  const normalizedPropertyId = propertyId.trim();
  const [data, setData] = useState<PropertyLookupResult | null>(null);
  const [loading, setLoading] = useState(Boolean(normalizedPropertyId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!normalizedPropertyId) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) || '' : '';
        const pid =
          projectId ||
          (typeof window !== 'undefined'
            ? PROJECT_KEYS.map((key) => localStorage.getItem(key) || '').find(Boolean) || ''
            : '');
        const response = await csrfFetch('/api/property/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            projectId: pid,
            propertyDesignation: normalizedPropertyId,
            purpose: 'REGISTERUTDRAG',
          }),
        });
        const json = (await response.json()) as {
          ok: boolean;
          result?: PropertyLookupResult;
          error?: string;
        };
        if (!json.ok) {
          setError(json.error ?? 'Fastighetsuppslag misslyckades');
          setData(null);
        } else {
          setData(json.result ?? null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Okänt nätverksfel';
        setError(msg);
        console.error('PropertyRegisterExtract: fetch failed', err);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, [normalizedPropertyId, projectId]);

  if (!normalizedPropertyId) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">
        <p className="mb-1 font-black">Ingen verifierad fastighet vald</p>
        <p>Välj en fastighet för att visa registerutdrag och geometri.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse border border-slate-200 bg-white p-8">
        <div className="mb-4 h-4 w-1/4 rounded bg-slate-200"></div>
        <div className="mb-6 h-8 w-1/2 rounded bg-slate-200"></div>
        <div className="space-y-3">
          <div className="h-4 w-full rounded bg-slate-200"></div>
          <div className="h-4 w-full rounded bg-slate-200"></div>
          <div className="h-4 w-3/4 rounded bg-slate-200"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="mb-1 font-black">Fastighetsuppslag misslyckades</p>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data._demo) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="mb-1 font-black">Icke verifierad fastighetsdata blockerades</p>
        <p>Fastighetsutdrag visas bara när Lantmäteriet eller verifierad lokal geodatakälla svarar.</p>
      </div>
    );
  }

  const designation = String(data.designation ?? normalizedPropertyId);
  const municipality = designation.split(' ')[0] ?? '';

  return (
    <div className="relative mx-auto my-6 max-w-4xl overflow-hidden border-2 border-slate-900 bg-white p-8 font-serif text-slate-900 shadow-sm">
      <div className="pointer-events-none absolute right-8 top-4 rotate-[-15deg] border-4 border-slate-900 p-2 text-4xl font-black uppercase opacity-10">
        Registerutdrag
      </div>

      <header className="mb-6 border-b-2 border-slate-900 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">Fastighetsutdrag</h1>
            <p className="text-sm italic text-slate-600">Källa: Lantmäteriet — Fastighetsindelning</p>
          </div>
          <div className="text-right text-xs">
            <p>Utskriftsdatum: {new Date().toLocaleDateString('sv-SE')}</p>
            <p>Referens: LM-{designation.replace(/\s+/g, '-')}</p>
          </div>
        </div>
      </header>

      <section className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-xs font-black uppercase tracking-widest text-slate-500">
            Registerbeteckning
          </h2>
          <p className="mb-6 text-xl font-bold">{designation}</p>

          <h2 className="mb-2 border-b border-slate-200 pb-1 text-xs font-black uppercase tracking-widest text-slate-500">
            Kommun
          </h2>
          <p className="mb-6 font-semibold">{municipality || '—'}</p>
        </div>

        <div className="border border-slate-200 bg-slate-50 p-4">
          <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Geometridata</h2>
          {data.geometry ? (
            <PropertyMap geometry={data.geometry} designation={designation} />
          ) : (
            <p className="text-sm italic text-slate-400">Ingen geometri tillgänglig</p>
          )}
        </div>
      </section>

      <section className="mt-8 border-t border-slate-200 pt-6">
        <PropertyLookupDetails result={data} requestedDesignation={normalizedPropertyId} />
      </section>

      <footer className="mt-12 flex justify-between border-t border-slate-200 pt-4 text-[10px] text-slate-400">
        <p>Data hÃ¤mtad: {new Date().toLocaleString('sv-SE')}</p>
        <p>Handlingens giltighet bÃ¶r styrkas mot LantmÃ¤teriets huvudregister.</p>
      </footer>
    </div>
  );
};

export default PropertyRegisterExtract;
