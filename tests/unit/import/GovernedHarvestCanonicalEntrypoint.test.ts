import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { PRODUCTION_ADAPTER_RESOLVERS } from '../../../packages/mps-data-governance/src/HarvestRuntimeCompositionRoot';
import {
  SOURCE_DISPOSITIONS,
  checkDispositionCoverage,
  type DispositionCheckableSource,
} from '../../../packages/mps-data-governance/src/HarvestSourceDispositionMatrix';

/**
 * GOVERNED-HARVEST-CANONICAL-ENTRYPOINT (K1).
 *
 * Falsifiable claim under test: "Exactly one supported operational entrypoint exists for
 * governed harvesting, and importing legacy harvest modules cannot start harvesting."
 *
 * Pre-fix state (documented in full, with file:line evidence, in
 * docs/architecture/KNOWLEDGE-INGESTION-REACHABILITY-AUDIT-2026-09-05.md):
 *   - package.json's "harvest:governed" alias pointed at
 *     packages/mps-data-governance/scripts/run-governed-harvest.mjs, a file that does not exist.
 *   - scripts/import/harvest/harvestScheduler.ts self-executed runScheduler() on mere module
 *     import whenever process.env.NODE_ENV !== 'test' (LOKE_SCHEDULER_IMPORT_SIDE_EFFECT / SR2),
 *     and that scheduler calls scripts/import/harvest/harvestRuntime.ts's executeHarvestForSource,
 *     whose adapter factory does not recognize any of the 13 currently APPROVED sources' actual
 *     adapter names.
 *   - no explicit, checked disposition existed per currently-approved source_id.
 *
 * This test suite could not be executed in the authoring environment (no node_modules installed
 * in this worktree — `npx vitest run` fails with ERR_MODULE_NOT_FOUND). It is handed off
 * unexecuted for independent verification, per this session's charter: implementation must not
 * self-verify its own final candidate. Run `npm ci && npx vitest run tests/unit/import/GovernedHarvestCanonicalEntrypoint.test.ts`
 * to confirm.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('GOVERNED-HARVEST-CANONICAL-ENTRYPOINT — K1', () => {
  describe('1. canonical npm entrypoint', () => {
    it('harvest:governed resolves to a file that actually exists', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
      const script: string | undefined = pkg.scripts?.['harvest:governed'];
      expect(script, 'package.json must define a "harvest:governed" script').toBeTruthy();

      // Extract the referenced source file (the token ending in .ts/.mjs/.js) from the script
      // command, independent of which runner (tsx/node/etc.) invokes it.
      const match = script!.match(/([\w./-]+\.(?:ts|mjs|js))/);
      expect(match, `could not find a script-file token in "harvest:governed": ${script}`).toBeTruthy();

      const referenced = match![1];
      expect(
        referenced,
        'the alias must not still point at the historically-missing run-governed-harvest.mjs',
      ).not.toMatch(/run-governed-harvest\.mjs$/);

      const resolved = path.join(REPO_ROOT, referenced);
      expect(
        fs.existsSync(resolved),
        `"harvest:governed" references ${referenced}, which does not exist at ${resolved}`,
      ).toBe(true);
    });

    it('harvest-live-pilot.ts is the file the alias points at, and it composes the governed runtime', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
      const script: string = pkg.scripts?.['harvest:governed'] ?? '';
      expect(script).toMatch(/harvest-live-pilot\.ts/);

      const pilotSource = fs.readFileSync(
        path.join(REPO_ROOT, 'packages/mps-data-governance/scripts/harvest-live-pilot.ts'),
        'utf8',
      );
      expect(pilotSource).toMatch(/composeHarvestRuntime/);
    });
  });

  describe('2. legacy scheduler cannot self-start', () => {
    const SCHEDULER_PATH = '../../../scripts/import/harvest/harvestScheduler';
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      vi.resetModules();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      vi.restoreAllMocks();
      vi.resetModules();
    });

    it('the historical self-executing import block is gone (structural check)', () => {
      const source = fs.readFileSync(
        path.join(REPO_ROOT, 'scripts/import/harvest/harvestScheduler.ts'),
        'utf8',
      );
      // The exact historical shape: `typeof process !== 'undefined'` is a distinctive fingerprint
      // of the removed self-exec guard (it does not appear anywhere in this file's doc comments,
      // which describe the same history in prose) immediately gated with a NODE_ENV check, ahead
      // of a runScheduler({ execute call at module top level.
      const historicalSelfExecPattern =
        /typeof process !== ['"]undefined['"][\s\S]{0,200}NODE_ENV\s*!==\s*['"]test['"][\s\S]{0,200}runScheduler\s*\(\s*\{\s*execute/;
      expect(
        historicalSelfExecPattern.test(source),
        'harvestScheduler.ts must not call runScheduler() from a top-level NODE_ENV-gated block',
      ).toBe(false);
    });

    it('importing the module under a non-test NODE_ENV touches neither the registry nor harvest execution', async () => {
      process.env.NODE_ENV = 'production';

      vi.doMock('../../../packages/mps-data-governance/src/SourceRegistry', () => ({
        getAllVerifiedSources: vi.fn(() => {
          throw new Error(
            'FAIL: getAllVerifiedSources() must not be called merely by importing harvestScheduler.ts',
          );
        }),
      }));
      vi.doMock('../../../scripts/import/harvest/harvestRuntime', () => ({
        executeHarvestForSource: vi.fn(() => {
          throw new Error(
            'FAIL: executeHarvestForSource() must not be called merely by importing harvestScheduler.ts',
          );
        }),
      }));

      // Importing must resolve cleanly with no side effect — if the legacy self-exec block were
      // still present, the mocked getAllVerifiedSources above would throw inside an unawaited
      // top-level promise chain rather than failing this assertion directly, which is exactly
      // the kind of "fire and forget" activation this unit closes.
      await expect(import(SCHEDULER_PATH)).resolves.toBeDefined();

      const registryMod: any = await import('../../../packages/mps-data-governance/src/SourceRegistry');
      expect(registryMod.getAllVerifiedSources).not.toHaveBeenCalled();

      const runtimeMod: any = await import('../../../scripts/import/harvest/harvestRuntime');
      expect(runtimeMod.executeHarvestForSource).not.toHaveBeenCalled();
    });
  });

  describe('3. approved-source adapter contract (current registry execution matrix)', () => {
    /**
     * Raw JSON read, deliberately not the cryptographically-verified loader: this check's job is
     * disposition-coverage completeness for the source_ids currently on file, not re-proving
     * registry authority (already covered by tests/unit/import/SR1SourceRegistryAuthorityEnforcement.test.ts).
     * Verifying the real file would additionally require production signing key material that is
     * not present in this repo/worktree.
     */
    function readCurrentApprovedSources(): DispositionCheckableSource[] {
      const raw = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'source-registry/national-registry.json'), 'utf8'),
      );
      expect(Array.isArray(raw), 'national-registry.json must be a JSON array').toBe(true);
      return raw
        .filter((entry: any) => entry.lifecycle_state === 'APPROVED')
        .map((entry: any) => ({
          sourceId: entry.source_id,
          adapter: entry.adapter,
          channelType: entry.channel?.channel_type,
        }));
    }

    it('the registry read reaches real sources, so an empty result cannot pass vacuously', () => {
      const sources = readCurrentApprovedSources();
      expect(sources.length).toBeGreaterThan(0);
    });

    it('every currently APPROVED source resolves to exactly one disposition', () => {
      const sources = readCurrentApprovedSources();
      const result = checkDispositionCoverage(sources, PRODUCTION_ADAPTER_RESOLVERS);

      expect(
        result.uncovered,
        'every APPROVED source_id in national-registry.json must have an entry in ' +
          'SOURCE_DISPOSITIONS (packages/mps-data-governance/src/HarvestSourceDispositionMatrix.ts) ' +
          '— a newly-approved source with no assigned disposition is exactly the gap this unit closes',
      ).toEqual([]);

      expect(
        result.misclassifiedArchiveImport,
        'ARCHIVE_IMPORT sources must be INTENTIONALLY_ROUTED_ELSEWHERE, and only ARCHIVE_IMPORT ' +
          'sources may carry that disposition',
      ).toEqual([]);

      expect(
        result.misclassifiedNetworkAdapterMissing,
        'EXECUTABLE_BY_GOVERNED_RUNTIME / FAIL_CLOSED sources must have their adapter registered ' +
          'in PRODUCTION_ADAPTER_RESOLVERS — this is the actual dispatch table the governed ' +
          'runtime uses, not an aspirational list',
      ).toEqual([]);
    });

    it('SOURCE_DISPOSITIONS carries no entry for a source_id absent from the current registry', () => {
      // Catches drift the other direction: a disposition left behind after a source was
      // withdrawn/superseded, which would otherwise silently stop meaning anything.
      const currentIds = new Set(readCurrentApprovedSources().map((s) => s.sourceId));
      const stale = Object.keys(SOURCE_DISPOSITIONS).filter((id) => !currentIds.has(id));
      expect(stale, 'stale disposition entries for source_ids no longer APPROVED').toEqual([]);
    });

    it('the disposition tally matches the last reviewed split, so drift is visible rather than silent', () => {
      // This is a coverage-contract check, not runtime enforcement: it does not stop the
      // governed runtime from doing anything, it only fails loudly the next time someone edits
      // SOURCE_DISPOSITIONS without updating this expectation, which is exactly what let the
      // 2026-08-20 FAIL_CLOSED classification for boverket-planbestammelser go stale for two
      // weeks after its 2026-08-25 endpoint fix (commit b13f45a9) without anyone noticing.
      const sources = readCurrentApprovedSources();
      const tally: Record<string, number> = {
        EXECUTABLE_BY_GOVERNED_RUNTIME: 0,
        INTENTIONALLY_ROUTED_ELSEWHERE: 0,
        FAIL_CLOSED: 0,
      };
      for (const source of sources) {
        const entry = SOURCE_DISPOSITIONS[source.sourceId];
        if (entry) tally[entry.disposition] = (tally[entry.disposition] ?? 0) + 1;
      }

      expect(tally, 'disposition tally as of 2026-09-05 review').toEqual({
        EXECUTABLE_BY_GOVERNED_RUNTIME: 12,
        INTENTIONALLY_ROUTED_ELSEWHERE: 1,
        FAIL_CLOSED: 0,
      });
    });
  });
});
