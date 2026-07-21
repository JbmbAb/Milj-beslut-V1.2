/* eslint-disable react-refresh/only-export-components */

import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { platformV2 } from '../../src/api/platform.master';
import type { AuditEvent } from '../../src/domain/audit';
import type { Project } from '../../src/domain/project';
import type { HealthStatus } from '../../src/platform/health.service';
import { V2Dashboard } from '../../src/ui/V2Dashboard';

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    // Vi hämtar all data parallellt för maximal prestanda i V2
    const [projects, health, auditLogs] = await Promise.all([
      platformV2.projects.getAllByOrganisation(),
      platformV2.health.check(),
      platformV2.audit.findLatest(20), // Hämtar de 20 senaste händelserna för kontrollrummet
    ]);

    return json({ projects, health, auditLogs });
  } catch (error: any) {
    console.error('V2 Dashboard Loader Error:', error);
    // Vi returnerar ett felobjekt men försöker fortfarande leverera tomma listor
    return json({
      projects: [],
      health: { status: 'DOWN', components: {} } as any,
      auditLogs: [],
      error: error.message,
    });
  }
}

export default function V2DashboardRoute() {
  const data = useLoaderData<typeof loader>();
  const error = 'error' in data ? data.error : undefined;
  const projects: Project[] = data.projects.map((project: any) => ({
    ...project,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
  }));
  const auditLogs: AuditEvent[] = data.auditLogs.map((auditLog: any) => ({
    ...auditLog,
    timestamp: new Date(auditLog.timestamp),
  }));
  const health = data.health as HealthStatus;

  return (
    <div>
      {error && (
        <div className="bg-red-500 text-white p-2 text-xs text-center">
          Varning: Vissa komponenter kunde inte laddas: {error}
        </div>
      )}
      <V2Dashboard projects={projects} health={health} auditLogs={auditLogs} />
    </div>
  );
}
