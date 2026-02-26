export interface ProjectRetentionRecord {
  id: string;
  status: "ACTIVE" | "CLOSED" | "ARCHIVED";
  closedAt: Date | null;
  retentionUntil: Date | null;
}

export function retentionDateFromClose(closedAt: Date, legalRetentionDays: number): Date {
  return new Date(closedAt.getTime() + legalRetentionDays * 24 * 60 * 60 * 1000);
}

export function findProjectsReadyForDeletion(
  projects: ProjectRetentionRecord[],
  now: Date = new Date(),
): ProjectRetentionRecord[] {
  return projects.filter((project) => {
    if (project.status === "ACTIVE") {
      return false;
    }
    if (!project.retentionUntil) {
      return false;
    }
    return project.retentionUntil.getTime() <= now.getTime();
  });
}
