// @vitest-environment node
/**
 * W-CATCH2 (D) -- INVENTORY against relapse (owner decisions 2026-10-02/03, OD-R2: a read error is never
 * "missing"; a corrupt or unreadable existing object is never minted over or skipped).
 *
 * Scans every catch block and `.catch(...)` handler in the LU localization core (server/modules/
 * localization*), the capability/provisioning services (server/services/*capability*, *provisioning*),
 * src/application/resolveCanonicalProjectContext.ts and the other places of the catch-all ledger (the LU
 * routes, the property lookup, the bootstrap worker). EVERY handler must
 *  - use the shared read-fault classification (readFaultClassification.ts and what it reuses), or
 *  - propagate the failure (rethrow, `next(e)`, `cause: e`, `e` into an error constructor), or
 *  - carry a reviewed marker `CATCH-REVIEWED: <KIND>: <reason>` in the code, or
 *  - be on the reviewed list (readFaultCatchInventory.reviewed.ts) by file and body fingerprint.
 * A NEW unmarked catch fails this test (canary below, on a COPY of the scope in a temp directory), and a
 * changed reviewed handler fails it until it is reviewed again.
 *
 * Pure: reads source files as text. No product module is imported, no network, no database.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catchesOfSource, isAccepted, scanCatches, scopeFiles, fingerprint, CLASSIFIERS } from './readFaultCatchInventory.scan.mjs';
import { READ_FAULT_CATCH_KINDS, READ_FAULT_CATCH_REVIEWED, type ReadFaultCatchKind } from './readFaultCatchInventory.reviewed';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KINDS = new Set(Object.keys(READ_FAULT_CATCH_KINDS));

type Entry = ReturnType<typeof scanCatches>[number];

/** Everything wrong with the inventory of `root` (empty = the inventory holds). */
function inventoryProblems(root: string): string[] {
  const all: Entry[] = scanCatches(root);
  const problems: string[] = [];
  for (const entry of all) {
    if (entry.marker !== null && !KINDS.has(entry.marker)) problems.push(`${entry.file}:${entry.line}: marker kind ${entry.marker} is not a reviewed kind`);
  }
  const unaccepted = all.filter((entry) => !isAccepted(entry));
  const counts = new Map<string, Entry[]>();
  for (const entry of unaccepted) {
    const key = `${entry.file}|${entry.fingerprint}`;
    counts.set(key, [...(counts.get(key) ?? []), entry]);
  }
  const reviewed = new Map(READ_FAULT_CATCH_REVIEWED.map((r) => [`${r.file}|${r.fingerprint}`, r]));
  for (const [key, entries] of counts) {
    const review = reviewed.get(key);
    if (!review) {
      for (const e of entries) {
        problems.push(
          `${e.file}:${e.line}: a ${e.kind === 'promise' ? '.catch(...)' : 'catch'} that neither classifies (readFaultClassification.ts), propagates, nor is marked ` +
            `"CATCH-REVIEWED: <KIND>: <reason>" or reviewed (fingerprint ${e.fingerprint}): ${e.body.replace(/\s+/g, ' ').trim().slice(0, 120)}`,
        );
      }
    } else if (review.count !== entries.length) {
      problems.push(`${key}: reviewed for ${review.count} handler(s), found ${entries.length} (lines ${entries.map((e) => e.line).join(', ')})`);
    }
  }
  for (const [key, review] of reviewed) {
    if (!counts.has(key)) problems.push(`${key}: stale reviewed entry (${review.kind}) -- the handler changed or is gone; review it again`);
  }
  return problems;
}

describe('W-CATCH2 (D): the read-fault catch inventory', () => {
  it('the scope and the scanner are real: the files of the catch-all ledger are scanned and the known handlers found', () => {
    const files = scopeFiles(ROOT);
    for (const known of [
      'server/modules/localization/localizationGeometryService.ts',
      'server/modules/localization/luViewerCapabilityProvisioning.ts',
      'server/modules/localization/luGeometrySupersessionProvisioning.ts',
      'server/modules/localization/luExecutionIdentityV3Provisioning.ts',
      'server/modules/localization/createLocalizationViewerRuntime.ts',
      'server/modules/localization/luProjectContextBootstrap.ts',
      'server/modules/localization/projectContextBindingRuntime.ts',
      'server/modules/localization/productViewerCapabilityAuthority.ts',
      'server/modules/localization/assessmentProjection.ts',
      'server/services/luViewerCapabilityProvisioningWorker.ts',
      'src/application/resolveCanonicalProjectContext.ts',
      'server/routes/localization.routes.ts',
      'server/services/propertyUnitService.ts',
      'server/services/luProjectContextBootstrapWorker.ts',
    ]) {
      expect(files, known).toContain(known);
    }
    const all = scanCatches(ROOT);
    expect(all.length).toBeGreaterThan(80);
    expect(all.filter((e) => e.classified).length).toBeGreaterThan(25);
    // Each acceptance route is exercised by the real code.
    expect(all.some((e) => e.propagates && !e.classified)).toBe(true);
    expect(all.some((e) => e.marker !== null)).toBe(true);
  });

  it('EVERY handler in scope is classified, propagates, is marked with a reviewed kind, or is on the reviewed list -- and no reviewed entry is stale', () => {
    expect(inventoryProblems(ROOT)).toEqual([]);
  });

  it('the reviewed list is justified: a known kind, a real note, OPEN_NOT_FIXED names its class and lane', () => {
    for (const review of READ_FAULT_CATCH_REVIEWED) {
      expect(KINDS.has(review.kind), `${review.file} ${review.fingerprint}`).toBe(true);
      expect(review.note.length, `${review.file} ${review.fingerprint}`).toBeGreaterThan(30);
      expect(review.count).toBeGreaterThan(0);
      if (review.kind === 'OPEN_NOT_FIXED') expect(review.note, `${review.file} ${review.fingerprint}`).toMatch(/^OPEN \(.+lane/);
    }
    for (const [kind, meaning] of Object.entries(READ_FAULT_CATCH_KINDS) as [ReadFaultCatchKind, string][]) {
      expect(meaning.length, kind).toBeGreaterThan(40);
    }
  });
});

describe('W-CATCH2 (D): canaries -- a new unmarked catch FAILS the inventory (on a copy of the scope)', () => {
  const READ_THEN_SWALLOW = `
export async function canaryRead(repo: { resolve(r: unknown): Promise<unknown> }) {
  try {
    return await repo.resolve({ artifact_id: 'x', artifact_type: 'y' });
  } catch {
    return null; // not minted yet
  }
}
`;

  function withCopy(mutate: (copyRoot: string) => void): string[] {
    const copy = mkdtempSync(path.join(tmpdir(), 'wcatch2-catch-inventory-'));
    try {
      for (const rel of scopeFiles(ROOT)) {
        mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
        cpSync(path.join(ROOT, rel), path.join(copy, rel));
      }
      mutate(copy);
      return inventoryProblems(copy);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }

  it('control: the unchanged copy holds', () => {
    expect(withCopy(() => undefined)).toEqual([]);
  });

  it('a new catch that swallows a CAS read as "not minted yet" -> the inventory FAILS and names it', () => {
    const target = 'server/modules/localization/luViewerCapabilityProvisioning.ts';
    const problems = withCopy((copy) => writeFileSync(path.join(copy, target), readFileSync(path.join(copy, target), 'utf8') + READ_THEN_SWALLOW));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/luViewerCapabilityProvisioning\.ts:\d+: a catch that neither classifies/);
  });

  it('a new `.catch(() => null)` in a new file of the scope -> FAILS', () => {
    const problems = withCopy((copy) =>
      writeFileSync(path.join(copy, 'server/modules/localization/canaryNewModule.ts'), `export const read = (p: Promise<unknown>) => p.catch(() => null);\n`),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/canaryNewModule\.ts:1: a \.catch\(\.\.\.\) that neither classifies/);
  });

  it('a changed reviewed handler (another lane edits it) -> FAILS until it is reviewed again', () => {
    const target = 'server/modules/localization/localizationGeometryCurrentProvider.ts';
    const problems = withCopy((copy) => {
      const src = readFileSync(path.join(copy, target), 'utf8');
      writeFileSync(path.join(copy, target), src.replace('return excluded("INVALID_CONTENT");', 'return null as never;'));
    });
    expect(problems.some((p) => p.includes('stale reviewed entry'))).toBe(true);
    expect(problems.some((p) => p.includes('localizationGeometryCurrentProvider.ts:') && p.includes('neither classifies'))).toBe(true);
  });

  it('the same new catch is ACCEPTED when it classifies, propagates or is marked with a reviewed kind -- and REJECTED with an unknown kind', () => {
    const classify = READ_THEN_SWALLOW.replace('} catch {\n    return null; // not minted yet', '} catch (error) {\n    throw toReadFaultError(\'canary\', error);');
    const propagate = READ_THEN_SWALLOW.replace('} catch {\n    return null; // not minted yet', '} catch (error) {\n    throw new Error(\'REJECT_CANARY\', { cause: error });');
    const marked = READ_THEN_SWALLOW.replace('return null; // not minted yet', '// CATCH-REVIEWED: ABSENCE_ONLY: canary\n    return null;');
    const wrongKind = READ_THEN_SWALLOW.replace('return null; // not minted yet', '// CATCH-REVIEWED: WHATEVER: canary\n    return null;');
    for (const [name, source, accepted] of [
      ['classify', classify, true],
      ['propagate', propagate, true],
      ['marked', marked, true],
      ['unmarked', READ_THEN_SWALLOW, false],
    ] as const) {
      const [entry] = catchesOfSource('canary.ts', source);
      expect(isAccepted(entry!), name).toBe(accepted);
    }
    const target = 'server/modules/localization/luViewerCapabilityProvisioning.ts';
    const problems = withCopy((copy) => writeFileSync(path.join(copy, target), readFileSync(path.join(copy, target), 'utf8') + wrongKind));
    expect(problems).toEqual([expect.stringMatching(/marker kind WHATEVER is not a reviewed kind/)]);
  });

  it('W-U20CDF5: re-introducing one of the orchestrator patterns that were OPEN_NOT_FIXED (an unclassified catch answering 403) -> FAILS and is named', () => {
    const target = 'server/modules/localization/localizationOrchestrator.ts';
    const relapse = `
export async function canaryAccess(check: () => Promise<void>) {
  try {
    await check();
  } catch {
    return { ok: false, status: 403, error: 'Not authorized for this project.' };
  }
  return null;
}
`;
    const problems = withCopy((copy) => writeFileSync(path.join(copy, target), readFileSync(path.join(copy, target), 'utf8') + relapse));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/localizationOrchestrator\.ts:\d+: a catch that neither classifies/);
  });

  it('W-U20CDF5 (group B): no OPEN_NOT_FIXED entry is left for the orchestrator -- the five are fixed, not re-listed', () => {
    expect(READ_FAULT_CATCH_REVIEWED.filter((r) => r.file.endsWith('localizationOrchestrator.ts') && r.kind === 'OPEN_NOT_FIXED')).toEqual([]);
  });

  it('the scanner is not fooled by braces, quotes or the word catch inside strings and comments', () => {
    const tricky = [
      "const s = '} catch { return null }';",
      '// } catch { return null; }',
      'const t = `${"}"} catch {`;',
      'try { await f(); } catch (e) { throw e; }',
    ].join('\n');
    const entries = catchesOfSource('tricky.ts', tricky);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.propagates).toBe(true);
    expect(fingerprint('  a \n b ')).toBe(fingerprint('a b'));
    expect(CLASSIFIERS).toContain('classifyReadFault');
  });
});
