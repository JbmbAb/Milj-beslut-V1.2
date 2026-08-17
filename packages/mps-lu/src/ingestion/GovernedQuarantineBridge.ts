import { createHash } from "node:crypto";

import { sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel";
import type { RawSourceArtifact, RawSourcePayload } from "./RawSourceArtifact";

/**
 * 🜃 P3-LU-QUARANTINE-BRIDGE-01 — the authority boundary between P2 governed acquisition and LU.
 *
 * QUARANTINE_BRIDGE_PROVENANCE_V1
 *
 *   Every field of the produced RawSourceArtifact MUST be derivable from exactly one of:
 *     1. the stored quarantine bytes
 *     2. the stored quarantine metadata
 *     3. the signed SourceRegistry artifact named by `custom_metadata.registry_artifact_id`
 *
 *   No defaulted provenance. No hardcoded producer identity. No inferred authority. No
 *   fabricated timestamps. No policy reconstruction from runtime defaults.
 *
 * This is not a type adapter. It translates between two authority-bearing contracts, and the
 * temptation it exists to resist is filling a required field with a plausible constant —
 * `authority: "Domstolsverket"` from a lookup table would be exactly the defect class
 * P2-AUTH-00 closed when it caught the deleted harvester emitting a placeholder string in
 * place of a real registry signature.
 *
 * ⚠️ It holds NO persistence capability and writes nowhere. Producing a verifiable LU
 * representation is its entire job; promotion remains the governed path's business.
 *
 * @see ./RawSourceArtifact.ts (field semantics, frozen)
 * @see ../../../mps-data-governance/src/SourceRegistry.ts (the signed authority)
 */

/** The stored quarantine record, as `DiskQuarantineStorage` writes it. */
export interface GovernedQuarantineRecord {
  readonly quarantine_id: string;
  readonly source_id: string;
  readonly source_url: string;
  readonly file_name: string;
  readonly retrieved_at: string;
  readonly content_hash: string;
  readonly custom_metadata?: Record<string, unknown>;
}

/**
 * The subset of a verified registry this bridge may consult.
 *
 * Deliberately narrow: the bridge resolves an artifact id to its attested producer and nothing
 * else. A wider port would let it reach acquisition policy and be tempted to synthesise the
 * legacy `policy` field from it.
 */
export interface VerifiedSourceAuthorityLookup {
  /** Returns the verified entry for an artifact id, or null if it is not an approved authority. */
  findByArtifactId(artifactId: string): {
    readonly registryArtifactId: string;
    readonly sourceId: string;
    readonly authorityName: string;
  } | null;
}

export class QuarantineBridgeError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = "QuarantineBridgeError";
  }
}

export class GovernedQuarantineBridge {
  constructor(private readonly registry: VerifiedSourceAuthorityLookup) {}

  /**
   * Builds an LU RawSourceArtifact from governed quarantine material.
   *
   * Fails closed on every unsourceable field rather than substituting a value. A bridge that
   * degraded would produce an artifact whose provenance reads as attested when it is not.
   */
  materialize(record: GovernedQuarantineRecord, bytes: Uint8Array): RawSourceArtifact {
    // 1. Byte integrity. The stored hash must describe the bytes actually handed over —
    //    otherwise every downstream identity is built on unverified content.
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== record.content_hash) {
      throw new QuarantineBridgeError(
        `REJECT_CONTENT_HASH: quarantine '${record.quarantine_id}' records ` +
          `${record.content_hash} but the supplied bytes hash to ${actual}.`,
        "REJECT_CONTENT_HASH",
      );
    }

    // 2. The governance binding must be present. Material with no named acquiring authority
    //    cannot be given one here.
    const registryArtifactId = record.custom_metadata?.registry_artifact_id;
    if (typeof registryArtifactId !== "string" || registryArtifactId.length === 0) {
      throw new QuarantineBridgeError(
        `REJECT_MISSING_GOVERNANCE_REF: quarantine '${record.quarantine_id}' carries no ` +
          "custom_metadata.registry_artifact_id. The acquiring authority cannot be inferred " +
          "from the source_id, the URL, or the active registry.",
        "REJECT_MISSING_GOVERNANCE_REF",
      );
    }

    // 3. That binding must resolve to a VERIFIED, APPROVED registry artifact. Resolution is by
    //    the id the object was stored with — not by whichever entry is active now, so material
    //    acquired under a superseded authority keeps naming it.
    const authority = this.registry.findByArtifactId(registryArtifactId);
    if (!authority) {
      throw new QuarantineBridgeError(
        `REJECT_UNVERIFIED_AUTHORITY: '${registryArtifactId}' does not resolve to a verified ` +
          "APPROVED SourceRegistry artifact. Only an attested authority may supply provenance.",
        "REJECT_UNVERIFIED_AUTHORITY",
      );
    }

    // 4. The object and the authority must agree on which source this is. A quarantine record
    //    pointing at another source's authority is a provenance error, not a mapping detail.
    if (authority.sourceId !== record.source_id) {
      throw new QuarantineBridgeError(
        `REJECT_SOURCE_BINDING: quarantine '${record.quarantine_id}' declares source ` +
          `'${record.source_id}' but '${registryArtifactId}' governs '${authority.sourceId}'.`,
        "REJECT_SOURCE_BINDING",
      );
    }

    // 5. Authority identity comes from the attested producer name, never from a lookup table.
    if (!authority.authorityName) {
      throw new QuarantineBridgeError(
        `REJECT_UNSOURCEABLE_AUTHORITY: '${registryArtifactId}' carries no producer name, so ` +
          "payload.authority has no attested source.",
        "REJECT_UNSOURCEABLE_AUTHORITY",
      );
    }

    for (const [field, value] of [
      ["file_name", record.file_name],
      ["source_url", record.source_url],
      ["retrieved_at", record.retrieved_at],
    ] as const) {
      if (!value) {
        throw new QuarantineBridgeError(
          `REJECT_UNSOURCEABLE_FIELD: quarantine '${record.quarantine_id}' has no '${field}', ` +
            "and it must not be defaulted.",
          "REJECT_UNSOURCEABLE_FIELD",
        );
      }
    }

    const payload: RawSourcePayload = {
      filename: record.file_name,
      original_path: record.source_url,
      content_bytes_base64: Buffer.from(bytes).toString("base64"),
      // OBSERVATION_TIME per ADR-MIMER-FUTURE-POTENTIAL-INVARIANTS: `observed_at` and
      // `retrieved_at` are the same temporal class — when the collection system observed the
      // material. Proven from the taxonomy, not assumed from the field names.
      observed_at: record.retrieved_at,
      authority: authority.authorityName,
      source_governance_artifact_id: authority.registryArtifactId,
      source_content_hash: record.content_hash,
      // `policy` is deliberately OMITTED. It has no defined semantics and no authoritative
      // source; populating it would manufacture provenance.
    };

    return {
      artifact_id: `raw-${record.quarantine_id}`,
      artifact_type: "RAW_SOURCE_ARTIFACT",
      // Hashes the canonical payload — a DIFFERENT identity from payload.source_content_hash,
      // which hashes the acquired bytes. The two must never be compared to each other.
      content_hash: sha256ContentHash(payload),
      references: [],
      payload,
    };
  }
}
