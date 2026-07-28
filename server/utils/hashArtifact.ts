import crypto from 'node:crypto';
import { canonicalize } from './canonicalize';

export function hashArtifact(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  return `sha256:${crypto.createHash('sha256').update(json).digest('hex')}`;
}
