import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ContentReference } from "../../mps-core/src/types";
import type { AuthenticatedGovernanceReviewer } from "./DatasetApprovalController";

export class GovernanceReviewerIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceReviewerIdentityError";
  }
}

export interface GovernanceReviewerRegistryEntry {
  readonly identity_ref: ContentReference;
  readonly role: "GOVERNANCE_REVIEWER";
}

interface ReviewerRegistryFile {
  readonly reviewers?: readonly unknown[];
}

/**
 * Resolves a real GOVERNANCE_REVIEWER ActorReference from the configured registry.
 *
 * Registry sources (first match wins):
 * 1. DATASET_APPROVAL_REVIEWER_REGISTRY_FILE
 * 2. ${MIMERS_ROOT}/governance/dataset-approval-reviewers.json
 * 3. ${MIMERS_ROOT}/governance-reviewer-grants/*.json (each file one entry or {reviewers:[]})
 *
 * Does not mint identities. Does not accept caller-supplied actor_ref as authority.
 * An empty / missing registry is an operational governance gap, not a test failure to patch.
 */
export function resolveGovernanceReviewerRegistryPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.DATASET_APPROVAL_REVIEWER_REGISTRY_FILE?.trim();
  if (explicit) return resolve(explicit);
  const mimersRoot = (env.MIMERS_ROOT?.trim() || join(homedir(), ".mimers"));
  const conventional = join(mimersRoot, "governance", "dataset-approval-reviewers.json");
  if (existsSync(conventional)) return conventional;
  return null;
}

export function loadGovernanceReviewerRegistry(
  env: NodeJS.ProcessEnv = process.env,
): readonly GovernanceReviewerRegistryEntry[] {
  const entries: GovernanceReviewerRegistryEntry[] = [];
  const registryPath = resolveGovernanceReviewerRegistryPath(env);
  if (registryPath) {
    if (!existsSync(registryPath)) {
      throw new GovernanceReviewerIdentityError(
        `BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: registry file '${registryPath}' does not exist`,
      );
    }
    entries.push(...parseRegistryFile(readFileSync(registryPath, "utf8"), registryPath));
  }

  const mimersRoot = env.MIMERS_ROOT?.trim() || join(homedir(), ".mimers");
  const grantsDir = join(mimersRoot, "governance-reviewer-grants");
  if (existsSync(grantsDir)) {
    for (const name of readdirSync(grantsDir).filter((n) => n.endsWith(".json")).sort()) {
      const path = join(grantsDir, name);
      entries.push(...parseRegistryFile(readFileSync(path, "utf8"), path));
    }
  }

  const unique = dedupeByIdentity(entries);
  if (unique.length === 0) {
    throw new GovernanceReviewerIdentityError(
      "BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: no real GOVERNANCE_REVIEWER identity is registered. " +
        "Human/config action required: create " +
        "`$MIMERS_ROOT/governance/dataset-approval-reviewers.json` (or set " +
        "DATASET_APPROVAL_REVIEWER_REGISTRY_FILE) with at least one entry " +
        "`{ \"reviewers\": [{ \"identity_ref\": { \"id\", \"content_hash\": { \"algorithm\", \"digest\" } }, " +
        "\"role\": \"GOVERNANCE_REVIEWER\" }] }` bound to a real resolvable human identity. " +
        "Do not use synthetic test actors (e.g. reviewer-1).",
    );
  }
  return unique;
}

export function resolveAuthenticatedGovernanceReviewer(
  authenticatedIdentityRef: ContentReference,
  env: NodeJS.ProcessEnv = process.env,
): AuthenticatedGovernanceReviewer {
  if (!authenticatedIdentityRef?.id?.trim() || !authenticatedIdentityRef.content_hash?.digest) {
    throw new GovernanceReviewerIdentityError(
      "BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: authenticated identity_ref is incomplete",
    );
  }
  const registry = loadGovernanceReviewerRegistry(env);
  const match = registry.find((entry) => sameIdentity(entry.identity_ref, authenticatedIdentityRef));
  if (!match) {
    throw new GovernanceReviewerIdentityError(
      `REJECT_UNKNOWN_GOVERNANCE_REVIEWER_IDENTITY: '${authenticatedIdentityRef.id}' is not ` +
        "registered as GOVERNANCE_REVIEWER for DatasetApproval",
    );
  }
  if (match.role !== "GOVERNANCE_REVIEWER") {
    throw new GovernanceReviewerIdentityError("REJECT_DATASET_APPROVAL_REVIEWER_ROLE");
  }
  return { actor_ref: match };
}

/**
 * Dry-run helper: when exactly one registered reviewer exists, return it.
 * Multiple reviewers require an authenticated principal selection — not auto-picked.
 */
export function resolveSoleConfiguredGovernanceReviewer(
  env: NodeJS.ProcessEnv = process.env,
): AuthenticatedGovernanceReviewer {
  const registry = loadGovernanceReviewerRegistry(env);
  if (registry.length !== 1) {
    throw new GovernanceReviewerIdentityError(
      `BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: expected exactly one registered reviewer for ` +
        `dry-run resolution, found ${registry.length}. Authenticate a specific registered reviewer.`,
    );
  }
  return { actor_ref: registry[0]! };
}

function parseRegistryFile(text: string, path: string): GovernanceReviewerRegistryEntry[] {
  const parsed = JSON.parse(text) as ReviewerRegistryFile | GovernanceReviewerRegistryEntry;
  const rawList = Array.isArray((parsed as ReviewerRegistryFile).reviewers)
    ? (parsed as ReviewerRegistryFile).reviewers!
    : [parsed];
  return rawList.map((raw, index) => validateEntry(raw, `${path}[${index}]`));
}

function validateEntry(raw: unknown, label: string): GovernanceReviewerRegistryEntry {
  const entry = raw as Partial<GovernanceReviewerRegistryEntry>;
  const id = entry.identity_ref?.id?.trim();
  const digest = entry.identity_ref?.content_hash?.digest?.trim();
  const algorithm = entry.identity_ref?.content_hash?.algorithm?.trim();
  if (!id || !digest || !algorithm) {
    throw new GovernanceReviewerIdentityError(
      `BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: ${label} missing resolvable identity_ref`,
    );
  }
  if (entry.role !== "GOVERNANCE_REVIEWER") {
    throw new GovernanceReviewerIdentityError(
      `REJECT_DATASET_APPROVAL_REVIEWER_ROLE: ${label} role must be GOVERNANCE_REVIEWER`,
    );
  }
  if (id === "reviewer-1" || id.startsWith("test-") || id.startsWith("fake-")) {
    throw new GovernanceReviewerIdentityError(
      `BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: ${label} uses a synthetic test identity id '${id}'`,
    );
  }
  const actor: GovernanceReviewerRegistryEntry = {
    identity_ref: {
      id,
      content_hash: { algorithm, digest },
    },
    role: "GOVERNANCE_REVIEWER",
  };
  return actor;
}

function sameIdentity(a: ContentReference, b: ContentReference): boolean {
  return a.id === b.id &&
    a.content_hash.algorithm === b.content_hash.algorithm &&
    a.content_hash.digest === b.content_hash.digest;
}

function dedupeByIdentity(
  entries: readonly GovernanceReviewerRegistryEntry[],
): GovernanceReviewerRegistryEntry[] {
  const seen = new Set<string>();
  const out: GovernanceReviewerRegistryEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.identity_ref.id}:${entry.identity_ref.content_hash.digest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
