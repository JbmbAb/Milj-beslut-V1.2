/**
 * Legal traceability metadata for generated reports / PDF footers.
 * Operator, model, dataset versions, git commit, DB migration, correlation ID.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReportTraceabilityInput {
  operator?: string | null;
  modelId?: string | null;
  datasetVersions?: Record<string, string> | string[] | null;
  correlationId?: string | null;
  gitCommit?: string | null;
  dbMigrationVersion?: string | null;
}

export interface ReportTraceability {
  operator: string;
  modelId: string;
  datasetVersions: string;
  gitCommit: string;
  dbMigrationVersion: string;
  correlationId: string;
}

function latestMigrationDirName(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrationsRoot = path.resolve(here, '../../prisma/migrations');
    if (!fs.existsSync(migrationsRoot)) return 'unknown';
    const dirs = fs
      .readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
      .map((d) => d.name)
      .sort();
    return dirs[dirs.length - 1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatDatasetVersions(
  versions: ReportTraceabilityInput['datasetVersions'],
): string {
  if (!versions) return 'n/a';
  if (Array.isArray(versions)) {
    return versions.length ? versions.join('; ') : 'n/a';
  }
  const entries = Object.entries(versions);
  if (!entries.length) return 'n/a';
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Resolve traceability fields with env/build fallbacks. */
export function buildReportTraceability(
  input: ReportTraceabilityInput = {},
): ReportTraceability {
  return {
    operator: (input.operator || process.env.REPORT_OPERATOR || 'system').trim() || 'system',
    modelId: (input.modelId || process.env.AI_MODEL_ID || 'n/a').trim() || 'n/a',
    datasetVersions: formatDatasetVersions(input.datasetVersions),
    gitCommit: (
      input.gitCommit ||
      process.env.GIT_COMMIT ||
      process.env.COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      'unknown'
    )
      .trim()
      .slice(0, 40),
    dbMigrationVersion: (
      input.dbMigrationVersion ||
      process.env.DB_MIGRATION_VERSION ||
      latestMigrationDirName()
    ).trim(),
    correlationId: (input.correlationId || 'n/a').trim() || 'n/a',
  };
}

/** Single-line footer suitable for PDF page footers. */
export function formatTraceabilityFooter(meta: ReportTraceability): string {
  return [
    `Op: ${meta.operator}`,
    `Model: ${meta.modelId}`,
    `Data: ${meta.datasetVersions}`,
    `Git: ${meta.gitCommit}`,
    `DB: ${meta.dbMigrationVersion}`,
    `Corr: ${meta.correlationId}`,
  ].join(' | ');
}

/** PDF document info Keywords string. */
export function formatTraceabilityKeywords(meta: ReportTraceability): string {
  return formatTraceabilityFooter(meta);
}
