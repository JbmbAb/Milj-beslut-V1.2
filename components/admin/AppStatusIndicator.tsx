import React from 'react';
import type { AppStatusResponse } from '../../types';

interface AppStatusIndicatorProps {
  appStatus: AppStatusResponse | null;
  hasActiveSession: boolean;
}

const AppStatusIndicator: React.FC<AppStatusIndicatorProps> = ({ appStatus, hasActiveSession }) => {
  if (!hasActiveSession) return null;

  return (
    <div
      data-testid="app-status-bar"
      className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 text-xs font-semibold transition-colors ${
        !appStatus
          ? 'border-slate-200 bg-slate-50 text-slate-500'
          : appStatus.overall === 'ok'
          ? 'border-green-200 bg-green-50 text-green-800'
          : appStatus.overall === 'degraded'
          ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
          : 'border-red-200 bg-red-50 text-red-800'
      }`}
    >
      {/* Pulsindikator */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
            !appStatus
              ? 'bg-slate-300'
              : appStatus.overall === 'ok'
              ? 'animate-ping bg-green-500'
              : appStatus.overall === 'degraded'
              ? 'animate-ping bg-yellow-500'
              : 'bg-red-500'
          }`}
        />
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            !appStatus
              ? 'bg-slate-300'
              : appStatus.overall === 'ok'
              ? 'bg-green-500'
              : appStatus.overall === 'degraded'
              ? 'bg-yellow-500'
              : 'bg-red-500'
          }`}
        />
      </span>

      {/* Status-text */}
      <span className="font-black">
        {!appStatus
          ? 'Kontrollerar appstatus…'
          : appStatus.overall === 'ok'
          ? 'Appen är igång'
          : appStatus.overall === 'degraded'
          ? 'Appen är igång (degraderad)'
          : 'Appen har fel'}
      </span>

      {/* Divider */}
      {appStatus && (
        <span className="hidden text-slate-300 md:inline">|</span>
      )}

      {/* DB-status */}
      {appStatus && (
        <span>
          DB:{' '}
          <span className={appStatus.db.status === 'ok' ? 'text-green-700' : 'text-red-700'}>
            {appStatus.db.status === 'ok' ? '✓' : '✗'}{' '}
            {appStatus.db.latencyMs !== null ? `${appStatus.db.latencyMs} ms` : '–'}
          </span>
        </span>
      )}

      {/* Datasources */}
      {appStatus && (
        <span className="hidden md:inline">
          Datakällor: {appStatus.datasources.connected}/{appStatus.datasources.total}
          {appStatus.datasources.errors > 0 && (
            <span className="ml-1 text-red-600">({appStatus.datasources.errors} fel)</span>
          )}
        </span>
      )}

      {/* Uptime */}
      {appStatus && (
        <span className="hidden lg:inline">
          Uptime: {Math.floor(appStatus.app.uptimeSeconds / 3600)}h {Math.floor((appStatus.app.uptimeSeconds % 3600) / 60)}m
        </span>
      )}

      {/* Version */}
      {appStatus && (
        <span className="hidden xl:inline text-slate-400">
          v{appStatus.app.version} · {appStatus.app.environment}
        </span>
      )}

      {/* Timestamp */}
      {appStatus && (
        <span className="ml-auto hidden text-slate-400 sm:inline">
          {new Date(appStatus.checkedAt).toLocaleTimeString('sv-SE')}
        </span>
      )}
    </div>
  );
};

export default AppStatusIndicator;
