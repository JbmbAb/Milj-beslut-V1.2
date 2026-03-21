import React, { useEffect, useState } from 'react';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const PROJECT_KEY = 'miljobeslut_project_id';

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

interface PropertyLookupResult {
  designation?: string | null;
  geometry?: GeoJsonGeometry | null;
  boundaries?: unknown;
  ownership?: { ownerType?: unknown; share?: unknown } | null;
  _demo?: boolean;
}

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
        if (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray((coords[0] as number[][])[0])) {
          const pt = (coords[0] as number[][])[0];
          return [Number(pt[0]), Number(pt[1])];
        }
        break;
      case 'MultiPolygon':
        if (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray((coords[0] as number[][][])[0]) && Array.isArray(((coords[0] as number[][][])[0])[0])) {
          const pt = ((coords[0] as number[][][])[0])[0] as number[];
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
const PropertyMap: React.FC<{ geometry: GeoJsonGeometry; designation: string }> = ({ geometry, designation }) => {
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
  // OpenStreetMap embed URL (no API key needed)
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
        <span className="font-mono">{lat.toFixed(6)}, {lng.toFixed(6)}</span>
      </p>
      <iframe
        title={`Karta för ${designation}`}
        src={osmSrc}
        className="w-full h-56 border border-slate-300 rounded"
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
  const [data, setData] = useState<PropertyLookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = typeof window !== 'undefined' ? (localStorage.getItem(TOKEN_KEY) || '') : '';
        const pid = projectId || (typeof window !== 'undefined' ? (localStorage.getItem(PROJECT_KEY) || '') : '');
        const response = await fetch('/api/property/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            projectId: pid,
            propertyDesignation: propertyId,
            purpose: 'REGISTERUTDRAG',
          }),
        });
        const json = await response.json() as { ok: boolean; result?: PropertyLookupResult; error?: string };
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
    fetchData();
  }, [propertyId, projectId]);

  if (loading) {
    return (
      <div className="p-8 animate-pulse bg-white border border-slate-200">
        <div className="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-slate-200 rounded w-1/2 mb-6"></div>
        <div className="space-y-3">
          <div className="h-4 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
        <p className="font-black mb-1">Fastighetsuppslag misslyckades</p>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const designation = String(data.designation ?? propertyId);
  const municipality = designation.split(' ')[0] ?? '';
  const hasOwnership = data.ownership && (data.ownership.ownerType || data.ownership.share);

  return (
    <div className="bg-white border-2 border-slate-900 p-8 shadow-sm font-serif max-w-4xl mx-auto my-6 text-slate-900 overflow-hidden relative">
      {/* Demo-badge */}
      {data._demo && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-800 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-bold">
            <span>⚠️</span>
            <span>Demo-data — Koordinaterna är syntetiska</span>
          </div>
          <p>
            För <strong>riktiga koordinater från Lantmäteriet</strong>, konfigurera credentials i <code className="font-mono bg-amber-100 px-1 rounded">.env</code>:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-700">
            <li>Hämta Consumer Key + Secret från{' '}
              <a
                href="https://www.lantmateriet.se/en/about-lantmateriet/it-services/api-portal/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold hover:text-amber-900"
              >
                Lantmäteriet API-portal ↗
              </a>
            </li>
            <li>Sätt <code className="font-mono bg-amber-100 px-1 rounded">LANTMATERIET_CONSUMER_KEY</code> och <code className="font-mono bg-amber-100 px-1 rounded">LANTMATERIET_CONSUMER_SECRET</code></li>
            <li>Eller sätt <code className="font-mono bg-amber-100 px-1 rounded">LANTMATERIET_ACCESS_TOKEN</code> (kortlivad testtoken)</li>
            <li>Testa anslutningen i <strong>Admin Console → Lantmäteriet — Testa riktiga koordinater</strong></li>
          </ul>
        </div>
      )}
      {/* Vattenstämpel */}
      <div className="absolute top-4 right-8 opacity-10 pointer-events-none uppercase text-4xl font-black rotate-[-15deg] border-4 border-slate-900 p-2">
        Registerutdrag
      </div>

      <header className="border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex justify-between items-start">
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

      <section className="grid md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Registerbeteckning</h2>
          <p className="text-xl font-bold mb-6">{designation}</p>

          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Kommun</h2>
          <p className="font-semibold mb-6">{municipality || '—'}</p>

          {hasOwnership && (
            <>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Ägarförhållanden</h2>
              <p className="font-semibold mb-6">{String(data.ownership?.ownerType ?? '—')}</p>
            </>
          )}
        </div>

        <div className="bg-slate-50 p-4 border border-slate-200">
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Geometridata</h2>
          {data.geometry ? (
            <PropertyMap geometry={data.geometry} designation={designation} />
          ) : (
            <p className="text-sm italic text-slate-400">Ingen geometri tillgänglig</p>
          )}
        </div>
      </section>

      <footer className="mt-12 pt-4 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between">
        <p>Data hämtad: {new Date().toLocaleString('sv-SE')}</p>
        <p>Handlingens giltighet bör styrkas mot Lantmäteriets huvudregister.</p>
      </footer>
    </div>
  );
};

export default PropertyRegisterExtract;

