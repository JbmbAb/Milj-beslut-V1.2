import React from 'react';
import type { MpfGeofenceLayerRequirement } from '../../../../types';

interface MpfGeofenceOverlayProps {
  layers: MpfGeofenceLayerRequirement[];
  isSensitiveArea?: boolean;
}

const MpfGeofenceOverlay: React.FC<MpfGeofenceOverlayProps> = ({ layers, isSensitiveArea = false }) => {
  if (layers.length === 0 && !isSensitiveArea) {
    return null;
  }

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-4 space-y-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">MPF geofence</p>
        <p className="text-sm text-indigo-950">
          Kartlager som krävs för screening enligt vald kodprofil. Ersätter inte juridisk granskning.
        </p>
      </div>

      {isSensitiveArea && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Platsen bedöms som känslig — MPF-trösklar kan vara skärpta.
        </p>
      )}

      {layers.length > 0 && (
        <ul className="space-y-2">
          {layers.map((layer) => (
            <li
              key={layer.key}
              className="rounded border border-indigo-100 bg-white px-3 py-2 text-xs text-slate-700"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-indigo-900">{layer.label}</span>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black uppercase text-indigo-700">
                  {layer.severity}
                </span>
              </div>
              <p className="mt-1 text-slate-600">{layer.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MpfGeofenceOverlay;
