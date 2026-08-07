/**
 * Package 22.3 — Seed failure codes (registry_version "1").
 * F22-6: each code has exactly one semantic meaning forever.
 * Meaning change ⇒ new code (+ deprecate old). Never redefine in place.
 */

import type { FailureCodeDefinition } from "../FailureCodeTypes.js";

/** Registry catalog version — bump only when the catalog set changes in a governed release. */
export const FAILURE_CODE_REGISTRY_VERSION = "1" as const;

/**
 * Canonical seed definitions for registry_version "1".
 * Do not mutate meanings in place — add new codes instead.
 */
export const FAILURE_CODE_DEFINITIONS_V1: readonly FailureCodeDefinition[] = Object.freeze([
  Object.freeze({
    code: "MPS-HARVEST-001",
    category: "IMPORT_GATE",
    severity: "ERROR",
    retry_policy: "NONE",
    ownership: "GOVERNANCE",
    remediation: "Fix invalid spatial geometry",
    introduced_version: "22.3",
    summary: "Invalid geometry during import gate",
  }),
  Object.freeze({
    code: "MPS-HARVEST-002",
    category: "IMPORT_GATE",
    severity: "ERROR",
    retry_policy: "MANUAL",
    ownership: "GOVERNANCE",
    remediation: "Provide or correct CRS transformation",
    introduced_version: "22.3",
    summary: "Missing CRS transformation",
  }),
  Object.freeze({
    code: "MPS-HARVEST-003",
    category: "VERIFY",
    severity: "ERROR",
    retry_policy: "NONE",
    ownership: "GOVERNANCE",
    remediation: "Resolve content hash mismatch against CAS evidence",
    introduced_version: "22.3",
    summary: "Content integrity verification failed",
  }),
  Object.freeze({
    code: "MPS-HARVEST-004",
    category: "COMPLIANCE",
    severity: "CRITICAL",
    retry_policy: "NONE",
    ownership: "POLICY",
    remediation: "Obtain required approval or adjust policy scope",
    introduced_version: "22.3",
    summary: "Compliance gate blocked execution",
  }),
  Object.freeze({
    code: "MPS-HARVEST-005",
    category: "INGESTION",
    severity: "WARNING",
    retry_policy: "AUTOMATIC",
    ownership: "INGESTION",
    remediation: "Retry harvest after transient source unavailability",
    introduced_version: "22.3",
    summary: "Transient source unavailability",
  }),
]) as readonly FailureCodeDefinition[];
