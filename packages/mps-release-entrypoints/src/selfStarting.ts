/**
 * Textual, conservative definition of a "self-starting" source file (one that does work when it is run or imported
 * as a process entry): a line that begins in COLUMN 0 (no indentation, so a top-level statement in this code base's
 * style) and is
 *   (call)    a call statement:   `name(...)`, `a.b(...)`, optionally preceded by `void` or `await`;
 *   (iife)    an immediately invoked function: a line starting with an opening parenthesis and a function/arrow;
 *   (import)  a top-level dynamic import call;
 *   (start)   a declaration initialised by a start/run/main/listen/boot/launch/serve call:
 *             `const handle = startSomething(...)`;
 *   (main)    a test of being the main module (`require.main`, `import.meta.url`, `import.meta.main`).
 * Comment lines are not markers. Block comments are NOT stripped: a call-looking line inside one would count, which is the
 * safe (over-reporting) direction. A false positive is resolved by listing the file in the tree's entries or
 * not_production lists, or in LIBRARY_FILES below with a justification that the detector then checks.
 *
 * The detector looks only at text. It cannot see a process started by an imported module's side effect; that is why
 * it is applied to the files under server/workers/ and to server/index.ts, which are the process files by construction.
 */

const KEYWORDS = 'if|for|while|switch|function|return|catch|else|try|do|import|export|class|interface|type|enum|declare|namespace|module|const|let|var|async|new|typeof|throw|with|case|default|finally';

const MARKERS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: 'call', pattern: new RegExp(`^(?:void\\s+|await\\s+)?(?!(?:${KEYWORDS})\\b)[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\s*\\(`) },
  { name: 'iife', pattern: /^\(\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/ },
  { name: 'import', pattern: /^(?:void\s+|await\s+)import\s*\(/ },
  { name: 'start', pattern: /^(?:export\s+)?(?:const|let|var)\s+[\w$]+(?:\s*:\s*[^=]+)?\s*=\s*(?:await\s+)?(?:start|run|main|listen|boot|launch|serve)\w*\s*\(/i },
  { name: 'main', pattern: /^if\s*\(.*(?:require\.main|import\.meta\.(?:url|main))/ },
];

export interface SelfStartingVerdict {
  readonly selfStarting: boolean;
  /** Names of the marker kinds found, each with the first line number it was found on. */
  readonly markers: ReadonlyArray<{ readonly name: string; readonly line: number }>;
}

export function detectSelfStarting(text: string): SelfStartingVerdict {
  const found = new Map<string, number>();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, index) => {
    if (line.length === 0 || /^\s/.test(line)) return; // only column 0
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) return;
    for (const { name, pattern } of MARKERS) {
      if (pattern.test(line) && !found.has(name)) found.set(name, index + 1);
    }
  });
  const markers = [...found.entries()].map(([name, line]) => ({ name, line })).sort((a, b) => a.line - b.line);
  return { selfStarting: markers.length > 0, markers };
}

/**
 * Files under server/workers/ that are libraries (imported by process files, never started themselves). The detector
 * must confirm each one is not self-starting; a library that starts to self-start fails the consistency check.
 */
export const LIBRARY_FILES: Readonly<Record<string, string>> = {
  'server/workers/bootstrap.ts':
    'exports bootstrapWorkerProcess and the assertLuWorker* start-up checks; only functions, nothing runs when it is imported. Imported by every worker process file.',
  'server/workers/registry.ts':
    'exports shouldStartWorkersInProcess and startInProcessWorkers (the in-process worker registry used by server/index.ts); only functions, nothing runs when it is imported.',
};
