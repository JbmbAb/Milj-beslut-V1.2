/**
 * I13 non-circularity: the manifest, policy, evidence and freeze record live OUTSIDE the tree they describe.
 * Any manifest/policy/evidence/out path inside the subject checkout is refused (contract 11.2, matrix attack 18).
 *
 * Symbolic links / junctions are resolved (realpath of the longest existing ancestor), and on Windows the
 * comparison ignores case, so neither can be used to smuggle an input into the subject.
 */
import fs from 'node:fs';
import path from 'node:path';

/** realpath of the longest existing ancestor, with the not-yet-existing remainder appended. */
export function realpathLoose(target: string): string {
  const absolute = path.resolve(target);
  const rest: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length === 0 ? real : path.join(real, ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

/** true iff `child` is `parent` or lies below it (after resolving links). */
export function isInside(child: string, parent: string): boolean {
  const c = fold(realpathLoose(child));
  const p = fold(realpathLoose(parent));
  const relative = path.relative(p, c);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** First violation message, or undefined. `labelled` maps a label (for the message) to a path or undefined. */
export function refuseInsideSubject(subjectToplevel: string, labelled: Readonly<Record<string, string | undefined>>): string | undefined {
  for (const [label, value] of Object.entries(labelled)) {
    if (value !== undefined && isInside(value, subjectToplevel)) {
      return `refusing ${label} inside the subject checkout (I13: inputs and evidence never live inside the tree they describe): ${value}`;
    }
  }
  return undefined;
}
