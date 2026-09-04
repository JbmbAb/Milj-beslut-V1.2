/**
 * GOVERNED-HARVEST-CANONICAL-ENTRYPOINT — approved-source adapter contract.
 *
 * Part 3 of the K1 unit (see
 * docs/architecture/KNOWLEDGE-INGESTION-REACHABILITY-AUDIT-2026-09-05.md, "Owner review"
 * section): every currently APPROVED source in `source-registry/national-registry.json` must
 * resolve to exactly one explicit disposition. This is deliberately NOT "every source must be
 * instantiable by the same adapter factory" — `ARCHIVE_IMPORT_V1` sources are correctly routed
 * elsewhere by design (see `GovernedHarvestRuntime.execute()` in
 * `./HarvestRuntimeCompositionRoot.ts`, which rejects `ARCHIVE_IMPORT` channels with
 * `REJECT_ARCHIVE_IMPORT_NETWORK_HARVEST` — behaviorally proven in
 * `packages/mps-data-governance/tests/SourceChannelArchiveImport.test.ts`, not re-proven here).
 *
 * Three dispositions:
 *   EXECUTABLE_BY_GOVERNED_RUNTIME — the source's `adapter` has a registered resolver in
 *     `PRODUCTION_ADAPTER_RESOLVERS` and the source is network-harvestable through
 *     `composeHarvestRuntime()`.
 *   INTENTIONALLY_ROUTED_ELSEWHERE — the source is `ARCHIVE_IMPORT`; it must never be attempted
 *     through the network harvest runtime at all, by design.
 *   FAIL_CLOSED — the adapter IS registered (structurally wired), but the live external
 *     endpoint is known, as of the stated date, to be non-functional. This is an operational
 *     fact about the outside world, not a code gap, and is not re-verified live by the coverage
 *     check below (that would require a network call inside a unit test).
 *
 * This table is deliberately hand-authored and reviewed, not derived automatically: which
 * disposition a source deserves is a judgment call (most concretely for FAIL_CLOSED, which
 * depends on live endpoint health at a point in time), not something that can be inferred purely
 * from static registry fields.
 */

import type { AdapterResolverFactory } from "./HarvestRuntimeCompositionRoot";

export type SourceDisposition =
  | "EXECUTABLE_BY_GOVERNED_RUNTIME"
  | "INTENTIONALLY_ROUTED_ELSEWHERE"
  | "FAIL_CLOSED";

export interface SourceDispositionEntry {
  readonly disposition: SourceDisposition;
  readonly reason: string;
  /** Date this disposition was last reviewed against live evidence (YYYY-MM-DD). */
  readonly as_of: string;
}

/**
 * Minimal shape this module needs from a registry entry — deliberately not importing
 * `VerifiedSourceDefinition` here, so this table can be checked against either the cryptographically
 * verified registry or a raw read of `national-registry.json` (the latter is what the coverage
 * test below actually uses, since it does not have production signing key material available).
 */
export interface DispositionCheckableSource {
  readonly sourceId: string;
  readonly adapter: string;
  readonly channelType: string;
}

export const SOURCE_DISPOSITIONS: Readonly<Record<string, SourceDispositionEntry>> = Object.freeze({
  "domstolsverket-puh-mmod": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "PUH_RATTSPRAXIS_V1 resolver registered; live-network PROVEN 2026-08-20 (P2-HARVEST-LIVE-01-PROVEN.md).",
    as_of: "2026-09-05",
  },
  "regeringskansliet-sfs-1998-808": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "regeringskansliet-sfs-2013-251": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "regeringskansliet-sfs-2020-614": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "regeringskansliet-sfs-2010-900": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "regeringskansliet-sfs-2011-338": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "regeringskansliet-sfs-1998-899": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "hav-hvmfs-2016-17": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "sgu-groundwater-influence-analytical-models": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "sgu-well-drilling-guidance": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason: "SINGLE_ENDPOINT_V1 resolver registered; live-network PROVEN 2026-08-20.",
    as_of: "2026-09-05",
  },
  "boverket-planbestammelser": {
    disposition: "FAIL_CLOSED",
    reason:
      "SINGLE_ENDPOINT_V1 resolver registered (structurally wired), but its registered endpoint " +
      "(api.boverket.se/planbestammelser/v2/json) returned a non-2xx status as of the 2026-08-20 " +
      "P2-HARVEST-LIVE-01-PROVEN.md run — the executor correctly fails closed rather than " +
      "silently succeeding or falling back. Tracked separately as BOVERKET-SOURCE-REDISCOVERY-01. " +
      "Not re-verified live by the offline coverage check below.",
    as_of: "2026-09-05",
  },
  "lantmateriet-stac-byggnader": {
    disposition: "EXECUTABLE_BY_GOVERNED_RUNTIME",
    reason:
      "LM_STAC_BYGGNADER_V1 resolver registered; unit-tested with a mocked fetchImpl " +
      "(P2LmStacRuntimeComposition.test.ts) but not yet exercised against the live endpoint — " +
      "structurally executable, live-network proof still open.",
    as_of: "2026-09-05",
  },
  "falkenbergs-kommun-mhn-decisions": {
    disposition: "INTENTIONALLY_ROUTED_ELSEWHERE",
    reason:
      "ARCHIVE_IMPORT channel; GovernedHarvestRuntime.execute() rejects ARCHIVE_IMPORT sources " +
      "with REJECT_ARCHIVE_IMPORT_NETWORK_HARVEST by design. Enters only through the explicit " +
      "governed archive-import path (see LegacyMasterAdmission.ts / " +
      "SourceChannelArchiveImport.test.ts), never network harvest.",
    as_of: "2026-09-05",
  },
});

export interface DispositionCoverageResult {
  readonly uncovered: readonly string[];
  readonly misclassifiedArchiveImport: readonly string[];
  readonly misclassifiedNetworkAdapterMissing: readonly string[];
}

/**
 * Checks a list of currently-approved sources against `SOURCE_DISPOSITIONS`. Returns non-empty
 * arrays only on a real gap — a new approved source with no assigned disposition, an
 * ARCHIVE_IMPORT source not marked INTENTIONALLY_ROUTED_ELSEWHERE, or a
 * network-disposition source whose adapter has no registered resolver.
 */
export function checkDispositionCoverage(
  sources: readonly DispositionCheckableSource[],
  adapterResolvers: Readonly<Record<string, AdapterResolverFactory>>,
): DispositionCoverageResult {
  const uncovered: string[] = [];
  const misclassifiedArchiveImport: string[] = [];
  const misclassifiedNetworkAdapterMissing: string[] = [];

  for (const source of sources) {
    const entry = SOURCE_DISPOSITIONS[source.sourceId];
    if (!entry) {
      uncovered.push(source.sourceId);
      continue;
    }

    const isArchiveImport = source.channelType === "ARCHIVE_IMPORT";

    if (isArchiveImport && entry.disposition !== "INTENTIONALLY_ROUTED_ELSEWHERE") {
      misclassifiedArchiveImport.push(source.sourceId);
      continue;
    }
    if (!isArchiveImport && entry.disposition === "INTENTIONALLY_ROUTED_ELSEWHERE") {
      misclassifiedArchiveImport.push(source.sourceId);
      continue;
    }

    if (
      (entry.disposition === "EXECUTABLE_BY_GOVERNED_RUNTIME" || entry.disposition === "FAIL_CLOSED") &&
      !(source.adapter in adapterResolvers)
    ) {
      misclassifiedNetworkAdapterMissing.push(source.sourceId);
    }
  }

  return { uncovered, misclassifiedArchiveImport, misclassifiedNetworkAdapterMissing };
}
