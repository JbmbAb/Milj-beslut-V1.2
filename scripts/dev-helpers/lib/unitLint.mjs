/**
 * DEV-HELPER (not an authority). Static lint of a DEV-GOV V1 unit definition.
 *
 * Every rule exists because the miss it prevents cost a real dispatch or review round in
 * LU-CANONICAL-RUNTIME-HARDENING-R1. Findings are advice to the author. They never replace the protected
 * controller, the trusted attest runner or the canonical gate; a clean lint proves nothing, and a
 * finding can be a false positive (use --ignore RULE_ID after reading the hint).
 */
import { matchesAny, validateUnitDefinition } from '../../devgov/devgov.mjs';
import { findRuntimeReach, loadAliases } from './importClosure.mjs';

export const SEVERITY = Object.freeze({ ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO' });

const PATH_TOKEN = /(?:\.\/)?(?:[A-Za-z0-9_@.-]+\/)+[A-Za-z0-9_.@-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|md|sql|ya?ml)\b/g;
// "prisma generate" as text, or as separate argv items: ['prisma', 'generate']
const PROVISIONS_PRISMA = /\bprisma\b[^\w]{1,6}generate\b/;
const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

/** Repo-relative path-looking tokens found anywhere in a command's arguments (inline programs included). */
export function pathTokens(spec) {
  const out = new Set();
  for (const text of [spec.command ?? '', ...(spec.args ?? [])]) {
    for (const m of String(text).matchAll(PATH_TOKEN)) {
      const token = m[0].replace(/^\.\//, '');
      if (!token.includes('node_modules')) out.add(token);
    }
  }
  return [...out];
}

const commandText = (spec) => [spec.command, ...(spec.args ?? [])].join('\n');

/**
 * Files a command will actually EXECUTE (as opposed to merely read as text).
 * For an inline program (node -e "...") that is only what it import()s/require()s, plus any path passed as
 * a trailing argument (a script it spawns). For anything else (vitest run x.test.ts, node script.mjs) every
 * path-like argument counts.
 */
export function runtimeSeeds(spec) {
  const args = spec.args ?? [];
  // bash -lc "node -e '...reads files as text...' && npx vitest run a.test.ts": the script is one opaque
  // string, so only what is clearly executed counts: test files and `tsx|node <file>` targets.
  if (['bash', 'sh', 'zsh'].includes(spec.command)) {
    const script = args.find((a) => !a.startsWith('-')) ?? '';
    const seeds = new Set();
    for (const m of script.matchAll(PATH_TOKEN)) if (/\.test\.tsx?$/.test(m[0])) seeds.add(m[0].replace(/^\.\//, ''));
    for (const m of script.matchAll(/\b(?:tsx|node)\s+((?:\.\/)?[A-Za-z0-9_@./-]+\.(?:ts|mjs|js|cjs))\b/g)) seeds.add(m[1].replace(/^\.\//, ''));
    return [...seeds];
  }
  const flagAt = args.findIndex((a) => /^-{1,2}(?:e|eval|p|print)$/.test(a));
  if (flagAt < 0) return pathTokens(spec);
  const program = String(args[flagAt + 1] ?? '');
  const extra = args.filter((_, i) => i !== flagAt && i !== flagAt + 1);
  const spawns = /\b(?:spawn|spawnSync|exec|execFile|execFileSync|fork)\s*\(/.test(program);
  const dynamic = [...program.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1].replace(/^\.\//, ''));
  return [...new Set([...dynamic, ...(spawns ? pathTokens({ command: spec.command, args: extra }) : [])])];
}
/**
 * What a finding threatens:
 *   gate            the protected pipeline would reject or block the run (controller, orchestrator, CI)
 *   proof-validity  the run would pass, but a RED/GREEN would prove less than it claims (false RED, unchecked non-claim)
 *   hygiene         portability, timeouts, conventions, information
 */
const GATE_IDS = new Set(['DGL-001', 'DGL-002', 'DGL-010', 'DGL-011', 'DGL-012', 'DGL-031', 'DGL-032', 'CTL-REPO', 'CTL-DEF', 'PRE-IGNORE', 'EXE-MISMATCH', 'EXE-ERROR']);
const VALIDITY_IDS = new Set(['DGL-003', 'DGL-020', 'DGL-021', 'DGL-022', 'DGL-040', 'DGL-050']);
export const kindOf = (id) => (GATE_IDS.has(id) ? 'gate' : VALIDITY_IDS.has(id) ? 'proof-validity' : 'hygiene');
const finding = (id, severity, where, message, hint = '') => ({ id, severity, kind: kindOf(id), where, message, hint });

/** Anything the controller must never be asked to run from a producer's unit: paths it protects. */
const PROTECTED_SAMPLES = [
  '.github/workflows/devgov-v0-attest.yml',
  'scripts/devgov/devgov.mjs',
  'governance/devgov/schema/dev-gov-v1-unit-definition.schema.json',
];

/**
 * @param {object} def   parsed unit definition
 * @param {object} ctx   { definitionPath, head, base } where head/base are readers (see importClosure.mjs);
 *                       `base` may be null when the base tree is unavailable (shallow clone).
 */
export function lintUnitDefinition(def, ctx) {
  const findings = [];
  const add = (...args) => findings.push(finding(...args));
  const reds = Array.isArray(def.required_red) ? def.required_red : [];
  const greens = Array.isArray(def.required_green) ? def.required_green : [];

  // DGL-070 -- rules that need the base tree (RED file/closure checks) cannot run without it.
  if (!ctx.base) {
    add('DGL-070', SEVERITY.INFO, 'base_sha', 'base tree is not available in this clone (shallow?); RED file-existence and import-closure checks were skipped', 'fetch the base commit and rerun');
  }

  // DGL-001 -- the controller's own structural validation, surfaced up front.
  for (const error of validateUnitDefinition(def)) {
    add('DGL-001', SEVERITY.ERROR, 'definition', `controller validation: ${error}`);
  }

  // DGL-002 -- the unit definition must be inside its own path lock.
  if (ctx.definitionPath && !matchesAny(ctx.definitionPath, def.allowed_paths ?? [])) {
    add('DGL-002', SEVERITY.ERROR, 'allowed_paths', `the unit definition itself (${ctx.definitionPath}) is not in allowed_paths`);
  }

  // DGL-003 -- non-claims should be machine-checked: controller, workflows and schema must be forbidden.
  const uncovered = PROTECTED_SAMPLES.filter((p) => !matchesAny(p, def.forbidden_paths ?? []));
  if (uncovered.length > 0) {
    add('DGL-003', SEVERITY.ERROR, 'forbidden_paths', `does not forbid: ${uncovered.join(', ')}`, 'add .github/**, scripts/devgov/** and governance/devgov/schema/**');
  }

  // DGL-004 -- an allowed_paths glob this broad makes the path lock meaningless.
  for (const pattern of def.allowed_paths ?? []) {
    const literal = pattern.split('/').filter((s) => s && !s.includes('*'));
    if (pattern.includes('*') && literal.length < 2) {
      add('DGL-004', SEVERITY.WARN, 'allowed_paths', `very broad allowed path "${pattern}"`, 'list the exact files the unit may touch');
    }
  }

  // DGL-012 -- the orchestrator throws without at least one RED and one GREEN.
  if (reds.length === 0 || greens.length === 0) {
    add('DGL-012', SEVERITY.ERROR, 'required_red/required_green', 'the trusted orchestrator requires at least one RED and one GREEN proof');
  }
  for (const [kind, list] of [['RED', reds], ['GREEN', greens]]) {
    const ids = list.map((s) => s.id);
    if (new Set(ids).size !== ids.length) add('DGL-012', SEVERITY.ERROR, kind, 'duplicate proof ids in one list');
  }

  // DGL-010 / DGL-011 -- RED runs at the frozen base and must FAIL; GREEN runs at the candidate and must PASS.
  for (const spec of reds) {
    if ((spec.required_head ?? 'base_sha') !== 'base_sha') {
      add('DGL-010', SEVERITY.ERROR, `RED ${spec.id}`, `required_head is ${spec.required_head}; RED must execute at base_sha`);
    }
    if ((spec.expected_classification ?? 'FAIL') !== 'FAIL') {
      add('DGL-010', SEVERITY.ERROR, `RED ${spec.id}`, `expected_classification is ${spec.expected_classification}; RED must expect FAIL`);
    }
  }
  for (const spec of greens) {
    if ((spec.required_head ?? 'candidate_sha') !== 'candidate_sha') {
      add('DGL-011', SEVERITY.ERROR, `GREEN ${spec.id}`, `required_head is ${spec.required_head}; GREEN must execute at candidate_sha`);
    }
    if ((spec.expected_classification ?? 'PASS') !== 'PASS') {
      add('DGL-011', SEVERITY.ERROR, `GREEN ${spec.id}`, `expected_classification is ${spec.expected_classification}; GREEN must expect PASS`);
    }
  }

  for (const [kind, list] of [['RED', reds], ['GREEN', greens]]) {
    const tree = kind === 'RED' ? ctx.base : ctx.head;
    for (const spec of list) {
      const where = `${kind} ${spec.id}`;
      const text = commandText(spec);
      const inline = (spec.args ?? []).some((a) => /^-{1,2}(?:e|eval|p|print)$/.test(a));

      // DGL-013 -- the controller default is 120 s; provisioning + tests routinely need more.
      if (!spec.timeout_ms) add('DGL-013', SEVERITY.WARN, where, 'no timeout_ms (controller default is 120000)');
      if (PROVISIONS_PRISMA.test(text) && (spec.timeout_ms ?? 0) < 300000) {
        add('DGL-013', SEVERITY.WARN, where, `timeout_ms ${spec.timeout_ms ?? 'unset'} is short for a command that runs "prisma generate"`, 'allow >= 300000 ms');
      }

      if (kind === 'RED') {
        // DGL-020 -- any non-zero exit is classified FAIL. Without a harness exit code a crash IS a valid RED.
        if ((spec.expected_classification ?? 'FAIL') === 'FAIL' && !(spec.blocked_exit_codes ?? []).length) {
          add('DGL-020', SEVERITY.ERROR, where, 'no blocked_exit_codes: a crash, missing module or syntax error would be classified FAIL and count as a valid RED', 'exit 1 = substantive violation, exit 2 = harness fault; set blocked_exit_codes: [2]');
        }
        // DGL-021 -- RED must not lean on git history.
        if (spec.command === 'git' || /\b(?:spawnSync|execFileSync|execFile|spawn)\(\s*['"]git['"]/.test(text)) {
          add('DGL-021', SEVERITY.ERROR, where, 'the RED command runs git; RED must falsify a property of the base tree without using git history');
        }
        // DGL-022 -- a path that does not exist on base gives a missing-file "RED".
        if (tree) {
          const absenceIsProperty = /ENOENT/.test(text);
          const missing = pathTokens(spec).filter((t) => !tree.exists(t) && ctx.head.exists(t));
          if (missing.length > 0) {
            const shown = missing.slice(0, 4).join(', ') + (missing.length > 4 ? `, +${missing.length - 4} more` : '');
            add('DGL-022', absenceIsProperty ? SEVERITY.INFO : SEVERITY.WARN, where,
              `${missing.length} path(s) exist at the candidate but not at base_sha: ${shown}${absenceIsProperty ? ' (the program handles ENOENT explicitly, so absence may be the property under test)' : ''}`,
              absenceIsProperty ? '' : 'if the RED fails because such a file is missing, it is a "file not found" RED, not a semantic one; ignore only if absence of that artefact IS the property under test');
          }
        }
      }

      // DGL-030 -- the controller spawns without a shell.
      if (['npx', 'npm', 'pnpm', 'yarn'].includes(spec.command)) {
        add('DGL-030', SEVERITY.WARN, where, `"${spec.command}" cannot be spawned without a shell on Windows (ENOENT -> BLOCKED_ENVIRONMENT locally); it works on the Linux runner`, 'wrap in a node program if you need a local dry run');
      }

      // DGL-031 -- trusted attest installs with --ignore-scripts: no generated Prisma client.
      // Evidence: a natively executed node/tsx program that loads server/db/prisma.ts dies at link time
      // (SyntaxError: no export named 'Prisma'). vitest-run tests that reach it have passed trusted runs
      // before (AUTHORITY-CHAIN-PROMOTION-01), so that case is only a WARN.
      if (tree && !PROVISIONS_PRISMA.test(text)) {
        // A test that vi.mock()s/jest.mock()s the Prisma module never loads the real one.
        const mocksPrisma = (t) => /\b(?:vi|jest)\.mock\(\s*['"][^'"]*db\/prisma(?:\.\w+)?['"]/.test(tree.read(t) ?? '');
        const seeds = runtimeSeeds(spec).filter((t) => SOURCE_EXT.test(t) && tree.exists(t) && !mocksPrisma(t));
        const aliases = loadAliases(tree);
        const targets = { fileTargets: /(^|\/)server\/db\/prisma\.(?:ts|js|mjs)$/, bareTargets: /^@prisma\/client(?:\/|$)/ };
        const underVitest = (t) => /\.test\.tsx?$/.test(t) && /vitest/.test(text);
        let native = null;
        let tolerated = null;
        for (const seed of seeds) {
          const reach = findRuntimeReach({ seeds: [seed], reader: tree, aliases, ...targets });
          if (!reach) continue;
          if (underVitest(seed) || reach.kind === 'bare') tolerated ??= reach;
          else native ??= reach;
        }
        if (native) {
          add('DGL-031', SEVERITY.ERROR, where,
            `loads ${native.hit} (${native.chain.join(' -> ')}); the trusted attest workflow runs "npm ci --ignore-scripts", so the Prisma client is never generated and a natively executed import fails (observed: exit 2 / BLOCKED_ENVIRONMENT)`,
            'provision it inside the command ("npx prisma generate" with a dummy DATABASE_URL) or avoid importing that module');
        } else if (tolerated) {
          add('DGL-031', SEVERITY.WARN, where,
            `reaches ${tolerated.hit} (${tolerated.chain.join(' -> ')}); the trusted environment has no generated Prisma client. vitest-run tests that reach it have passed trusted runs before, so this is unverified rather than known-fatal`,
            'provision "prisma generate" inside the command if in doubt');
        } else {
          // DGL-032 -- a seed that STARTS a script (spawn/exec) has no import edge to it. Narrow heuristic:
          // scripts/ paths named in the seed's own text. Reading such a path as text is a false positive.
          for (const seed of seeds) {
            const referenced = [...(tree.read(seed) ?? '').matchAll(PATH_TOKEN)]
              .map((m) => m[0].replace(/^\.\//, ''))
              .filter((q) => q.startsWith('scripts/') && SOURCE_EXT.test(q) && q !== seed && tree.exists(q));
            const viaScript = referenced.length
              ? findRuntimeReach({ seeds: [...new Set(referenced)], reader: tree, aliases, fileTargets: targets.fileTargets })
              : null;
            if (viaScript) {
              add('DGL-032', SEVERITY.WARN, where,
                `${seed} names ${viaScript.chain[0]}, which loads ${viaScript.hit} (${viaScript.chain.join(' -> ')}); if the test executes that script it will be blocked in the trusted environment (no generated Prisma client)`,
                'provision "prisma generate" inside the command, or ignore DGL-032 if the path is only read as text');
              break;
            }
          }
        }
      }

      // DGL-040 -- process.exit() skips `finally`; temp sandboxes leak exactly on the violation (= RED) path.
      if (inline && /mkdtemp/.test(text) && /process\.exit\(/.test(text) && /\bfinally\b/.test(text)
        && !/\bclean(?:up)?\w*\(\)\s*;\s*[\w.]+\(/.test(text)) {
        add('DGL-040', SEVERITY.WARN, where, 'process.exit() inside try skips the finally block: the mkdtemp sandbox leaks on the violation path', 'clean up before calling process.exit');
      }
    }
  }

  // DGL-050 -- packaging convention: a CANDIDATE audit record next to the definition.
  const record = (def.allowed_paths ?? []).find((p) => /^docs\/architecture\/audits\/[^*]+\.md$/.test(p));
  if (!record) {
    add('DGL-050', SEVERITY.WARN, 'allowed_paths', 'no docs/architecture/audits/*.md audit record among allowed_paths');
  } else if (ctx.head.exists(record)) {
    const text = ctx.head.read(record) ?? '';
    const provenDoc = /PROVEN-DOC/.test(def.unit ?? '');
    if (!provenDoc && /\*\*Final state:\*\*\s*PROVEN/.test(text)) {
      add('DGL-050', SEVERITY.ERROR, record, 'a packaging unit must not carry a PROVEN record; that is a separate, later unit');
    }
    if (!provenDoc && !/non-claims/i.test(text)) add('DGL-050', SEVERITY.WARN, record, 'audit record has no "Non-claims" section');
    if (def.base_sha && !text.includes(def.base_sha)) add('DGL-050', SEVERITY.WARN, record, 'audit record does not name the frozen base_sha');
  } else {
    add('DGL-050', SEVERITY.INFO, record, 'audit record is not present in the checked tree yet');
  }

  // DGL-060 -- plan size, so the reviewer knows how many jobs and approvals to expect.
  add('DGL-060', SEVERITY.INFO, 'plan', `${reds.length} RED + ${greens.length} GREEN proof(s) => ${reds.length + greens.length} execute job(s) and as many sign jobs`);

  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
