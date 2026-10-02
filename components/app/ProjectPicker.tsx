import React from 'react';
import type { AppBootstrapProjectSummary } from '../../src/types/app';

export interface ProjectPickerProps {
  projects: AppBootstrapProjectSummary[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
}

/**
 * PRODUCT-AUTH-USER-LOGIN-UX-01 Phase B.
 *
 * Deliberately minimal: this is a SWITCHER for which of the user's own already-existing
 * projects is "active" (used by parts of the app that still read a single activeProjectId,
 * e.g. the admin console) -- not project administration, and not a gate in front of the
 * property-first LU flow, which searches/creates its own project context independently and
 * never needs the caller to already understand an internal projectId.
 *
 * The server (GET /api/app/bootstrap) remains sole authority for which projects the user may
 * see here -- this component only ever offers exactly the `projects` array it was given.
 */
/**
 * DEMO M2b item 3: the Prisma ProjectStatus enum is never shown raw. An active project needs no
 * suffix; the other statuses are said in Swedish; an unknown value is said to be unknown.
 */
const PROJECT_STATUS_SUFFIX_SV: Readonly<Record<string, string>> = {
  ACTIVE: '',
  DRAFT: 'utkast',
  COMPLETED: 'avslutat',
  CLOSED: 'stängt',
  ARCHIVED: 'arkiverat',
};

export function projectOptionLabel(project: Pick<AppBootstrapProjectSummary, 'propertyDesignation' | 'status'>): string {
  const suffix = PROJECT_STATUS_SUFFIX_SV[project.status] ?? 'okänd status';
  return suffix ? `${project.propertyDesignation} (${suffix})` : project.propertyDesignation;
}

export const ProjectPicker: React.FC<ProjectPickerProps> = ({ projects, activeProjectId, onSelect }) => {
  if (projects.length === 0) {
    return (
      <div data-testid="project-picker-empty" className="text-xs opacity-70">
        Inga projekt ännu — börja med "Lokalisering" för att söka en fastighet och skapa en ny lokalisering.
      </div>
    );
  }

  if (projects.length === 1) {
    return null;
  }

  return (
    <label data-testid="project-picker" className="text-xs opacity-80 flex items-center gap-2">
      Projekt:
      <select
        data-testid="project-picker-select"
        value={activeProjectId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-transparent border rounded px-2 py-1 text-xs"
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {projectOptionLabel(project)}
          </option>
        ))}
      </select>
    </label>
  );
};

export default ProjectPicker;
