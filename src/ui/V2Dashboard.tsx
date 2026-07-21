import React from 'react';
import { Project } from '../domain/project';
import { AuditEvent } from '../domain/audit';
import { HealthStatus } from '../platform/health.service';

interface V2DashboardProps {
  projects: Project[];
  auditLogs: AuditEvent[];
  health: HealthStatus;
}

export function V2Dashboard({ projects, auditLogs, health }: V2DashboardProps) {
  return (
    <div className="p-8 max-w-6xl mx-auto font-sans bg-gray-50 min-h-screen">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Plattform V2: Mission Control</h1>
          <p className="text-gray-600 mt-2">Juridisk hållbarhet & Operativ kontroll</p>
        </div>
        <div
          className={`px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 ${
            health.status === 'UP' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-full ${health.status === 'UP' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}
          ></span>
          System Status: {health.status}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* VÄNSTER: PROJEKTLISTA */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 border-b pb-2 flex items-center gap-2">
              📂 Aktiva Projekt
            </h2>
            {projects.length === 0 ? (
              <p className="text-gray-400 italic py-4">Inga projekt hittades.</p>
            ) : (
              <div className="space-y-4">
                {projects.map((p) => (
                  <div key={p.id} className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg">
                    <div className="flex justify-between">
                      <h3 className="font-bold text-blue-900">{p.name}</h3>
                      <span className="text-xs bg-white px-2 py-1 rounded shadow-sm font-mono">
                        {p.id.substring(0, 8)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{p.description}</p>
                    <div className="mt-3 flex gap-2">
                      <span className="text-[10px] uppercase tracking-wider bg-white px-2 py-0.5 rounded border">
                        {p.type}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider bg-white px-2 py-0.5 rounded border">
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* HÖGER: HEALTH & AUDIT */}
        <div className="space-y-6">
          {/* SYSTEM HÄLSA */}
          <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
            <h2 className="text-lg font-semibold mb-4 text-gray-800 border-b pb-2 flex items-center gap-2">
              ⚡ Komponenthälsa
            </h2>
            <div className="space-y-3">
              {Object.entries(health.components).map(([name, status]) => (
                <div key={name} className="flex justify-between items-center text-sm">
                  <span className="capitalize text-gray-600">{name.replace(/([A-Z])/g, ' $1')}</span>
                  <span
                    className={`font-mono font-bold ${status.status === 'UP' ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {status.status} {status.latencyMs ? `(${status.latencyMs}ms)` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* AUDIT TRAIL */}
          <div className="bg-gray-900 shadow-xl rounded-lg p-6 text-gray-100 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2 flex items-center gap-2 text-blue-400">
              📜 Senaste Audit-händelser
            </h2>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {auditLogs.map((log) => (
                <div key={log.id} className="text-xs border-b border-gray-800 pb-3 last:border-0">
                  <div className="flex justify-between text-gray-500 mb-1">
                    <span className="font-mono text-blue-300">{log.action}</span>
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-gray-300">
                    <span className="text-gray-500">[{log.entityType}]</span> {log.details}
                  </div>
                  <div className="mt-1 text-gray-600 italic">Användare: {log.userId}</div>
                </div>
              ))}
              {auditLogs.length === 0 && <p className="text-gray-600 italic">Inga loggar tillgängliga.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
