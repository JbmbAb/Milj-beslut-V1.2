import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * W3b -- D4 (MAP-2-SEMANTICS.md Delta 2026-09-28: "Dossier-trion ska raderas i beslutad W3-unit,
 * inte semantiskt rehabiliteras"). All three files are confirmed dead code with zero live callers
 * anywhere in the repo (see W3B-SCOPE-NOTE-2026-09-29.md §1/§3 for the independently re-verified
 * grep evidence, including the deliberate check that `server/services/vertexDirigent.ts` -- a
 * different, live, unrelated file -- is not mistaken for `services/orchestrator/vertexDirigentService.ts`).
 */
describe('W3b: the dossier trio has been deleted (D4)', () => {
  it('services/dossier/dossierBuilderService.ts no longer exists on disk', () => {
    expect(existsSync('services/dossier/dossierBuilderService.ts')).toBe(false);
  });

  it('services/orchestrator/vertexDirigentService.ts no longer exists on disk', () => {
    expect(existsSync('services/orchestrator/vertexDirigentService.ts')).toBe(false);
  });

  it('components/DossierDashboard.tsx no longer exists on disk', () => {
    expect(existsSync('components/DossierDashboard.tsx')).toBe(false);
  });

  it('the unrelated, live server/services/vertexDirigent.ts is NOT deleted by this unit', () => {
    expect(existsSync('server/services/vertexDirigent.ts')).toBe(true);
  });
});
