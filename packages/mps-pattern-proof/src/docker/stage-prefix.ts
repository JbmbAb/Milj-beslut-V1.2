/**
 * PATTERN-PROOF-ENGINE-01 V1 -- stage-prefix derivation (BOOTSTRAP design section 5.4, plan T9).
 *
 * Solution-neutral by construction: everything below is derived from the CANDIDATE Dockerfile text.
 * The prefix of a target stage is every instruction of every ancestor stage (root base first) plus
 * the target stage's own instructions up to and including its INSTALL step -- the RUN whose shell
 * text (split on `&&`, `||`, `|` and `;`, the same separators as lifecycle-scripts.ts) contains a
 * PROJECT install command: `npm ci` / `npm install` / `npm i` followed only by flags (no positional
 * package specs, no global install: `-g`, `--global`, `--global=true`, `-g=true`,
 * `--location=global`, a combined short-flag group containing `g` such as `-gf`, or a leading
 * `NPM_CONFIG_GLOBAL=true` / `npm_config_global=true` assignment), so `npm cache ...`,
 * `npm run ...` and `npm install -g npm@10` never qualify (R1 F3, R2 F8, R3 F5). Exactly one such
 * RUN may exist in the target stage; two or more fail closed with PPE_INSTALL_STEP_NOT_FOUND
 * "ambiguous install step" (BLOCKED at the CLI). A candidate that adds `--ignore-scripts`, copies
 * `scripts/` before the RUN, or removes the lifecycle hook is reflected in the derived state, never
 * re-asserted from a base snapshot.
 *
 * Documented FAIL-CLOSED rejections of the install predicate (R2 F8, R3 F5; deliberately NOT
 * widened): a value-taking flag whose value is a separate token (`npm ci --loglevel verbose`), npm
 * options placed BEFORE the subcommand (`npm --loglevel=verbose ci`, `npm --prefix=/app ci`), a
 * shell redirection (`npm ci 2>&1`, `npm ci > log`), an inline `#` comment (`npm ci # prod`) and
 * the `npm clean-install` / `npm install-clean` aliases are not recognised as a project install. A
 * target stage whose only install is written that way has no derivable install step:
 * PPE_INSTALL_STEP_NOT_FOUND, reported BLOCKED at the CLI -- never PASS, never a guessed prefix.
 *
 * Documented limits: `$VAR` substitution is not performed (ENV/ARG values are recorded as declared);
 * `COPY --from=<stage>` instructions are kept verbatim in the prefix but excluded from the build
 * context (their sources are not context files); if such an instruction references a stage outside
 * the lineage, a docker probe fails before the install step and classifies BLOCKED (never PASS).
 * The host executor refuses (BLOCKED HOST_FIDELITY_UNSUPPORTED) a prefix with any `COPY --from`, an
 * install RUN carrying any RUN flag (`--mount`, `--network`, `--security`, ...; R3 F1) or an
 * install command carrying an unexpanded `$` (R1 F8); it applies `args` as environment defaults.
 * A RUN flag on the install RUN is admitted by the predicate (the flag is not part of the shell
 * text) and rendered verbatim into the derived Dockerfile for the docker executor.
 */
import path from 'node:path';
import { PatternProofError } from '../errors';
import { isCombinedShortGlobalFlag, trimTrailingSlashes } from '../internal/linear-text';
import {
  execFormTokens,
  findStage,
  instructionShellText,
  splitDockerfileWords,
  type ParsedDockerfile,
  type ParsedInstruction,
  type ParsedStage,
} from './dockerfile-parse';
import { splitShellCommands } from './lifecycle-scripts';

/** Coarse pre-filter of install RUNs; the project-install predicate below decides. */
export const DEFAULT_INSTALL_PATTERN = /\bnpm\s+(ci|install|i)\b/;

const INSTALL_SUBCOMMANDS: ReadonlySet<string> = new Set(['ci', 'install', 'i']);
const GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  '-g',
  '--global',
  '--global=true',
  '-g=true',
  '--location=global',
]);
/** A leading `NPM_CONFIG_GLOBAL=true` / `npm_config_global=true` assignment: a global install (R3 F5). */
const GLOBAL_ENV_ASSIGNMENT_RE = /^npm_config_global=true$/i;

function isGlobalInstallFlag(token: string): boolean {
  // a combined short-flag group containing `g` (`-gf`, `-fg`) is a global install (R2 F8)
  return GLOBAL_FLAGS.has(token) || isCombinedShortGlobalFlag(token);
}

/**
 * True when one shell command (already split on `&&` / `||` / `|` / `;`) is a PROJECT install:
 * leading `KEY=value` assignments skipped (none of them `NPM_CONFIG_GLOBAL=true`, R3 F5),
 * `npm (ci|install|i)` followed only by `-`-prefixed flags, none of them a global-install flag
 * (`-g`, `--global`, `--global=true`, `-g=true`, `--location=global`, `-gf`). An unexpanded
 * `$VAR` / `${VAR}` token is admitted as a flag position (docker expands it; the host executor
 * refuses the prefix as HOST_FIDELITY_UNSUPPORTED, R1 F8). Anything else after the subcommand (a
 * positional spec, a separate flag value, a redirection, a `#` comment) and any npm option placed
 * before the subcommand fail closed: see the module header.
 */
export function isProjectInstallCommand(command: string): boolean {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  let k = 0;
  while (k < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[k])) {
    if (GLOBAL_ENV_ASSIGNMENT_RE.test(tokens[k])) return false;
    k += 1;
  }
  if (tokens[k] !== 'npm' || !INSTALL_SUBCOMMANDS.has(tokens[k + 1] ?? '')) return false;
  const rest = tokens.slice(k + 2);
  return rest.every(
    (token) => (token.startsWith('-') && !isGlobalInstallFlag(token)) || token.startsWith('$'),
  );
}

/**
 * True when the RUN shell text contains a project install command among its commands, split on
 * `&&`, `||`, `|` and `;` (`splitShellCommands`, shared with lifecycle-scripts.ts; R2 F8).
 */
export function isProjectInstallShellText(shellText: string): boolean {
  return splitShellCommands(shellText).some((command) => isProjectInstallCommand(command));
}

/** One plain COPY/ADD instruction of the prefix (no `--from`), with its in-image destination. */
export interface StageContextCopy {
  readonly line: number;
  readonly keyword: 'COPY' | 'ADD';
  readonly sources: readonly string[];
  /** destination as written */
  readonly dest: string;
  /** destination resolved against the WORKDIR in effect at that instruction (absolute in-image path) */
  readonly resolvedDest: string;
}

export interface StagePrefix {
  readonly stageName: string;
  /** stage names, root base first, target last */
  readonly lineage: readonly string[];
  /** every instruction of every ancestor stage, then the target stage up to and including the install RUN */
  readonly instructions: readonly ParsedInstruction[];
  /** plain COPY/ADD sources (no `--from`), ordered, de-duplicated */
  readonly contextSources: readonly string[];
  /** the plain COPY/ADD instructions with destinations (host executor layout) */
  readonly contextCopies: readonly StageContextCopy[];
  /** shell text of the install RUN */
  readonly installCommand: string;
  /** the install RUN instruction itself (exec-form header matching at docker fidelity, R1 F7) */
  readonly installInstruction: ParsedInstruction;
  /** 1-based line of the install RUN in the candidate Dockerfile */
  readonly installLine: number;
  /** last WORKDIR seen in the prefix (default '/') */
  readonly workdir: string;
  readonly env: Readonly<Record<string, string>>;
  /** ARG declarations with their defaults ('' when none) */
  readonly args: Readonly<Record<string, string>>;
  /** the root stage's FROM image */
  readonly baseImage: string;
}

export interface DeriveStagePrefixOptions {
  /** overrides the project-install predicate with a plain regex on the RUN shell text (tests) */
  readonly installPattern?: RegExp;
}

function keyValuePairs(args: string): Record<string, string> {
  const words = splitDockerfileWords(args);
  const out: Record<string, string> = {};
  if (words.length === 0) return out;
  if (!words[0].includes('=')) {
    // legacy `ENV KEY value with spaces` form
    out[words[0]] = args.replace(/^\S+\s*/, '').trim();
    return out;
  }
  for (const word of words) {
    const eq = word.indexOf('=');
    if (eq <= 0) continue;
    out[word.slice(0, eq)] = word.slice(eq + 1);
  }
  return out;
}

function copyOperands(instruction: ParsedInstruction): { sources: string[]; dest: string } | null {
  const tokens = execFormTokens(instruction.args) ?? splitDockerfileWords(instruction.args);
  if (tokens.length < 2) return null;
  return { sources: tokens.slice(0, -1).map(String), dest: String(tokens[tokens.length - 1]) };
}

function lineageOf(parsed: ParsedDockerfile, target: ParsedStage): ParsedStage[] {
  const chain: ParsedStage[] = [target];
  const seen = new Set<string>([target.name]);
  let current = target;
  while (current.from.parentStage !== undefined) {
    const parent = findStage(parsed, current.from.parentStage);
    if (parent === undefined || seen.has(parent.name)) break;
    chain.unshift(parent);
    seen.add(parent.name);
    current = parent;
  }
  return chain;
}

/**
 * Derives the stage prefix of `stageName` from a parsed candidate Dockerfile.
 * Throws PPE_STAGE_NOT_FOUND when the stage does not exist and PPE_INSTALL_STEP_NOT_FOUND when the
 * target stage has no project-install RUN, or more than one ("ambiguous install step").
 */
export function deriveStagePrefix(
  parsed: ParsedDockerfile,
  stageName: string,
  opts: DeriveStagePrefixOptions = {},
): StagePrefix {
  const pattern = opts.installPattern;
  const qualifies = (instruction: ParsedInstruction): boolean => {
    if (instruction.keyword !== 'RUN') return false;
    const shellText = instructionShellText(instruction);
    return pattern === undefined ? isProjectInstallShellText(shellText) : pattern.test(shellText);
  };
  const target = findStage(parsed, stageName);
  if (target === undefined) {
    throw new PatternProofError('PPE_STAGE_NOT_FOUND', `stage "${stageName}" not found in Dockerfile`, {
      details: { stages: parsed.stages.map((stage) => stage.name) },
    });
  }
  const chain = lineageOf(parsed, target);
  const candidates = target.instructions.filter(qualifies);
  if (candidates.length === 0) {
    throw new PatternProofError(
      'PPE_INSTALL_STEP_NOT_FOUND',
      `stage "${target.name}" has no RUN with a project install command${
        pattern === undefined ? '' : ` (pattern ${pattern.source})`
      }`,
      { details: { stage: target.name } },
    );
  }
  if (candidates.length > 1) {
    throw new PatternProofError(
      'PPE_INSTALL_STEP_NOT_FOUND',
      `ambiguous install step: stage "${target.name}" has ${candidates.length} project-install RUNs at lines ${candidates
        .map((instruction) => instruction.line)
        .join(', ')}`,
      { details: { stage: target.name, lines: candidates.map((instruction) => instruction.line) } },
    );
  }
  const installInstruction = candidates[0];

  const instructions: ParsedInstruction[] = [];
  for (const stage of chain) {
    if (stage === target) {
      for (const instruction of stage.instructions) {
        instructions.push(instruction);
        if (instruction === installInstruction) break;
      }
    } else {
      instructions.push(...stage.instructions);
    }
  }

  const env: Record<string, string> = {};
  const args: Record<string, string> = {};
  for (const instruction of parsed.preamble) {
    if (instruction.keyword === 'ARG') Object.assign(args, argDeclaration(instruction.args));
  }
  let workdir = '/';
  const contextSources: string[] = [];
  const contextCopies: StageContextCopy[] = [];
  for (const instruction of instructions) {
    switch (instruction.keyword) {
      case 'ENV':
        Object.assign(env, keyValuePairs(instruction.args));
        break;
      case 'ARG':
        Object.assign(args, argDeclaration(instruction.args));
        break;
      case 'WORKDIR': {
        const value = splitDockerfileWords(instruction.args)[0] ?? '';
        if (value.length > 0)
          workdir = path.posix.isAbsolute(value) ? value : path.posix.join(workdir, value);
        break;
      }
      case 'COPY':
      case 'ADD': {
        if (instruction.flags.from !== undefined) break;
        const operands = copyOperands(instruction);
        if (operands === null) break;
        for (const source of operands.sources) {
          if (!contextSources.includes(source)) contextSources.push(source);
        }
        contextCopies.push(
          Object.freeze({
            line: instruction.line,
            keyword: instruction.keyword,
            sources: Object.freeze([...operands.sources]),
            dest: operands.dest,
            resolvedDest: stripTrailingSlash(
              path.posix.isAbsolute(operands.dest)
                ? path.posix.normalize(operands.dest)
                : path.posix.join(workdir, operands.dest),
            ),
          }),
        );
        break;
      }
      default:
        break;
    }
  }

  return Object.freeze({
    stageName: target.name,
    lineage: Object.freeze(chain.map((stage) => stage.name)),
    instructions: Object.freeze(instructions),
    contextSources: Object.freeze(contextSources),
    contextCopies: Object.freeze(contextCopies),
    installCommand: instructionShellText(installInstruction),
    installInstruction,
    installLine: installInstruction.line,
    workdir,
    env: Object.freeze(env),
    args: Object.freeze(args),
    baseImage: chain[0].from.image,
  });
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 ? trimTrailingSlashes(value) : value;
}

function argDeclaration(args: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of splitDockerfileWords(args)) {
    const eq = word.indexOf('=');
    if (eq === -1) out[word] = '';
    else if (eq > 0) out[word.slice(0, eq)] = word.slice(eq + 1);
  }
  return out;
}

/** In-image path of the CA bundle when the prelude is rendered. */
export const CA_PRELUDE_IMAGE_PATH = '/ppe-ca-bundle.crt';

/**
 * The environment prelude (grounding report section 4): declared probe input, never part of the
 * target stage. It never changes npm flags or the context file set.
 */
export function caPreludeLines(caBundleFileName: string): readonly string[] {
  return Object.freeze([
    '# --- PPE environment prelude (declared probe input, not part of the target stage) ---',
    `COPY ${caBundleFileName} ${CA_PRELUDE_IMAGE_PATH}`,
    `RUN cat ${CA_PRELUDE_IMAGE_PATH} >> /etc/ssl/certs/ca-certificates.crt`,
    `ENV NODE_EXTRA_CA_CERTS=${CA_PRELUDE_IMAGE_PATH}`,
  ]);
}

export interface RenderStagePrefixOptions {
  /** context-relative file name of the CA bundle; when set, the prelude follows the ROOT FROM only */
  readonly caBundleFileName?: string;
}

/** Renders the verbatim raw instruction lines of the prefix as a Dockerfile (plus optional prelude). */
export function renderStagePrefixDockerfile(
  prefix: StagePrefix,
  opts: RenderStagePrefixOptions = {},
): string {
  const lines: string[] = [
    `# PPE stage-prefix probe: stage "${prefix.stageName}" (lineage ${prefix.lineage.join(' -> ')}), derived from the candidate Dockerfile up to and including the install step at line ${prefix.installLine}.`,
  ];
  let preludeInserted = false;
  for (const instruction of prefix.instructions) {
    lines.push(instruction.raw);
    if (!preludeInserted && instruction.keyword === 'FROM') {
      preludeInserted = true;
      if (opts.caBundleFileName !== undefined) lines.push(...caPreludeLines(opts.caBundleFileName));
    }
  }
  return `${lines.join('\n')}\n`;
}
