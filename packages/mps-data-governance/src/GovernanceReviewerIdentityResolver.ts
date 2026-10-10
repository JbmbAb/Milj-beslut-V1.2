import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ContentReference } from "../../mps-core/src/types";

export class GovernanceReviewerIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceReviewerIdentityError";
  }
}

/**
 * AUTHORIZATION grant only.
 *
 * Declares that a canonical human identity_ref is permitted to act as
 * GOVERNANCE_REVIEWER for DatasetApproval. It does not prove the identity
 * exists, is human, or is the authenticated principal — those are identity
 * and authentication responsibilities.
 */
export interface GovernanceReviewerRegistryEntry {
  readonly identity_ref: ContentReference;
  readonly role: "GOVERNANCE_REVIEWER";
}

interface ReviewerRegistryFile {
  readonly reviewers?: readonly unknown[];
}

/**
 * Grant registry sources (authorization only):
 * 1. DATASET_APPROVAL_REVIEWER_REGISTRY_FILE
 * 2. ${MIMERS_ROOT}/governance/dataset-approval-reviewers.json
 * 3. ${MIMERS_ROOT}/governance-reviewer-grants/*.json
 */
export function resolveGovernanceReviewerRegistryPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.DATASET_APPROVAL_REVIEWER_REGISTRY_FILE?.trim();
  if (explicit) return resolve(explicit);
  const mimersRoot = env.MIMERS_ROOT?.trim() || join(homedir(), ".mimers");
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
        `BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: grant registry file '${registryPath}' does not exist`,
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
      "BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: no DatasetApproval GOVERNANCE_REVIEWER grants registered. " +
        "Human/config action required: register a grant for an existing canonical HumanIdentityArtifact " +
        "in `$MIMERS_ROOT/governance/dataset-approval-reviewers.json` (or DATASET_APPROVAL_REVIEWER_REGISTRY_FILE). " +
        "The registry is authorization-only and does not mint identity.",
    );
  }
  return unique;
}

/**
 * AUTHORIZATION lookup only. Does not authenticate and does not verify canonical identity.
 * Prefer authorizeDatasetApprovalGovernanceReviewer() for the complete authority path.
 */
export function findDatasetApprovalReviewerGrant(
  identityRef: ContentReference,
  env: NodeJS.ProcessEnv = process.env,
): GovernanceReviewerRegistryEntry | null {
  const registry = loadGovernanceReviewerRegistry(env);
  return registry.find((entry) => sameIdentity(entry.identity_ref, identityRef)) ?? null;
}

function parseRegistryFile(text: string, path: string): GovernanceReviewerRegistryEntry[] {
  const parsed = JSON.parse(text) as ReviewerRegistryFile | GovernanceReviewerRegistryEntry;
  const rawList = Array.isArray((parsed as ReviewerRegistryFile).reviewers)
    ? (parsed as ReviewerRegistryFile).reviewers!
    : [parsed];
  return rawList.map((raw, index) => validateGrantEntry(raw, `${path}[${index}]`));
}

function validateGrantEntry(raw: unknown, label: string): GovernanceReviewerRegistryEntry {
  const entry = raw as Partial<GovernanceReviewerRegistryEntry>;
  const id = entry.identity_ref?.id?.trim();
  const digest = entry.identity_ref?.content_hash?.digest?.trim();
  const algorithm = entry.identity_ref?.content_hash?.algorithm?.trim();
  if (!id || !digest || !algorithm) {
    throw new GovernanceReviewerIdentityError(
      `BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY: ${label} missing grant identity_ref`,
    );
  }
  if (entry.role !== "GOVERNANCE_REVIEWER") {
    throw new GovernanceReviewerIdentityError(
      `REJECT_DATASET_APPROVAL_REVIEWER_ROLE: ${label} role must be GOVERNANCE_REVIEWER`,
    );
  }
  return {
    identity_ref: {
      id,
      content_hash: { algorithm, digest },
    },
    role: "GOVERNANCE_REVIEWER",
  };
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
