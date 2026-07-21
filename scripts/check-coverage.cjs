/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, console */

const fs = require('fs');
const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const targets = [
  'massOrchestrator',
  'sewageRegulationsService',
  'localizationPdfService',
  'sewageApplicationService',
  'auditTrailService',
  'applicationOrchestrator',
  'localizationOrchestrator',
  'localizationReportService',
  'municipalitySubmissionService',
];
for (const [file, data] of Object.entries(cov)) {
  const match = targets.some((t) => file.includes(t));
  if (!match) continue;
  const s = data.s,
    b = data.b,
    f = data.f;
  const stmts = Object.values(s);
  const stmtPct = stmts.length ? Math.round((100 * stmts.filter((v) => v > 0).length) / stmts.length) : 100;
  const branchPairs = Object.values(b);
  const allB = branchPairs.flat();
  const branchPct = allB.length ? Math.round((100 * allB.filter((v) => v > 0).length) / allB.length) : 100;
  const funcs = Object.values(f);
  const funcPct = funcs.length ? Math.round((100 * funcs.filter((v) => v > 0).length) / funcs.length) : 100;
  const name = file.split(/[\\/]/).slice(-2).join('/');
  console.log(
    name.padEnd(55),
    'S:' + String(stmtPct).padStart(3) + '%',
    'B:' + String(branchPct).padStart(3) + '%',
    'F:' + String(funcPct).padStart(3) + '%',
  );
}
