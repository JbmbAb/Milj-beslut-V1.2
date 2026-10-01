/**
 * PATTERN-PROOF-ENGINE-01 V1 -- Dockerfile parser (BOOTSTRAP design section 5.4, plan T9).
 *
 * A small, dependency-free parser that is exact for the subset of Dockerfile syntax this repository
 * uses and conservative everywhere else: backslash continuations are joined before tokenizing,
 * comment/blank lines are skipped (also inside a continuation, as BuildKit does), leading `--flags`
 * are separated for FROM/COPY/ADD/RUN/HEALTHCHECK, and every other keyword is kept verbatim. The
 * parser never interprets `$VAR` substitutions; it reports what the candidate Dockerfile DECLARES.
 *
 * Documented limits: the `# escape=` parser directive is rejected when it selects a backtick (only
 * the default backslash is supported); heredoc syntax (`<<EOF`) is not supported; flag values are
 * read up to the next whitespace (quoted flag values with spaces are not supported).
 */
import { PatternProofError } from '../errors';

export interface ParsedInstruction {
  /** 1-based physical line of the first line of the instruction */
  readonly line: number;
  /** 1-based physical line of the last line of the instruction (continuations) */
  readonly endLine: number;
  /** upper-case keyword, e.g. RUN */
  readonly keyword: string;
  /** the instruction text after keyword and flags, continuations resolved and joined with one space */
  readonly args: string;
  /** leading `--name=value` flags (e.g. from, chown); a bare `--name` yields '' */
  readonly flags: Readonly<Record<string, string>>;
  /**
   * the leading flags exactly as written, in order, joined with one space ('' when none), e.g.
   * `--mount=type=cache,target=/root/.npm` (R3 F1: BuildKit's step header prints the instruction as
   * written, flags included)
   */
  readonly flagsText: string;
  /** verbatim physical lines joined with '\n' (comments/blank lines inside a continuation included) */
  readonly raw: string;
}

export interface ParsedStageFrom {
  /** the image reference as written (may name another stage) */
  readonly image: string;
  /** set when `image` names an earlier stage of the same Dockerfile (by name or by index) */
  readonly parentStage?: string;
}

export interface ParsedStage {
  /** explicit `AS name` (as written) or the 0-based stage index as a string */
  readonly name: string;
  readonly index: number;
  readonly from: ParsedStageFrom;
  /** every instruction of the stage, the FROM instruction first */
  readonly instructions: readonly ParsedInstruction[];
}

export interface ParsedDockerfile {
  readonly stages: readonly ParsedStage[];
  /** instructions before the first FROM (only ARG is legal there) */
  readonly preamble: readonly ParsedInstruction[];
}

const FLAG_KEYWORDS: ReadonlySet<string> = new Set(['FROM', 'COPY', 'ADD', 'RUN', 'HEALTHCHECK']);
const ESCAPE_CHAR = '\\';

function parseError(message: string, line?: number): PatternProofError {
  return new PatternProofError(
    'PPE_DOCKERFILE_PARSE',
    message,
    line === undefined ? {} : { path: `line ${line}` },
  );
}

/**
 * Splits a Dockerfile argument string into words the way Docker's ENV/LABEL/FROM parsing does:
 * whitespace separates words; single and double quotes group; backslash escapes the next character
 * outside single quotes. Quotes are removed from the result.
 */
export function splitDockerfileWords(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let hasWord = false;
  let quote: '"' | "'" | null = null;
  for (let k = 0; k < text.length; k += 1) {
    const ch = text[k];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && k + 1 < text.length) {
        k += 1;
        current += text[k];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasWord = true;
      continue;
    }
    if (ch === '\\' && k + 1 < text.length) {
      k += 1;
      current += text[k];
      hasWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasWord) {
        out.push(current);
        current = '';
        hasWord = false;
      }
      continue;
    }
    current += ch;
    hasWord = true;
  }
  if (hasWord) out.push(current);
  return out;
}

/** True for exec (JSON array) form: `RUN ["npm", "ci"]`. Returns the tokens, or null for shell form. */
export function execFormTokens(args: string): readonly string[] | null {
  const trimmed = args.trim();
  if (!trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
  return Object.freeze(parsed.map((item) => String(item)));
}

/** The shell text of a RUN/CMD/ENTRYPOINT: shell form verbatim, exec form joined with one space. */
export function instructionShellText(instruction: ParsedInstruction): string {
  const tokens = execFormTokens(instruction.args);
  return tokens === null ? instruction.args : tokens.join(' ');
}

interface LogicalLine {
  readonly line: number;
  readonly endLine: number;
  readonly raw: string;
  readonly text: string;
}

function isSkippable(physical: string): boolean {
  const trimmed = physical.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function readLogicalLines(text: string): LogicalLine[] {
  const physical = text.split(/\r?\n/);
  const logical: LogicalLine[] = [];
  let i = 0;
  // parser directives: only leading `# key=value` comment lines
  while (i < physical.length) {
    const directive = /^#\s*([a-zA-Z]+)\s*=\s*(\S+)\s*$/.exec(physical[i]);
    if (directive === null) break;
    if (directive[1].toLowerCase() === 'escape' && directive[2] !== ESCAPE_CHAR) {
      throw parseError(`unsupported escape directive "${directive[2]}" (only backslash is supported)`, i + 1);
    }
    i += 1;
  }
  while (i < physical.length) {
    if (isSkippable(physical[i])) {
      i += 1;
      continue;
    }
    const start = i;
    const rawLines: string[] = [];
    const parts: string[] = [];
    let end = i;
    let cursor = i;
    for (;;) {
      const segment = physical[cursor];
      rawLines.push(segment);
      end = cursor;
      const trimmedEnd = segment.trimEnd();
      if (!trimmedEnd.endsWith(ESCAPE_CHAR)) {
        parts.push(trimmedEnd.trim());
        break;
      }
      parts.push(trimmedEnd.slice(0, -1).trim());
      let next = cursor + 1;
      while (next < physical.length && isSkippable(physical[next])) {
        rawLines.push(physical[next]);
        end = next;
        next += 1;
      }
      if (next >= physical.length) break; // unterminated continuation at EOF: tolerated
      cursor = next;
    }
    logical.push({
      line: start + 1,
      endLine: end + 1,
      raw: rawLines.join('\n'),
      text: parts.filter((part) => part.length > 0).join(' '),
    });
    i = end + 1;
  }
  return logical;
}

function parseInstruction(logical: LogicalLine): ParsedInstruction {
  const match = /^(\S+)\s*([\s\S]*)$/.exec(logical.text);
  if (match === null) throw parseError('empty instruction', logical.line);
  const keyword = match[1].toUpperCase();
  if (!/^[A-Z]+$/.test(keyword)) throw parseError(`invalid instruction keyword "${match[1]}"`, logical.line);
  let rest = match[2].trim();
  const flags: Record<string, string> = {};
  const flagTexts: string[] = [];
  if (FLAG_KEYWORDS.has(keyword)) {
    for (;;) {
      const flag = /^--([a-zA-Z][\w-]*)(?:=(\S*))?(?:\s+|$)/.exec(rest);
      if (flag === null) break;
      flags[flag[1]] = flag[2] ?? '';
      flagTexts.push(flag[0].trim());
      rest = rest.slice(flag[0].length);
    }
  }
  return Object.freeze({
    line: logical.line,
    endLine: logical.endLine,
    keyword,
    args: rest,
    flags: Object.freeze(flags),
    flagsText: flagTexts.join(' '),
    raw: logical.raw,
  });
}

interface MutableStage {
  name: string;
  index: number;
  from: ParsedStageFrom;
  instructions: ParsedInstruction[];
}

function parseFrom(instruction: ParsedInstruction, stages: readonly MutableStage[]): MutableStage {
  const words = splitDockerfileWords(instruction.args);
  const image = words[0];
  if (image === undefined || image.length === 0) throw parseError('FROM requires an image', instruction.line);
  let name: string | undefined;
  if (words.length > 1) {
    if (words[1].toUpperCase() !== 'AS' || words.length !== 3 || words[2].length === 0) {
      throw parseError(`malformed FROM: "${instruction.args}"`, instruction.line);
    }
    name = words[2];
    if (stages.some((stage) => stage.name.toLowerCase() === name?.toLowerCase())) {
      throw parseError(`duplicate stage name "${name}"`, instruction.line);
    }
  }
  const index = stages.length;
  const parent =
    stages.find((stage) => stage.name.toLowerCase() === image.toLowerCase()) ??
    (/^\d+$/.test(image) ? stages[Number(image)] : undefined);
  const from: ParsedStageFrom =
    parent === undefined ? { image } : Object.freeze({ image, parentStage: parent.name });
  return { name: name ?? String(index), index, from: Object.freeze(from), instructions: [instruction] };
}

/**
 * Parses a Dockerfile into stages. Throws PatternProofError PPE_DOCKERFILE_PARSE on: no FROM, a
 * non-ARG instruction before the first FROM, malformed FROM, duplicate stage names, invalid keywords
 * or an unsupported escape directive.
 */
export function parseDockerfile(text: string): ParsedDockerfile {
  if (typeof text !== 'string') throw parseError('Dockerfile text must be a string');
  const stages: MutableStage[] = [];
  const preamble: ParsedInstruction[] = [];
  for (const logical of readLogicalLines(text)) {
    const instruction = parseInstruction(logical);
    if (instruction.keyword === 'FROM') {
      stages.push(parseFrom(instruction, stages));
      continue;
    }
    const current = stages[stages.length - 1];
    if (current === undefined) {
      if (instruction.keyword !== 'ARG') {
        throw parseError(
          `${instruction.keyword} before the first FROM (only ARG is allowed)`,
          instruction.line,
        );
      }
      preamble.push(instruction);
      continue;
    }
    current.instructions.push(instruction);
  }
  if (stages.length === 0) throw parseError('Dockerfile has no FROM instruction');
  return Object.freeze({
    stages: Object.freeze(
      stages.map((stage) =>
        Object.freeze({
          name: stage.name,
          index: stage.index,
          from: stage.from,
          instructions: Object.freeze(stage.instructions),
        }),
      ),
    ),
    preamble: Object.freeze(preamble),
  });
}

/** Finds a stage by its explicit name (case-insensitive, as BuildKit resolves it) or by index string. */
export function findStage(parsed: ParsedDockerfile, stageRef: string): ParsedStage | undefined {
  const lower = stageRef.toLowerCase();
  return (
    parsed.stages.find((stage) => stage.name.toLowerCase() === lower) ??
    (/^\d+$/.test(stageRef) ? parsed.stages[Number(stageRef)] : undefined)
  );
}
