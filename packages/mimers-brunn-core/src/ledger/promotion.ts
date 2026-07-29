import type { SignatureEnvelope } from '../signing';
import { parseHash } from '../serialization';

/**
 * CAS-native Mimers promotion (ADR-042). Distinct from evolve WORM PromotionArtifactV3.
 */
export interface MimersPromotionArtifact {
  readonly manifestHash: string;
  readonly parents: readonly string[];
  readonly generation: number;
  readonly signatureEnvelope?: SignatureEnvelope;
  readonly metadata?: {
    readonly humanName?: string;
    readonly [key: string]: unknown;
  };
}

export function validateMimersPromotion(obj: unknown): MimersPromotionArtifact {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid schema: Promotion must be an object.');
  }
  const p = obj as Record<string, unknown>;
  if (typeof p.manifestHash !== 'string') {
    throw new Error("Invalid schema: 'manifestHash' must be a string.");
  }
  try {
    parseHash(p.manifestHash);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid schema: 'manifestHash' is not a valid address: ${msg}`);
  }
  if (!Array.isArray(p.parents)) {
    throw new Error("Invalid schema: 'parents' must be an array.");
  }
  const uniqueParents = new Set<string>();
  for (const parent of p.parents) {
    if (typeof parent !== 'string') throw new Error("Invalid schema: 'parents' must contain strings.");
    parseHash(parent);
    if (uniqueParents.has(parent)) {
      throw new Error(`Invalid schema: duplicate parent reference '${parent}'.`);
    }
    uniqueParents.add(parent);
  }
  if (typeof p.generation !== 'number' || !Number.isSafeInteger(p.generation) || p.generation < 0) {
    throw new Error("Invalid schema: 'generation' must be a non-negative safe integer.");
  }
  return obj as MimersPromotionArtifact;
}
