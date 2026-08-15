import { describe, it, expect } from "vitest";

import {
  DOWNLOAD_MANIFEST_CANONICAL_VERSION,
  EXECUTION_STATE_FIELDS,
  buildDownloadManifestIdentityPayload,
  buildDownloadManifestRef,
  computeDownloadManifestHash,
} from "../src/DownloadManifestIdentity";
import type { DownloadManifest, DownloadedObject } from "../src/GovernedDownloadContracts";

/**
 * ✅ P2-EXEC-IDENTITY — DETERMINISTIC MANIFEST IDENTITY PROOF.
 *
 *   Invariant under test:
 *     The same bytes, from the same approved source, under the same governed contract SHALL
 *     produce the same manifest identity — however the run happened to go.
 *
 *   Root cause this closes: `deduplicated` and `attempts` were inside the hash domain. The
 *   first run stored the bytes and the second deduplicated them, so an identical download
 *   produced two identities. Reproducibility became unobservable exactly when it held.
 *
 *   Out of scope and untouched: the executor's public method surface, and the two
 *   GovernedWriteCapability findings.
 */
describe("P2-EXEC-IDENTITY — deterministic download manifest identity", () => {
  function object(overrides: Partial<DownloadedObject> = {}): DownloadedObject {
    return {
      quarantine_id: "q-1",
      source_id: "sgu-jordarter",
      url: "https://resource.sgu.se/a.gml",
      file_name: "a.gml",
      content_hash: "a".repeat(64),
      byte_length: 128,
      deduplicated: false,
      attempts: 1,
      ...overrides,
    };
  }

  function manifest(overrides: Partial<DownloadManifest> = {}): DownloadManifest {
    return {
      manifest_version: 1,
      execution_id: "exec-1",
      source_id: "sgu-jordarter",
      source_content_hash: "b".repeat(64),
      registry_artifact_id: "reg-sgu-001",
      objects: [object()],
      generated_at: "2026-08-13T10:00:00.000Z",
      ...overrides,
    };
  }

  // ------------------------------------------------------- EXECUTION STATE EXCLUDED

  it("a deduplicated re-run has the SAME identity as the run that stored the bytes", () => {
    const stored = manifest({ objects: [object({ deduplicated: false, attempts: 1 })] });
    const rerun = manifest({ objects: [object({ deduplicated: true, attempts: 1 })] });

    expect(
      computeDownloadManifestHash(rerun),
      "This is the defect verbatim: the first run stores, the second deduplicates, and the " +
        "download is identical. Different identities here make reproducibility unobservable " +
        "exactly when it holds.",
    ).toBe(computeDownloadManifestHash(stored));
  });

  it("a download that needed retries has the SAME identity as one that succeeded first time", () => {
    const firstTry = manifest({ objects: [object({ attempts: 1 })] });
    const afterRetries = manifest({ objects: [object({ attempts: 3 })] });

    expect(
      computeDownloadManifestHash(afterRetries),
      "How many attempts a transient fault cost is not a property of what was fetched.",
    ).toBe(computeDownloadManifestHash(firstTry));
  });

  it("wall-clock time does not affect identity", () => {
    expect(
      computeDownloadManifestHash(manifest({ generated_at: "2027-01-01T00:00:00.000Z" })),
      "IMPORT-TIME-001 / SV-I06: binding wall-clock time would mean replay can never match.",
    ).toBe(computeDownloadManifestHash(manifest()));
  });

  it("execution state is kept in the manifest, only excluded from identity", () => {
    const m = manifest({ objects: [object({ deduplicated: true, attempts: 4 })] });

    expect(m.objects[0].deduplicated).toBe(true);
    expect(m.objects[0].attempts).toBe(4);

    const identity = buildDownloadManifestIdentityPayload(m) as {
      objects: readonly Record<string, unknown>[];
    };
    for (const field of EXECUTION_STATE_FIELDS) {
      expect(
        identity.objects[0],
        `'${field}' records how the run went, not what it obtained.`,
      ).not.toHaveProperty(field);
    }
  });

  it("object ordering does not affect identity", () => {
    const a = object({ quarantine_id: "q-a", url: "https://resource.sgu.se/a.gml", content_hash: "a".repeat(64) });
    const b = object({ quarantine_id: "q-b", url: "https://resource.sgu.se/b.gml", content_hash: "c".repeat(64) });

    expect(
      computeDownloadManifestHash(manifest({ objects: [b, a] })),
      "The manifest describes the SET obtained under the contract. A resolver reordering its " +
        "output is not a different download.",
    ).toBe(computeDownloadManifestHash(manifest({ objects: [a, b] })));
  });

  // ------------------------------------------------------------- IDENTITY IS BOUND

  it("different bytes produce a different identity", () => {
    expect(
      computeDownloadManifestHash(manifest({ objects: [object({ content_hash: "f".repeat(64) })] })),
    ).not.toBe(computeDownloadManifestHash(manifest()));
  });

  it("a different target URL produces a different identity", () => {
    expect(
      computeDownloadManifestHash(
        manifest({ objects: [object({ url: "https://resource.sgu.se/other.gml" })] }),
      ),
    ).not.toBe(computeDownloadManifestHash(manifest()));
  });

  it("a different byte length produces a different identity", () => {
    expect(
      computeDownloadManifestHash(manifest({ objects: [object({ byte_length: 129 })] })),
    ).not.toBe(computeDownloadManifestHash(manifest()));
  });

  it("a re-approved source with different policy produces a different identity", () => {
    expect(
      computeDownloadManifestHash(manifest({ source_content_hash: "d".repeat(64) })),
      "The manifest binds WHICH registry entry authorised the run. Identical bytes fetched " +
        "under a different approval are not the same governed download.",
    ).not.toBe(computeDownloadManifestHash(manifest()));
  });

  it("a different registry artifact produces a different identity", () => {
    expect(
      computeDownloadManifestHash(manifest({ registry_artifact_id: "reg-other-001" })),
    ).not.toBe(computeDownloadManifestHash(manifest()));
  });

  it("an added object produces a different identity", () => {
    expect(
      computeDownloadManifestHash(
        manifest({ objects: [object(), object({ quarantine_id: "q-2", content_hash: "e".repeat(64) })] }),
      ),
    ).not.toBe(computeDownloadManifestHash(manifest()));
  });

  // ----------------------------------------------------------- CANONICAL VERSION

  it("the canonical version is inside the hash domain", () => {
    const payload = buildDownloadManifestIdentityPayload(manifest());
    const withoutVersion = JSON.stringify(payload);

    expect(DOWNLOAD_MANIFEST_CANONICAL_VERSION).toBe("dl-canonical-1");
    expect(
      computeDownloadManifestHash(manifest()),
      "C-02: the canonicalization rule belongs in the hash domain, not beside it, so two rules " +
        "can never collapse into one identity.",
    ).not.toBe(withoutVersion);
  });

  it("the reference is derived from the identity hash and is stable", () => {
    const ref = buildDownloadManifestRef(manifest());
    const again = buildDownloadManifestRef(manifest({ generated_at: "2030-01-01T00:00:00.000Z" }));

    expect(ref.content_hash.digest).toHaveLength(64);
    expect(ref.content_hash.digest).toBe(computeDownloadManifestHash(manifest()));
    expect(again.id, "the id embeds the digest, so it is stable too").toBe(ref.id);
  });
});
