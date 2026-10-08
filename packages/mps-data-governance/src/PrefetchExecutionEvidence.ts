import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeStrict } from "@miljobeslut/mimers-brunn-core";

import type { ContentReference } from "../../mps-core/src/types";

/**
 * pex-canonical-1 binds every resolved target outcome.
 *
 * `observed_at` stays on a SKIP body and is the only outcome field excluded
 * from identity, hashing, and replay equality.
 */

export const PREFETCH_EVIDENCE_CANONICAL_VERSION = "pex-canonical-1" as const;

/** The only outcome field excluded from pex-canonical-1 identity. */
export const PEX_EXCLUDED_OUTCOME_FIELDS = ["observed_at"] as const;

export interface PrefetchFetchOutcome {
  readonly outcome: "FETCH";
  readonly target_identity: string;
  readonly locator_identity: string;
  readonly file_name: string;
  readonly quarantine_id: string;
  readonly content_hash: string;
  readonly byte_length: number;
}

export interface PrefetchSkipOutcome {
  readonly outcome: "SKIP";
  readonly target_identity: string;
  readonly locator_identity: string;
  readonly file_name: string;
  readonly method: "HEAD";
  readonly reason_code: "REMOTE_REPRESENTATION_UNCHANGED";
  readonly validator_class: "STRONG_ETAG";
  readonly validator_token: string;
  readonly final_url: string;
  readonly observed_at: string;
}

export type PrefetchOutcome = PrefetchFetchOutcome | PrefetchSkipOutcome;

export interface PrefetchExecutionEvidence {
  readonly canonical_version: typeof PREFETCH_EVIDENCE_CANONICAL_VERSION;
  readonly execution_id: string;
  readonly source_id: string;
  readonly source_content_hash: string;
  readonly registry_artifact_id: string;
  readonly download_manifest_ref: ContentReference | null;
  readonly outcomes: readonly PrefetchOutcome[];
}

export interface PrefetchExecutionEvidenceStore {
  persist(evidence: PrefetchExecutionEvidence): Promise<ContentReference>;
  resolve(reference: ContentReference): Promise<PrefetchExecutionEvidence | null>;
}

export function buildPrefetchEvidenceIdentityPayload(
  evidence: PrefetchExecutionEvidence,
): Record<string, unknown> {
  return {
    canonical_version: PREFETCH_EVIDENCE_CANONICAL_VERSION,
    execution_id: evidence.execution_id,
    source_id: evidence.source_id,
    source_content_hash: evidence.source_content_hash,
    registry_artifact_id: evidence.registry_artifact_id,
    download_manifest_ref: evidence.download_manifest_ref,
    outcomes: evidence.outcomes.map(identityOutcome).sort((left, right) =>
      left.target_identity.localeCompare(right.target_identity),
    ),
  };
}

export function computePrefetchEvidenceHash(evidence: PrefetchExecutionEvidence): string {
  const canonical = canonicalizeStrict(buildPrefetchEvidenceIdentityPayload(evidence));
  return createHash("sha256")
    .update(`${PREFETCH_EVIDENCE_CANONICAL_VERSION}\n${canonical}`, "utf8")
    .digest("hex");
}

export function buildPrefetchEvidenceRef(evidence: PrefetchExecutionEvidence): ContentReference {
  const digest = computePrefetchEvidenceHash(evidence);
  return {
    id: `prefetch-evidence-${evidence.execution_id}-${digest.slice(0, 16)}`,
    content_hash: { algorithm: "sha256", digest },
  };
}

function identityOutcome(outcome: PrefetchOutcome): { readonly target_identity: string } & Record<string, unknown> {
  if (outcome.outcome === "FETCH") {
    return {
      outcome: "FETCH",
      target_identity: outcome.target_identity,
      locator_identity: outcome.locator_identity,
      file_name: outcome.file_name,
      quarantine_id: outcome.quarantine_id,
      content_hash: outcome.content_hash,
      byte_length: outcome.byte_length,
    };
  }
  const identity: { readonly target_identity: string } & Record<string, unknown> = {
    outcome: "SKIP",
    target_identity: outcome.target_identity,
    locator_identity: outcome.locator_identity,
    file_name: outcome.file_name,
    method: outcome.method,
    reason_code: outcome.reason_code,
    validator_class: outcome.validator_class,
    validator_token: outcome.validator_token,
    final_url: outcome.final_url,
  };
  for (const field of PEX_EXCLUDED_OUTCOME_FIELDS) {
    delete identity[field];
  }
  return identity;
}

function sameIdentity(left: PrefetchExecutionEvidence, right: PrefetchExecutionEvidence): boolean {
  return (
    canonicalizeStrict(buildPrefetchEvidenceIdentityPayload(left)) ===
    canonicalizeStrict(buildPrefetchEvidenceIdentityPayload(right))
  );
}

export class InMemoryPrefetchExecutionEvidenceStore implements PrefetchExecutionEvidenceStore {
  private readonly bodies = new Map<string, string>();

  async persist(evidence: PrefetchExecutionEvidence): Promise<ContentReference> {
    const reference = buildPrefetchEvidenceRef(evidence);
    const existingBody = this.bodies.get(reference.content_hash.digest);
    if (existingBody !== undefined) {
      const existing = JSON.parse(existingBody) as PrefetchExecutionEvidence;
      if (!sameIdentity(existing, evidence)) {
        throw new Error(
          `Prefetch evidence hash collision for '${reference.content_hash.digest}': existing body differs.`,
        );
      }
      return reference;
    }
    this.bodies.set(reference.content_hash.digest, canonicalizeStrict(evidence));
    return reference;
  }

  async resolve(reference: ContentReference): Promise<PrefetchExecutionEvidence | null> {
    const body = this.bodies.get(reference.content_hash.digest);
    return body === undefined ? null : validateResolvedEvidence(body, reference);
  }
}

export class FilePrefetchExecutionEvidenceStore implements PrefetchExecutionEvidenceStore {
  constructor(private readonly rootPath: string) {}

  async persist(evidence: PrefetchExecutionEvidence): Promise<ContentReference> {
    const reference = buildPrefetchEvidenceRef(evidence);
    const path = join(this.rootPath, `${reference.content_hash.digest}.json`);
    await mkdir(this.rootPath, { recursive: true });
    try {
      await writeFile(path, canonicalizeStrict(evidence), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = validateResolvedEvidence(await readFile(path, "utf8"), reference);
      if (!sameIdentity(existing, evidence)) {
        throw new Error(
          `Prefetch evidence hash collision for '${reference.content_hash.digest}': existing body differs.`,
        );
      }
    }
    return reference;
  }

  async resolve(reference: ContentReference): Promise<PrefetchExecutionEvidence | null> {
    try {
      return validateResolvedEvidence(
        await readFile(join(this.rootPath, `${reference.content_hash.digest}.json`), "utf8"),
        reference,
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

export function validateResolvedEvidence(
  serialized: string,
  expected: ContentReference,
): PrefetchExecutionEvidence {
  let evidence: PrefetchExecutionEvidence;
  try {
    evidence = JSON.parse(serialized) as PrefetchExecutionEvidence;
  } catch {
    throw new Error(`Persisted prefetch evidence '${expected.id}' is not valid JSON.`);
  }
  const actual = buildPrefetchEvidenceRef(evidence);
  if (
    actual.id !== expected.id ||
    actual.content_hash.algorithm !== expected.content_hash.algorithm ||
    actual.content_hash.digest !== expected.content_hash.digest
  ) {
    throw new Error(`Persisted prefetch evidence does not match reference '${expected.id}'.`);
  }
  return evidence;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
