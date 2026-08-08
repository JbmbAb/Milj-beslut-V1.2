/**

 * Path fingerprinting for archive classification (no ML — deterministic signals).

 */

import * as fs from 'node:fs';

import * as path from 'node:path';

import type { PathFingerprint } from './ClassifierArtifact';



const MIME_BY_EXT: Record<string, string> = {

  '.json': 'application/json',

  '.html': 'text/html',

  '.htm': 'text/html',

  '.xml': 'application/xml',

  '.pdf': 'application/pdf',

  '.gpkg': 'application/geopackage+sqlite3',

  '.csv': 'text/csv',

  '.zip': 'application/zip',

  '.bin': 'application/octet-stream',

};



function extOf(name: string): string {

  const ext = path.extname(name).toLowerCase();

  return ext || '(none)';

}



function walkFiles(dir: string, out: string[] = [], maxFiles = 5000): string[] {

  let entries: fs.Dirent[];

  try {

    entries = fs.readdirSync(dir, { withFileTypes: true });

  } catch {

    return out;

  }

  for (const e of entries) {

    if (out.length >= maxFiles) break;

    const fp = path.join(dir, e.name);

    if (e.isDirectory()) walkFiles(fp, out, maxFiles);

    else out.push(fp);

  }

  return out;

}



function readJsonSafe(fp: string): Record<string, unknown> | null {

  try {

    const raw = fs.readFileSync(fp, 'utf8');

    const parsed: unknown = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {

      return parsed as Record<string, unknown>;

    }

  } catch {

    // ignore

  }

  return null;

}



function collectUrlSignals(manifest: Record<string, unknown> | null, sampleFiles: string[]): string[] {

  const urls = new Set<string>();

  const re = /https?:\/\/[^\s"'<>]+/gi;

  if (manifest) {

    const blob = JSON.stringify(manifest);

    for (const m of blob.match(re) ?? []) urls.add(m.slice(0, 200));

  }

  for (const f of sampleFiles.slice(0, 5)) {

    if (!/\.(html?|json|xml|txt)$/i.test(f)) continue;

    try {

      const st = fs.statSync(f);

      if (st.size > 200_000) continue;

      const text = fs.readFileSync(f, 'utf8');

      for (const m of text.match(re) ?? []) {

        urls.add(m.slice(0, 200));

        if (urls.size >= 20) return [...urls];

      }

    } catch {

      // ignore

    }

  }

  return [...urls];

}



export function fingerprintPath(absPath: string, archiveRoot: string): PathFingerprint {

  const abs = path.resolve(absPath);

  const rel = path.relative(archiveRoot, abs).replace(/\\/g, '/');

  const basename = path.basename(abs);

  const parent_dirs = path

    .dirname(rel)

    .split('/')

    .filter(Boolean);



  const st = fs.statSync(abs);

  const is_directory = st.isDirectory();

  const files = is_directory ? walkFiles(abs) : [abs];



  /** @type {Record<string, number>} */

  const ext_histogram: Record<string, number> = {};

  let total_bytes = 0;

  for (const f of files) {

    const ext = extOf(path.basename(f));

    ext_histogram[ext] = (ext_histogram[ext] ?? 0) + 1;

    try {

      total_bytes += fs.statSync(f).size;

    } catch {

      // ignore

    }

  }



  const sample_names = files.slice(0, 12).map((f) => path.relative(abs, f).replace(/\\/g, '/') || path.basename(f));

  const mime_hints = [

    ...new Set(

      Object.keys(ext_histogram)

        .map((ext) => MIME_BY_EXT[ext])

        .filter((m): m is string => Boolean(m)),

    ),

  ];



  const manifestPath = is_directory

    ? path.join(abs, 'manifest.json')

    : path.basename(abs) === 'manifest.json'

      ? abs

      : null;

  const manifest_signals = manifestPath && fs.existsSync(manifestPath) ? readJsonSafe(manifestPath) : null;

  const url_signals = collectUrlSignals(manifest_signals, files);



  return {

    abs_path: abs,

    rel_path: rel,

    basename,

    parent_dirs,

    is_directory,

    file_count: files.length,

    total_bytes,

    ext_histogram,

    sample_names,

    mime_hints,

    manifest_signals,

    url_signals,

  };

}


