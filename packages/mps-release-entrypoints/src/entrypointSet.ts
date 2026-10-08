import { createHash } from 'node:crypto';
import { sha256CanonicalJson } from '../../mps-compliance/src/canonical/sha256Canonical.js';
import type { EntrypointEntry } from './types';

/**
 * entrypoint_set.derived_sha256 = SHA256( JCS( entries sorted by id, each { id, argv, entry_file } ) ).
 * JCS is RFC 8785, through the repository primitive (sha256CanonicalJson in mps-compliance). `role` is not part
 * of the hash (it is documentation of what the process is); id, argv and entry_file are.
 */
export function deriveEntrypointSetSha256(entries: readonly EntrypointEntry[]): string {
  const projected = [...entries]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, argv: [...e.argv], entry_file: e.entry_file }));
  return sha256CanonicalJson(projected);
}

/** SHA-256 over the parsed entrypoints.json object under RFC 8785 (formatting of the file does not matter). */
export function entrypointsFileJcsSha256(parsed: unknown): string {
  return sha256CanonicalJson(parsed);
}

/** SHA-256 over the raw bytes of the file as stored in the tree. */
export function bytesSha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
