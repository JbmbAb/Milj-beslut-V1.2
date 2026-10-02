// W-CATCH2 (D) -- the scanner of the read-fault catch inventory (tests/unit/readFaultCatchInventoryCATCH2.test.ts).
//
// Plain ESM (no TypeScript) so the test and a node one-liner share one scanner. Reads source files as
// text; imports nothing from the product, touches no network, database or environment.
//
// Every `catch` block and every `.catch(...)` handler in the scope below is reported with its body. A
// block is ACCEPTED when its body
//  - uses the shared read-fault classification (CLASSIFIERS), or
//  - PROPAGATES the caught failure unchanged or as the cause (`throw e`, `next(e)`, `cause: e`, or `e`
//    passed to an error constructor) -- fail-closed with the cause kept, or
//  - carries a reviewed marker comment `CATCH-REVIEWED: <KIND>: <reason>` (in the body or on the three
//    lines above it).
// Everything else must be on the test's reviewed list (by file and body fingerprint), or the test fails --
// so a NEW catch around a CAS / index / database read that swallows a failure as "missing", null, 404 or
// "mint" cannot land unnoticed.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** The scope: the LU localization core, the capability/provisioning services, the canonical context. */
export function scopeFiles(root) {
  const files = [];
  const add = (rel) => {
    if (fs.existsSync(path.join(root, rel))) files.push(rel);
  };
  const walk = (relDir) => {
    for (const entry of fs.readdirSync(path.join(root, relDir), { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(rel);
    }
  };
  for (const entry of fs.readdirSync(path.join(root, 'server/modules'), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('localization')) walk(`server/modules/${entry.name}`);
  }
  for (const name of fs.readdirSync(path.join(root, 'server/services'))) {
    if (/capability|provisioning/i.test(name) && /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) add(`server/services/${name}`);
  }
  add('src/application/resolveCanonicalProjectContext.ts');
  // The catch-all ledger's other places (BOOT-REPORT section 2): the LU routes, the property lookup, the bootstrap worker.
  add('server/routes/localization.routes.ts');
  add('server/services/propertyUnitService.ts');
  add('server/services/luProjectContextBootstrapWorker.ts');
  return [...new Set(files)].sort();
}

/** Identifiers of the shared read-fault classification (readFaultClassification.ts and what it reuses or wraps). */
export const CLASSIFIERS = Object.freeze([
  'classifyReadFault',
  'toReadFaultError',
  'readExistingOrProvenAbsent',
  'isProvenArtifactAbsence',
  'isProvenBindingAbsence',
  'isProjectAccessDenied',
  'projectAccessFailure',
  'LuReadFaultError',
  'provisioningFailure',
  'provisioningReadFaultDetailSv',
  'classifyBootstrapFailure',
  'canonicalProjectContextFailure',
  'classifyBindingResolutionFailure',
  'assertNoProjectContextBindingRegistered',
  'currentBindingFault',
  'candidateReadFault',
  'isPersistentStorageFault',
  'classifyLocalizationGeometryCurrentnessError',
  'isProvablyNotCurrentCapability',
]);
const CLASSIFIER_RE = new RegExp(`\\b(${CLASSIFIERS.join('|')})\\b`);
export const MARKER_RE = /CATCH-REVIEWED:\s*([A-Z][A-Z_]+):\s*\S/;

/** Blank out comments and string/template contents (same length), so braces inside them never count. */
export function maskCode(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

function matching(masked, openIndex, open, close) {
  let depth = 0;
  for (let k = openIndex; k < masked.length; k += 1) {
    if (masked[k] === open) depth += 1;
    else if (masked[k] === close) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

export function fingerprint(body) {
  return crypto.createHash('sha256').update(body.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The handler hands the caught failure on: rethrown, passed to `next`, kept as `cause`, or given to an error constructor. */
export function propagates(maskedBody, name) {
  const n = escapeRe(name);
  return (
    new RegExp(`\\bthrow\\s+${n}\\b(?!\\s*\\.)`).test(maskedBody) ||
    new RegExp(`\\bnext\\(\\s*${n}\\s*\\)`).test(maskedBody) ||
    new RegExp(`\\bcause\\s*:\\s*${n}\\b`).test(maskedBody) ||
    new RegExp(`\\bnew\\s+\\w*Error\\([^;]*\\b${n}\\b(?!\\s*(\\.|instanceof))`).test(maskedBody)
  );
}

/** A catch is accepted when it is classified, propagates its failure, or carries a reviewed marker. */
export function isAccepted(entry) {
  return entry.classified || entry.propagates || entry.marker !== null;
}

/**
 * Every catch of one source text: { file, line, kind: 'block' | 'promise', body, fingerprint, classified,
 * propagates, marker }. `body` is the original text of the handler (comments included, so a marker in it
 * counts).
 */
export function catchesOfSource(rel, src) {
  const masked = maskCode(src);
  const lines = src.split('\n');
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  const found = [];
  const re = /\bcatch\b/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const at = m.index;
    let start;
    let end;
    let kind;
    let binding;
    if (masked[at - 1] === '.') {
      const paren = masked.indexOf('(', at);
      if (paren < 0) continue;
      end = matching(masked, paren, '(', ')');
      start = paren + 1;
      kind = 'promise';
      binding = /^\s*\(?\s*([A-Za-z_$][\w$]*)/.exec(masked.slice(start, end))?.[1];
    } else {
      const brace = masked.indexOf('{', at);
      if (brace < 0) continue;
      end = matching(masked, brace, '{', '}');
      start = brace + 1;
      kind = 'block';
      binding = /^\s*\(\s*([A-Za-z_$][\w$]*)/.exec(masked.slice(at + 5, brace))?.[1];
    }
    if (end < 0) continue;
    const body = src.slice(start, end);
    const line = lineOf(at);
    const above = lines.slice(Math.max(0, line - 4), line - 1).join('\n');
    const marker = MARKER_RE.exec(body)?.[1] ?? MARKER_RE.exec(above)?.[1] ?? null;
    found.push({
      file: rel,
      line,
      kind,
      body,
      fingerprint: fingerprint(body),
      classified: CLASSIFIER_RE.test(body),
      propagates: binding ? propagates(masked.slice(start, end), binding) : false,
      marker,
    });
  }
  return found;
}

export function catchesOf(root, rel) {
  return catchesOfSource(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
}

export function scanCatches(root) {
  return scopeFiles(root).flatMap((rel) => catchesOf(root, rel));
}
