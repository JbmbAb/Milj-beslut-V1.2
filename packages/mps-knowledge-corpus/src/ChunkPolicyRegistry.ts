import type { ChunkStructureKind } from '@miljobeslut/mps-legal-corpus';

import {
  admitCourtChunks,
  admitEvidenceChunks,
  admitLawChunks,
  admitLawChunksV24,
  admitStandardChunks,
  type ChunkAdmissionResult,
} from './ChunkAdmission';
import { CHUNK_POLICY_LAW_V241, CHUNK_POLICY_TEXT_V23 } from './versions';

/**
 * Binds each identity-bearing `chunk_policy_version` string to the exact admitting function that
 * produces it. Before K2.2 the policy string was a free caller literal that the gate only checked
 * for non-emptiness ("governance illusion": rows exist under labels with no reproducing code). Here
 * an unregistered policy, or a policy that has no admitter for the requested family, is refused
 * rather than silently admitted under a label nothing can reproduce.
 *
 * Adding a policy means adding a NEW, separately named chunker plus a new entry here — never editing
 * an existing chunker in place (chunking-strategy-gate skill rule, LegalChunker.ts:49-53 precedent).
 */
type Admitter = (args: {
  readonly text: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
  readonly evidenceDocType?: string;
}) => ChunkAdmissionResult;

const REGISTRY: Readonly<Record<string, Partial<Record<ChunkStructureKind, Admitter>>>> = Object.freeze({
  [CHUNK_POLICY_LAW_V241]: Object.freeze({
    law: (args) => admitLawChunksV24(args),
  }),
  [CHUNK_POLICY_TEXT_V23]: Object.freeze({
    law: (args) => admitLawChunks(args),
    court: (args) => admitCourtChunks(args),
    evidence: (args) => admitEvidenceChunks({ ...args, docType: args.evidenceDocType ?? 'decision' }),
    standard: (args) => admitStandardChunks(args),
  }),
});

export class ChunkPolicyError extends Error {
  constructor(
    readonly code: 'UNREGISTERED_CHUNK_POLICY' | 'POLICY_FAMILY_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'ChunkPolicyError';
  }
}

export function registeredChunkPolicies(): readonly string[] {
  return Object.freeze(Object.keys(REGISTRY));
}

/** The policy K2.2 uses by default per family: the current production law path (v2.4.1) for law, text/v2.3 otherwise. */
export function defaultChunkPolicyFor(structureKind: ChunkStructureKind): string {
  return structureKind === 'law' ? CHUNK_POLICY_LAW_V241 : CHUNK_POLICY_TEXT_V23;
}

export function admitWithPolicy(args: {
  readonly chunkPolicyVersion: string;
  readonly structureKind: ChunkStructureKind;
  readonly text: string;
  readonly sourceProjectionRef: string;
  readonly evidenceDocType?: string;
}): ChunkAdmissionResult {
  if (typeof args.chunkPolicyVersion !== 'string') {
    throw new ChunkPolicyError(
      'UNREGISTERED_CHUNK_POLICY',
      'chunk_policy_version must be a string label (no coercion of arrays, objects or symbols)',
    );
  }
  // Own-property lookups only: '__proto__' / 'constructor' / 'toString' are unregistered labels, not policies.
  const policy = Object.hasOwn(REGISTRY, args.chunkPolicyVersion)
    ? REGISTRY[args.chunkPolicyVersion]
    : undefined;
  if (!policy) {
    throw new ChunkPolicyError(
      'UNREGISTERED_CHUNK_POLICY',
      `chunk_policy_version '${args.chunkPolicyVersion}' has no registered admitter; registered: ${registeredChunkPolicies().join(', ')}`,
    );
  }
  const admitter = Object.hasOwn(policy, args.structureKind) ? policy[args.structureKind] : undefined;
  if (!admitter) {
    throw new ChunkPolicyError(
      'POLICY_FAMILY_UNSUPPORTED',
      `chunk_policy_version '${args.chunkPolicyVersion}' has no admitter for structure_kind '${args.structureKind}'`,
    );
  }
  return admitter({
    text: args.text,
    sourceProjectionRef: args.sourceProjectionRef,
    chunkPolicyVersion: args.chunkPolicyVersion,
    ...(args.evidenceDocType ? { evidenceDocType: args.evidenceDocType } : {}),
  });
}
