import React, { useMemo } from 'react';

export interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

export interface PropertyLookupResult {
  designation?: string | null;
  requestedDesignation?: string | null;
  normalizedDesignation?: string | null;
  source?: string | null;
  geometryStatus?: string | null;
  fetchedAt?: string | null;
  geometry?: GeoJsonGeometry | null;
  boundaries?: unknown;
  ownership?: unknown;
  _demo?: boolean;
  [key: string]: unknown;
}

type DetailRow = {
  label: string;
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function prettifyLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\./g, ' / ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '-';
    }
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return value.join(', ');
    }
    return JSON.stringify(value);
  }

  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function flattenDetails(value: Record<string, unknown>, prefix = '', depth = 0, maxDepth = 2): DetailRow[] {
  return Object.entries(value).flatMap(([key, childValue]) => {
    const nextLabel = prefix ? `${prefix}.${key}` : key;

    if (isRecord(childValue) && depth < maxDepth) {
      return flattenDetails(childValue, nextLabel, depth + 1, maxDepth);
    }

    return [{ label: prettifyLabel(nextLabel), value: formatValue(childValue) }];
  });
}

function FieldGrid({ title, rows }: { title: string; rows: DetailRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <div
            key={`${title}-${row.label}`}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.label}</p>
            <p className="mt-1 break-words text-sm font-medium text-slate-700">{row.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const PropertyLookupDetails: React.FC<{
  result: PropertyLookupResult;
  requestedDesignation?: string;
  compact?: boolean;
}> = ({ result, requestedDesignation = '', compact = false }) => {
  const requested = String(result.requestedDesignation ?? requestedDesignation).trim();
  const designation = String(result.designation ?? requestedDesignation).trim() || '-';
  const geometryType = String(result.geometry?.type ?? 'Ingen geometri');
  const geometryStatus = String(result.geometryStatus ?? (result.geometry ? 'present' : 'missing'));
  const source = result._demo
    ? 'Ej verifierad'
    : String(result.source ?? 'live').toLowerCase() === 'live'
      ? 'Live'
      : formatValue(result.source);
  const fetchedAt = formatValue(result.fetchedAt);

  const boundaryRows = useMemo(() => {
    if (!isRecord(result.boundaries)) {
      return [];
    }

    const properties = isRecord(result.boundaries.properties)
      ? result.boundaries.properties
      : result.boundaries;

    return flattenDetails(properties).filter((row) => row.label.toLowerCase() !== 'geometry');
  }, [result.boundaries]);

  const ownershipRows = useMemo(() => {
    if (!isRecord(result.ownership)) {
      return [];
    }

    return flattenDetails(result.ownership);
  }, [result.ownership]);

  const extraTopLevelRows = useMemo(() => {
    const entries = Object.entries(result).filter(
      ([key, value]) =>
        ![
          'designation',
          'requestedDesignation',
          'normalizedDesignation',
          'source',
          'geometryStatus',
          'fetchedAt',
          'geometry',
          'boundaries',
          'ownership',
          '_demo',
        ].includes(key) && value !== undefined,
    );

    return entries.map(([key, value]) => ({
      label: prettifyLabel(key),
      value: formatValue(value),
    }));
  }, [result]);

  const rawJson = useMemo(() => JSON.stringify(result, null, 2), [result]);

  return (
    <div
      className={`space-y-5 ${compact ? '' : 'rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm'}`}
    >
      <section className="grid gap-3 md:grid-cols-5">
        {requested && requested !== designation && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sökt som</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{requested}</p>
          </div>
        )}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">LM-beteckning</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{designation}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Geometri</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {geometryType} ({geometryStatus})
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Källa</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{source}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Hämtad</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{fetchedAt}</p>
        </div>
      </section>

      <FieldGrid title="LM-fält" rows={extraTopLevelRows} />
      <FieldGrid title="Fastighetsdata" rows={boundaryRows} />
      <FieldGrid title="Ägaruppgifter" rows={ownershipRows} />

      <section className="space-y-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Råsvaret</h3>
        <details className="rounded-2xl border border-slate-200 bg-slate-950/95 p-4 text-slate-100">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-widest text-slate-200">
            Visa hela LM-svaret
          </summary>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">
            {rawJson}
          </pre>
        </details>
      </section>
    </div>
  );
};

export default PropertyLookupDetails;
