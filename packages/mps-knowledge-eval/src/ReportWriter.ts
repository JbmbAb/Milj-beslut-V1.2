import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { EvalReport } from './Harness';

/**
 * Writes the machine-readable report to `dir`. Deterministic file name from the report's own
 * identities (no timestamps), so two identical evaluations write the same file. The caller decides
 * where `dir` is; repository convention does not commit transient eval output.
 */
export function writeEvalReport(report: EvalReport, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${report.eval_version}-${report.config.mode}-${report.index_snapshot_identity.slice(0, 16)}-${report.report_hash.slice(0, 16)}.json`,
  );
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}
