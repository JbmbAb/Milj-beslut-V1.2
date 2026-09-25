import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';

const REGISTRY_REL = 'governance/devgov/invariant-packs/registry-v1.json';

const REQUIRED_V1_INVARIANT_IDS = Object.freeze([
  'DG-IP-001-PROTECTED-CONTROLLER-SEPARATION',
  'DG-IP-002-SIGNER-ISOLATION',
  'DG-IP-003-EXACT-CANDIDATE-BINDING',
  'DG-IP-004-VERIFIER-OWNED-TRUST',
  'DG-IP-005-PACKS-LOAD-BEARING',
  'DG-IP-006-ALL-PACKS-NO-CANDIDATE-SELECTION',
  'DG-IP-007-PR-PROTECTED-BASE',
  'DG-IP-008-POST-MERGE-ACTIVATION',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitSha(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function readText(root, rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

function readJson(root, rel) {
  return JSON.parse(readText(root, rel));
}

function hasAll(source, needles) {
  const missing = needles.filter((needle) => !source.includes(needle));
  return {
    pass: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(' | ')}` : 'all required bindings present',
  };
}

function hasNone(source, needles) {
  const present = needles.filter((needle) => source.includes(needle));
  return {
    pass: present.length === 0,
    detail: present.length ? `forbidden: ${present.join(' | ')}` : 'no forbidden bindings present',
  };
}

function combine(...results) {
  const failed = results.filter((item) => !item.pass);
  return failed.length
    ? { pass: false, detail: failed.map((item) => item.detail).join('; ') }
    : { pass: true, detail: results.map((item) => item.detail).join('; ') };
}

function block(source, start, end) {
  const a = source.indexOf(start);
  if (a < 0) return '';
  const b = end ? source.indexOf(end, a + start.length) : -1;
  return b < 0 ? source.slice(a) : source.slice(a, b);
}

// F-10 fix: strip only genuine line comments (# starting a line, or preceded by whitespace) so a
// decoy comment cannot satisfy a hasAll() needle check. Bash `${#var}` length-expansion (# preceded
// by `{`) and any other non-comment `#` usage is left untouched.
function stripLineComments(source) {
  return source.replace(/(^|[ \t])#.*$/gm, '$1');
}

// F-10 fix: a `node` invocation whose target script is a shell variable, quoted variable, or
// command substitution (rather than a literal path) is exactly the exploited pattern
// (`node "$SIGNER_SCRIPT" attest-execution`). Verified not to match legitimate literal invocations
// (`node controller/scripts/devgov/devgov.mjs ...`, `node -e "..."`) nor incidental substrings
// (`node-version:`, `actions/setup-node@v4`, `node_modules`).
function noDynamicNodeInvocation(source) {
  const pass = !/\bnode\s+["'`]*[$`]/.test(source);
  return {
    pass,
    detail: pass ? 'no dynamic node invocation target' : 'dynamic node invocation target detected',
  };
}

// DG-IP-006 self-check note (anti-self-bootstrap): the checks below must never inspect the
// literal text of THIS switch-case (evaluateInvariant), because that text is itself part of
// `source` when `source` is the runner's own file content. A needle quoted inside this function
// body would always self-match regardless of what the real (non-self-check) code does, making the
// check tautological. `stripInvariantEvaluatorBody` excises this function's own source before the
// DG-IP-006 checks run, so they only ever see the REAL controllerRoot resolution / CLI parsing,
// never their own quoted copy of the needle they search for.
function stripInvariantEvaluatorBody(source) {
  // Both markers are anchored on a preceding real newline so this only ever matches the actual
  // function declarations at column 0, never a quoted copy of the marker text appearing elsewhere
  // in this file (such as this helper's own marker string literals, which contain the escaped
  // two-character sequence "\n" rather than a literal newline byte).
  const startMarker = '\nfunction evaluateInvariant(';
  const endMarker = '\nfunction loadRegistry(controllerRoot) {';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('unable to isolate evaluateInvariant body for DG-IP-006 self-check (fail-closed)');
  }
  return source.slice(0, start) + source.slice(end);
}

function evaluateInvariant(id, targetRoot) {
  const attest = () => readText(targetRoot, '.github/workflows/devgov-v0-attest.yml');
  const gate = () => readText(targetRoot, '.github/workflows/devgov-v0-gate.yml');
  const orchestrator = () => readText(targetRoot, '.github/workflows/devgov-v0-orchestrate.yml');
  const prPacks = () => readText(targetRoot, '.github/workflows/devgov-invariant-packs.yml');
  const controller = () => readText(targetRoot, 'scripts/devgov/devgov.mjs');
  const runner = () => readText(targetRoot, 'scripts/devgov/invariant-packs.mjs');

  switch (id) {
    case 'DG-IP-001-PROTECTED-CONTROLLER-SEPARATION': {
      const source = attest();
      const execute = stripLineComments(block(source, '  execute:', '\n  attest:'));
      const signing = stripLineComments(block(source, '  attest:', null));
      const checkoutBindings = [
        'ref: ${{ github.sha }}',
        'path: controller',
        'ref: ${{ inputs.candidate_sha }}',
        'path: candidate',
      ];
      const forbidden = ['node candidate/scripts/devgov/', 'node execution/scripts/devgov/'];
      return combine(
        hasAll(execute, [
          ...checkoutBindings,
          'node controller/scripts/devgov/devgov.mjs resolve-execution-sha',
          'node controller/scripts/devgov/devgov.mjs execute-proof',
        ]),
        hasAll(signing, [...checkoutBindings, 'node controller/scripts/devgov/devgov.mjs attest-execution']),
        hasNone(execute, forbidden),
        hasNone(signing, forbidden),
        noDynamicNodeInvocation(execute),
        noDynamicNodeInvocation(signing),
      );
    }
    case 'DG-IP-002-SIGNER-ISOLATION': {
      const source = attest();
      const execute = block(source, '  execute:', '\n  attest:');
      const signing = block(source, '  attest:', null);
      return combine(
        hasNone(execute, ['environment: devgov-attestation', 'DEVGOV_ATTESTATION_PRIVATE_KEY_PEM']),
        hasAll(signing, [
          '\n    environment: devgov-attestation\n',
          'DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: ${{ secrets.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM }}',
        ]),
      );
    }
    case 'DG-IP-003-EXACT-CANDIDATE-BINDING': {
      return combine(
        hasAll(orchestrator(), [
          'ref: ${{ inputs.candidate_sha }}',
          'test "$(git -C candidate rev-parse HEAD)" = "$CANDIDATE_SHA"',
        ]),
        hasAll(attest(), [
          'ref: ${{ inputs.candidate_sha }}',
          'test "$(git -C candidate rev-parse HEAD)" = "$EXPECTED_SHA"',
        ]),
        hasAll(gate(), [
          'ref: ${{ inputs.candidate_sha }}',
          'test "$(git -C candidate rev-parse HEAD)" = "$CANDIDATE_SHA"',
        ]),
      );
    }
    case 'DG-IP-004-VERIFIER-OWNED-TRUST': {
      return combine(
        hasAll(gate(), [
          'DEVGOV_VERIFIER_TRUST_POLICY_JSON',
          'secrets.DEVGOV_VERIFIER_TRUST_POLICY_JSON',
          'audience="devgov-v0-gate:$policy_sha:$CANDIDATE_SHA"',
          "context='DEV-GOV-V0 / trusted-execution'",
        ]),
        hasNone(gate(), ['--trust-policy']),
        hasAll(controller(), [
          'TRUST_POLICY_SUBSTITUTION_DENIED',
          'ARBITRARY_EVIDENCE_PATH_DENIED',
          'target_sha is forbidden in a unit definition',
        ]),
      );
    }
    case 'DG-IP-005-PACKS-LOAD-BEARING': {
      const orch = orchestrator();
      const g = gate();
      const pr = prPacks();
      return combine(
        hasAll(orch, [
          '  invariant-packs:',
          'node controller/scripts/devgov/invariant-packs.mjs',
          '--target candidate',
          '      - invariant-packs',
        ]),
        hasAll(g, [
          'Verify controller-owned invariant packs',
          'node controller/scripts/devgov/invariant-packs.mjs',
          '--target candidate',
        ]),
        hasAll(pr, ['node controller/scripts/devgov/invariant-packs.mjs', '--target candidate']),
        {
          pass:
            g.indexOf('Verify controller-owned invariant packs') <
            g.indexOf('Obtain protected gate identity'),
          detail: 'gate invariant packs execute before protected gate identity',
        },
      );
    }
    case 'DG-IP-006-ALL-PACKS-NO-CANDIDATE-SELECTION': {
      const source = runner();
      // Anti-self-bootstrap: strip this function's own quoted copies of the needles below before
      // searching, otherwise every check here would tautologically self-match against its own
      // literal text and never actually inspect the real controllerRoot/CLI code. See
      // docs/architecture/audits/DEVGOV-INVARIANT-PACKS-V1.md "Bootstrap rule".
      const realSource = stripInvariantEvaluatorBody(source);
      const reg = readJson(targetRoot, REGISTRY_REL);
      const validRegistry =
        reg?.schema_version === 'dev-gov-invariant-pack-registry-v1' &&
        Number.isInteger(reg.registry_version) &&
        reg.registry_version >= 1 &&
        Array.isArray(reg.active_packs) &&
        reg.active_packs.length > 0 &&
        reg.active_packs.every(
          (value) => typeof value === 'string' && value.startsWith('governance/devgov/invariant-packs/'),
        );
      return combine(
        {
          pass: validRegistry,
          detail: validRegistry
            ? 'target registry has a non-empty controller pack set'
            : 'target registry shape/pack set invalid',
        },
        hasAll(realSource, [
          'const controllerRoot = realpathSync(',
          "options.controllerRoot || resolve(dirname(fileURLToPath(import.meta.url)), '../..')",
          'loadRegistry(controllerRoot)',
          'loadPack(controllerRoot, packPath)',
        ]),
        {
          pass:
            JSON.stringify(
              Array.from(realSource.matchAll(/arg === '(--[^']+)'/g), (match) => match[1]).sort(),
            ) === JSON.stringify(['--candidate-sha', '--output', '--target']),
          detail: 'CLI exposes only target, candidate-sha and output; no caller-selectable pack',
        },
        // Defense in depth: idiom-agnostic denylist. No matter how a future parseArgs recognizes a
        // flag (===, switch, Set lookup, .startsWith, ...), a caller-usable authority-override flag
        // must contain one of these literal strings somewhere in the real (non-self-check) code to
        // function at all, so their absence is provable independent of comparison idiom.
        hasNone(realSource, [
          '--pack',
          '--registry',
          '--trust-policy',
          '--skip',
          '--exempt',
          '--impact',
          '--non-impacting',
        ]),
        hasNone(orchestrator(), ['--pack ']),
        hasNone(gate(), ['--pack ']),
        hasNone(prPacks(), ['--pack ']),
      );
    }
    case 'DG-IP-007-PR-PROTECTED-BASE': {
      const source = prPacks();
      return combine(
        hasAll(source, [
          'pull_request_target:',
          'ref: ${{ github.event.pull_request.base.sha }}',
          'path: controller',
          'ref: ${{ github.event.pull_request.head.sha }}',
          'path: candidate',
          'persist-credentials: false',
          'test "$(git -C controller rev-parse HEAD)" = "$BASE_SHA"',
          'test "$(git -C candidate rev-parse HEAD)" = "$CANDIDATE_SHA"',
        ]),
        hasNone(source, [
          '\n    paths:',
          '\n      paths:',
          'node candidate/',
          'npm --prefix candidate',
          'npm ci --prefix candidate',
        ]),
      );
    }
    case 'DG-IP-008-POST-MERGE-ACTIVATION': {
      const source = runner();
      return combine(
        hasAll(source, [
          'controller_sha:',
          'candidate_sha:',
          'registry_version:',
          'pack_set_sha256:',
          'effective_controller_root:',
          'loadRegistry(controllerRoot)',
        ]),
        hasAll(orchestrator(), ['ref: ${{ github.sha }}', 'path: controller']),
        hasAll(gate(), ['ref: ${{ github.sha }}', 'path: controller']),
        hasAll(prPacks(), ['ref: ${{ github.event.pull_request.base.sha }}', 'path: controller']),
      );
    }
    default:
      throw new Error(`unknown controller-owned invariant id: ${id}`);
  }
}

function loadRegistry(controllerRoot) {
  const raw = readText(controllerRoot, REGISTRY_REL);
  const value = JSON.parse(raw);
  if (value?.schema_version !== 'dev-gov-invariant-pack-registry-v1')
    throw new Error('unsupported invariant-pack registry schema');
  if (!Number.isInteger(value.registry_version) || value.registry_version < 1)
    throw new Error('invalid invariant-pack registry_version');
  if (!Array.isArray(value.active_packs) || value.active_packs.length === 0)
    throw new Error('active_packs must be non-empty');
  return { value, raw };
}

function loadPack(controllerRoot, packPath) {
  const raw = readText(controllerRoot, packPath);
  const value = JSON.parse(raw);
  if (value?.schema_version !== 'dev-gov-invariant-pack-v1')
    throw new Error(`unsupported invariant pack schema: ${packPath}`);
  if (!Array.isArray(value.invariants) || value.invariants.length === 0)
    throw new Error(`empty invariant pack: ${packPath}`);
  return { path: packPath, value, raw };
}

export function evaluateInvariantPacks(options = {}) {
  const controllerRoot = realpathSync(
    options.controllerRoot || resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  );
  const targetRoot = realpathSync(options.targetRoot || process.cwd());
  const controllerSha = options.controllerSha || gitSha(controllerRoot);
  const candidateSha = options.candidateSha || gitSha(targetRoot);
  const registry = loadRegistry(controllerRoot);
  const packs = registry.value.active_packs.map((packPath) => loadPack(controllerRoot, packPath));
  const ids = [];
  for (const pack of packs) {
    for (const id of pack.value.invariants) {
      if (ids.includes(id)) throw new Error(`duplicate invariant id across active packs: ${id}`);
      ids.push(id);
    }
  }
  const results = ids.map((id) => {
    try {
      const outcome = evaluateInvariant(id, targetRoot);
      return { id, result: outcome.pass ? 'PASS' : 'FAIL', detail: outcome.detail };
    } catch (error) {
      return { id, result: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
    }
  });
  const missingCanonicalIds = REQUIRED_V1_INVARIANT_IDS.filter((id) => !ids.includes(id));
  results.push({
    id: 'DG-IP-000-CANONICAL-SET-COMPLETE',
    result: missingCanonicalIds.length === 0 ? 'PASS' : 'FAIL',
    detail:
      missingCanonicalIds.length === 0
        ? 'active pack set is a superset of the canonical V1 invariant IDs'
        : `missing canonical V1 invariant ids: ${missingCanonicalIds.join(' | ')}`,
  });

  const packDigests = packs.map((pack) => ({
    path: pack.path,
    sha256: sha256(pack.raw),
    pack_id: pack.value.pack_id,
    pack_version: pack.value.pack_version,
  }));
  const packSetSha256 = sha256(JSON.stringify({ registry_sha256: sha256(registry.raw), packs: packDigests }));
  const failed = results.filter((item) => item.result !== 'PASS');
  return {
    schema_version: 'dev-gov-invariant-pack-report-v1',
    result: failed.length === 0 ? 'PASS' : 'FAIL',
    controller_sha: controllerSha,
    candidate_sha: candidateSha,
    registry_version: registry.value.registry_version,
    pack_set_sha256: packSetSha256,
    effective_controller_root: controllerRoot,
    target_root: targetRoot,
    active_packs: packDigests,
    invariants: results,
    failed_invariants: failed.map((item) => item.id),
  };
}

function parseArgs(argv) {
  const options = { target: process.cwd(), candidateSha: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') options.target = argv[++i];
    else if (arg === '--candidate-sha') options.candidateSha = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else throw new Error(`unknown invariant-pack argument: ${arg}`);
  }
  if (!options.target) throw new Error('--target requires a value');
  if (options.candidateSha && !/^[0-9a-f]{40}$/.test(options.candidateSha))
    throw new Error('--candidate-sha must be 40 lowercase hex');
  return options;
}

const invokedAsScript =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const targetRoot = realpathSync(resolve(options.target));
    const observed = gitSha(targetRoot);
    if (options.candidateSha && observed !== options.candidateSha)
      throw new Error(`candidate SHA mismatch: expected ${options.candidateSha}, observed ${observed}`);
    const report = evaluateInvariantPacks({ targetRoot, candidateSha: observed });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) writeFileSync(resolve(options.output), serialized);
    process.stdout.write(serialized);
    process.exitCode = report.result === 'PASS' ? 0 : 1;
  } catch (error) {
    const failure = {
      schema_version: 'dev-gov-invariant-pack-report-v1',
      result: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
    };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 2;
  }
}
