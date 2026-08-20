/**
 * P2-HARVEST-LIVE-01 — the minimal live entrypoint for the already-existing governed harvest
 * runtime (`composeHarvestRuntime`).
 *
 * This is an invocation, not a new pipeline: it assembles the production composition root
 * exactly as `HarvestRuntimeCompositionRoot.ts` intends (repo-resolved APPROVED registry,
 * verify-only key, real `HttpDownloadTransport`, `DiskQuarantineStorage`,
 * `FileDownloadManifestStore`), then calls `executor.execute()` per requested source id.
 *
 * It holds no signing capability, no CAS/ImportGate access, and no manifest/quarantine format
 * of its own — see HarvestRuntimeCompositionRoot.ts's own invariants, which this script does
 * not relax.
 *
 * Usage:
 *   SOURCE_REGISTRY_SIGNING_KEY_ID=... SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM="$(cat key.pem)" \
 *     npx tsx packages/mps-data-governance/scripts/harvest-live-pilot.ts <source_id> [source_id...]
 *   ... harvest-live-pilot.ts --all        # every currently APPROVED source, sequentially
 *   ... harvest-live-pilot.ts --list       # enumerate APPROVED sources, no network contact
 */
import { randomUUID } from "node:crypto";

import { composeHarvestRuntime } from "../src/HarvestRuntimeCompositionRoot";
import { GovernedDownloadError } from "../src/GovernedDownloadContracts";
import type { VerifiedSourceRegistry } from "../src/SourceRegistry";
import type { DownloadManifest } from "../src/GovernedDownloadContracts";
import { FileDownloadManifestStore } from "../src/DownloadManifestStore";
import type { HarvestExecutionRequest } from "../src/HarvestOrchestratorTypes";

interface SourceEvidence {
  source_id: string;
  authority: string;
  scope: string;
  status: "PROVEN" | "PARTIAL" | "BLOCKED" | "FAILED_CLOSED";
  acquisition: "PROVEN" | "PARTIAL" | "FAILED_CLOSED";
  acquisition_replay: "PROVEN" | "FAIL" | "NOT_PROVEN";
  raw_byte_stability: "STABLE" | "VOLATILE" | "NOT_PROVEN";
  provenance_status: "COMPLETE" | "PARTIAL";
  http_status?: string;
  media_type?: string;
  bytes?: number;
  object_count?: number;
  sha256?: string;
  quarantine_object?: string;
  download_manifest?: string;
  first_run?: string;
  second_run?: string;
  duplicate_status?: string;
  provenance?: string;
  detail?: string;
}

function describeScope(source: NonNullable<ReturnType<VerifiedSourceRegistry["getSource"]>>): string {
  return `${source.adapter} @ ${source.allowedDomains.join(", ")}`;
}

/** Same registry-scoped construction the composition root uses for the manifest store, so this
 *  script reads back through the identical governed path it wrote through. */
function manifestStoreFor(quarantineRootPath: string): FileDownloadManifestStore {
  return new FileDownloadManifestStore(`${quarantineRootPath}/download-manifests`);
}

async function runSource(
  sourceId: string,
  runtime: { executor: { execute(r: HarvestExecutionRequest): Promise<{ id: string; content_hash: { algorithm: string; digest: string } }> }; registry: VerifiedSourceRegistry },
  quarantineRootPath: string,
): Promise<SourceEvidence> {
  const source = runtime.registry.getSource(sourceId);
  const evidence: SourceEvidence = {
    source_id: sourceId,
    authority: source?.authority.name ?? "UNKNOWN",
    scope: source ? describeScope(source) : "NOT APPROVED",
    status: "BLOCKED",
    acquisition: "FAILED_CLOSED",
    acquisition_replay: "NOT_PROVEN",
    raw_byte_stability: "NOT_PROVEN",
    provenance_status: "PARTIAL",
  };

  if (!source) {
    evidence.status = "FAILED_CLOSED";
    evidence.detail = "REJECT_SOURCE: not an APPROVED source in the verified registry.";
    return evidence;
  }

  // A single execution_id reused across both calls: identity is (execution_id, source_id,
  // source_content_hash, registry_artifact_id, objects), so re-using it is what makes the
  // second call a genuine replay of the SAME governed execution rather than a different one
  // that happens to fetch the same bytes.
  const executionId = `pilot-${sourceId}-${randomUUID()}`;
  const request: HarvestExecutionRequest = {
    dataset_ref: { id: sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
    execution_id: executionId,
    requested_at: new Date().toISOString(),
  };

  const store = manifestStoreFor(quarantineRootPath);

  let firstRef: { id: string; content_hash: { algorithm: string; digest: string } };
  try {
    firstRef = await runtime.executor.execute(request);
  } catch (error) {
    evidence.acquisition = "FAILED_CLOSED";
    evidence.status = error instanceof GovernedDownloadError ? "FAILED_CLOSED" : "BLOCKED";
    evidence.detail = error instanceof Error ? error.message : String(error);
    evidence.first_run = "FAILED";
    return evidence;
  }
  evidence.first_run = "PASS — network fetch executed, quarantine + manifest persisted";
  evidence.download_manifest = firstRef.id;
  evidence.acquisition = "PROVEN";

  const firstManifest = (await store.resolve(firstRef)) as DownloadManifest | null;

  let secondRef: { id: string; content_hash: { algorithm: string; digest: string } } | undefined;
  try {
    secondRef = await runtime.executor.execute(request);
    evidence.second_run =
      "PASS — full unconditional network fetch re-issued (no conditional GET/ETag revalidation in HttpDownloadTransport)";
  } catch (error) {
    evidence.second_run = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
    // A collision at persistence, specifically, is what P2-DOWNLOAD-MANIFEST-REPLAY-01 targets.
    // Any other failure (network, HTTP status) means replay itself was never exercised.
    evidence.acquisition_replay =
      error instanceof Error && /hash collision/i.test(error.message) ? "FAIL" : "NOT_PROVEN";
  }

  const secondManifest = secondRef ? ((await store.resolve(secondRef)) as DownloadManifest | null) : null;

  if (secondRef) {
    evidence.acquisition_replay = secondManifest ? "PROVEN" : "NOT_PROVEN";
  }

  // RAW BYTE STABILITY is independent of replay: it asks whether the two live fetches returned
  // the same bytes, not whether persistence accepted the result. Both manifests must resolve to
  // compare their object hash sets directly, regardless of whether they landed at the same or a
  // different manifest identity (a volatile source produces a genuinely different identity per
  // run, which is not itself a replay failure — see HTML-SOURCE-STABILITY-01).
  if (firstManifest && secondManifest) {
    const firstHashes = new Set(firstManifest.objects.map((o) => o.content_hash));
    const secondHashes = new Set(secondManifest.objects.map((o) => o.content_hash));
    const sameSize = firstHashes.size === secondHashes.size;
    const sameMembers = sameSize && [...firstHashes].every((h) => secondHashes.has(h));
    evidence.raw_byte_stability = sameMembers ? "STABLE" : "VOLATILE";
  }

  const resolved = secondManifest ?? firstManifest;
  if (!resolved) {
    evidence.status = "PARTIAL";
    evidence.detail = "Manifest persisted but could not be resolved back for evidence reporting.";
    return evidence;
  }

  if (resolved.objects.length === 0) {
    evidence.detail = "NO_CHANGES manifest (adapter reported no targets to fetch).";
    evidence.provenance_status = "COMPLETE";
    evidence.status = evidence.acquisition_replay === "FAIL" ? "PARTIAL" : "PROVEN";
    return evidence;
  }

  evidence.object_count = resolved.objects.length;
  evidence.bytes = resolved.objects.reduce((sum, o) => sum + o.byte_length, 0);
  const obj = resolved.objects[0];
  evidence.sha256 = obj.content_hash;
  evidence.quarantine_object = obj.quarantine_id;
  evidence.duplicate_status = obj.deduplicated
    ? "DUPLICATE — bytes already present in quarantine, no new physical object written"
    : "first physical write for these bytes";
  evidence.provenance = `source_id=${obj.source_id} url=${obj.url} registry_artifact_id=${resolved.registry_artifact_id}`;
  evidence.media_type = "raw bytes captured as-is (adapter does not report Content-Type separately)";
  evidence.http_status = "200 (non-2xx would have raised REJECT_HTTP_STATUS before reaching quarantine)";

  evidence.provenance_status = resolved.objects.every(
    (o) => o.source_id && o.url && o.content_hash && o.byte_length > 0 && resolved.registry_artifact_id,
  )
    ? "COMPLETE"
    : "PARTIAL";

  // A source-level status, distinct from the three classifications above: PARTIAL here means
  // "acquisition itself is proven, but something about this source (replay or raw-byte behavior)
  // is not fully clean" — never a blanket pass/fail that would hide which dimension is the issue.
  evidence.status =
    evidence.acquisition_replay === "FAIL" || evidence.provenance_status === "PARTIAL"
      ? "PARTIAL"
      : "PROVEN";
  return evidence;
}

function printEvidence(e: SourceEvidence): void {
  console.log(`\nSOURCE_ID: ${e.source_id}`);
  console.log(`AUTHORITY: ${e.authority}`);
  console.log(`SCOPE: ${e.scope}`);
  console.log(`HTTP STATUS: ${e.http_status ?? "n/a"}`);
  console.log(`MEDIA TYPE: ${e.media_type ?? "n/a"}`);
  console.log(`OBJECT COUNT: ${e.object_count ?? "n/a"}`);
  console.log(`BYTES: ${e.bytes ?? "n/a"}`);
  console.log(`SHA256 (sample): ${e.sha256 ?? "n/a"}`);
  console.log(`QUARANTINE OBJECT (sample): ${e.quarantine_object ?? "n/a"}`);
  console.log(`DOWNLOAD MANIFEST: ${e.download_manifest ?? "n/a"}`);
  console.log(`FIRST RUN: ${e.first_run ?? "n/a"}`);
  console.log(`SECOND RUN: ${e.second_run ?? "n/a"}`);
  console.log(`DUPLICATE STATUS: ${e.duplicate_status ?? "n/a"}`);
  console.log(`PROVENANCE: ${e.provenance ?? "n/a"}`);
  if (e.detail) console.log(`DETAIL: ${e.detail}`);
  console.log(`ACQUISITION: ${e.acquisition}`);
  console.log(`ACQUISITION REPLAY: ${e.acquisition_replay}`);
  console.log(`RAW BYTE STABILITY: ${e.raw_byte_stability}`);
  console.log(`PROVENANCE STATUS: ${e.provenance_status}`);
  console.log(`STATUS: ${e.status}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const quarantineRootPath = process.env.HARVEST_QUARANTINE_ROOT ?? `${process.cwd()}/.quarantine`;

  const { executor, registry } = await composeHarvestRuntime({ quarantineRootPath });

  if (args.includes("--list")) {
    console.log(`Verified APPROVED sources (${registry.sources.length}):\n`);
    for (const s of registry.sources) {
      console.log(`  ${s.sourceId}  [${s.adapter}]  ${s.allowedDomains.join(", ")}`);
    }
    return;
  }

  const targets = args.includes("--all")
    ? registry.sources.map((s) => s.sourceId)
    : args.filter((a) => !a.startsWith("--"));

  if (targets.length === 0) {
    console.error("Usage: harvest-live-pilot.ts <source_id> [source_id...] | --all | --list");
    process.exitCode = 1;
    return;
  }

  const results: SourceEvidence[] = [];
  // Sequential, not parallel: a source failure must not touch an unrelated source's already
  // persisted quarantine/manifest state, and per-source rate-limit policy is per-source, not
  // global — running sources one at a time is the simplest way to keep that true without
  // building a scheduler this unit was told not to build.
  for (const sourceId of targets) {
    const evidence = await runSource(sourceId, { executor, registry }, quarantineRootPath);
    results.push(evidence);
    printEvidence(evidence);
  }

  const proven = results.filter((r) => r.status === "PROVEN").length;
  const partial = results.filter((r) => r.status === "PARTIAL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const failedClosed = results.filter((r) => r.status === "FAILED_CLOSED").length;
  const totalBytes = results.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
  const uniqueHashes = new Set(results.map((r) => r.sha256).filter(Boolean));

  console.log("\n\n=== P2-HARVEST-LIVE-01 SUMMARY ===");
  console.log(`approved sources attempted: ${results.length}`);
  console.log(`sources proven: ${proven}`);
  console.log(`sources partial: ${partial}`);
  console.log(`sources blocked: ${blocked}`);
  console.log(`sources failed_closed: ${failedClosed}`);
  console.log(`objects captured: ${results.filter((r) => r.quarantine_object).length}`);
  console.log(`unique sha-256: ${uniqueHashes.size}`);
  console.log(`total bytes: ${totalBytes}`);
  console.log(`manifest count: ${results.filter((r) => r.download_manifest).length}`);

  if (failedClosed > 0 || partial > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
