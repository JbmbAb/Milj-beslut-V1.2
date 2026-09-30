/**
 * Linear-time text helpers (CodeQL js/polynomial-redos, PR #205).
 *
 * Each helper replaces a regular expression that backtracks quadratically on a long run of one
 * character: a trailing run of slashes, leading `./` and `/` segments, spaces around a shell
 * separator, a group of short flags, or whitespace after an `npm error command` line. One hundred
 * thousand characters took 4 to 7 seconds. The inputs are a candidate's own Dockerfile,
 * `package.json`, `.dockerignore` and the output of its own install step, so the worst case was a
 * slow probe, never a wrong classification. Every helper is a single pass over the string and
 * behaves exactly like the expression it replaces; the regression tests compare the two
 * exhaustively on a small alphabet.
 */

const SLASH = 47;
const DOT = 46;

/** Drops every trailing `/` (formerly a replace with a trailing-slash-run expression). */
export function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === SLASH) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/** Drops leading `./` and `/` segments, repeatedly (formerly an anchored group repeated with a plus). */
export function stripLeadingDotSlash(text: string): string {
  let start = 0;
  for (;;) {
    const code = text.charCodeAt(start);
    if (code === SLASH) start += 1;
    else if (code === DOT && text.charCodeAt(start + 1) === SLASH) start += 2;
    else break;
  }
  return start === 0 ? text : text.slice(start);
}

/** The shell command separators of a script or RUN text: `&&`, `||`, `|`, `;`. */
const SHELL_SEPARATOR = /&&|\|\||\||;/;

/**
 * Splits shell text on `&&`, `||`, `|` and `;` and trims every piece; empty pieces are kept so the
 * caller sees the same shape as before. The former split expression put a whitespace star on both
 * sides of the separators, which made a long run of spaces quadratic. Every consumer trims and tokenizes the
 * pieces anyway, so trimming the outer ends as well changes no result.
 */
export function splitShellCommands(text: string): string[] {
  return text.split(SHELL_SEPARATOR).map((piece) => piece.trim());
}

const NPM_ERROR_COMMAND_PREFIX = 'npm error command sh -c ';

/**
 * The command text of an `npm error command sh -c <command>` line (the first occurrence, trailing
 * whitespace dropped), or undefined. The former expression ended in a lazy match followed by a
 * trailing-whitespace star, which rescans the tail at every step.
 */
export function npmErrorCommandOf(line: string): string | undefined {
  const at = line.indexOf(NPM_ERROR_COMMAND_PREFIX);
  if (at === -1) return undefined;
  const rest = line.slice(at + NPM_ERROR_COMMAND_PREFIX.length);
  if (rest.length === 0) return undefined; // the expression needed at least one character
  return rest.trimEnd();
}

/** A combined short-flag group containing `g`: `-g`, `-gf`, `-fg` (letters only after the dash). */
export function isCombinedShortGlobalFlag(token: string): boolean {
  if (token.length < 2 || token.charCodeAt(0) !== 45) return false; // '-'
  let sawG = false;
  for (let i = 1; i < token.length; i += 1) {
    const code = token.charCodeAt(i);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isLetter) return false;
    if (code === 103) sawG = true; // 'g'
  }
  return sawG;
}
