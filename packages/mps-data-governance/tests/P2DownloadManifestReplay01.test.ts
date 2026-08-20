import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FileDownloadManifestStore,
  InMemoryDownloadManifestStore,
  type DownloadManifestStore,
} from "../src/DownloadManifestStore";
import { buildDownloadManifestRef } from "../src/DownloadManifestIdentity";
import type { DownloadManifest, DownloadedObject } from "../src/GovernedDownloadContracts";

/**
 * P2-DOWNLOAD-MANIFEST-REPLAY-01.
 *
 * Root cause (recon, read-only, before this fix): manifest IDENTITY already excluded
 * `generated_at`/`attempts`/`deduplicated` (Model 1 — DownloadManifest is a semantic acquisition
 * result, not one execution attempt — see the doc comments on DownloadManifest itself and on
 * EXECUTION_STATE_FIELDS). But PERSISTENCE compared the full raw body, which still includes those
 * fields. Two honest, independent live executions of the identical acquisition therefore landed
 * at the same identity/path but with different bodies, and were rejected as a "collision" even
 * though nothing identity-bearing had changed.
 *
 * The fix in DownloadManifestStore.ts makes both stores compare via the SAME canonical semantic
 * payload the identity hash already uses (`buildDownloadManifestIdentityPayload`), so identity
 * and persistence can no longer say different things about what counts as "the same manifest".
 *
 * @see ../src/DownloadManifestIdentity.ts
 * @see ../src/DownloadManifestStore.ts
 */
describe("P2-DOWNLOAD-MANIFEST-REPLAY-01 — semantic manifest replay", () => {
  function object(overrides: Partial<DownloadedObject> = {}): DownloadedObject {
    return {
      quarantine_id: "q-1",
      source_id: "regeringskansliet-sfs-1998-808",
      url: "https://rkrattsbaser.gov.se/sfst?bet=1998:808",
      file_name: "sfs-1998-808.html",
      content_hash: "a".repeat(64),
      byte_length: 12,
      deduplicated: false,
      attempts: 1,
      ...overrides,
    };
  }

  function manifest(overrides: {
    generated_at?: string;
    objects?: DownloadedObject[];
    execution_id?: string;
    source_id?: string;
  } = {}): DownloadManifest {
    return {
      manifest_version: 1,
      execution_id: overrides.execution_id ?? "exec-1",
      source_id: overrides.source_id ?? "regeringskansliet-sfs-1998-808",
      source_content_hash: "b".repeat(64),
      registry_artifact_id: "reg-rk-sfs-1998-808-001",
      objects: overrides.objects ?? [object()],
      generated_at: overrides.generated_at ?? "2026-08-17T00:00:00.000Z",
    };
  }

  function fileStore(): FileDownloadManifestStore {
    return new FileDownloadManifestStore(mkdtempSync(join(tmpdir(), "p2-replay-01-")));
  }

  const stores: readonly [string, () => DownloadManifestStore][] = [
    ["InMemoryDownloadManifestStore", () => new InMemoryDownloadManifestStore()],
    ["FileDownloadManifestStore", () => fileStore()],
  ];

  for (const [name, makeStore] of stores) {
    describe(name, () => {
      it("same objects, different generated_at (a genuine second live execution) — same identity, persist succeeds", async () => {
        const store = makeStore();
        const first = await store.persist(manifest({ generated_at: "2026-08-17T00:00:00.000Z" }));
        const second = await store.persist(manifest({ generated_at: "2026-08-19T14:00:00.000Z" }));

        expect(second).toEqual(first);
        const resolved = await store.resolve(first);
        expect(resolved).not.toBeNull();
      });

      it("same objects, deduplicated false then true — same identity, persist succeeds", async () => {
        const store = makeStore();
        const first = await store.persist(manifest({ objects: [object({ deduplicated: false })] }));
        const second = await store.persist(manifest({ objects: [object({ deduplicated: true })] }));

        expect(second).toEqual(first);
      });

      it("same objects, different attempts — same identity, persist succeeds", async () => {
        const store = makeStore();
        const first = await store.persist(manifest({ objects: [object({ attempts: 1 })] }));
        const second = await store.persist(manifest({ objects: [object({ attempts: 3 })] }));

        expect(second).toEqual(first);
      });

      it("changing an identity-bearing fact (object content_hash) produces a different identity, not a collision", async () => {
        const store = makeStore();
        const first = await store.persist(manifest({ objects: [object({ content_hash: "a".repeat(64) })] }));
        const second = await store.persist(manifest({ objects: [object({ content_hash: "c".repeat(64) })] }));

        expect(second.content_hash.digest).not.toBe(first.content_hash.digest);
        expect(await store.resolve(first)).not.toBeNull();
        expect(await store.resolve(second)).not.toBeNull();
      });

      it("changing an identity-bearing fact (source_id) produces a different identity, not a collision", async () => {
        const store = makeStore();
        const first = await store.persist(manifest({ source_id: "regeringskansliet-sfs-1998-808" }));
        const second = await store.persist(
          manifest({ source_id: "regeringskansliet-sfs-1998-899", objects: [object({ source_id: "regeringskansliet-sfs-1998-899" })] }),
        );

        expect(second.content_hash.digest).not.toBe(first.content_hash.digest);
      });
    });
  }

  it("InMemoryDownloadManifestStore: tampered identity-bearing content at the same identity still fails closed", async () => {
    const store = new InMemoryDownloadManifestStore();
    const real = manifest();
    const ref = buildDownloadManifestRef(real);

    // Seed the store's internal map directly with a body that claims the SAME identity digest
    // but carries a different identity-bearing fact (source_id) — simulating corrupted/tampered
    // storage rather than a second honest execution. Reaching into the private map is
    // deliberate: this proves the STORE's own comparison still rejects it, independent of how
    // the mismatched entry got there.
    const tampered: DownloadManifest = { ...real, source_id: "forged-source" };
    (store as unknown as { manifests: Map<string, string> }).manifests.set(
      ref.content_hash.digest,
      JSON.stringify(tampered),
    );

    await expect(store.persist(real)).rejects.toThrow(/hash collision/);
  });

  it("FileDownloadManifestStore: tampered identity-bearing content at the same identity still fails closed", async () => {
    const root = mkdtempSync(join(tmpdir(), "p2-replay-01-tamper-"));
    const store = new FileDownloadManifestStore(root);
    const real = manifest();
    const ref = buildDownloadManifestRef(real);

    const tampered: DownloadManifest = { ...real, source_id: "forged-source" };
    writeFileSync(join(root, `${ref.content_hash.digest}.json`), JSON.stringify(tampered), "utf8");

    // `validateResolvedManifest` recomputes identity from the on-disk bytes and catches the
    // mismatch before `sameSemanticManifest` is even reached — a stronger, earlier fail-closed
    // check than the one this unit adds, exercised here for the same reason: tampering must
    // still be refused, and it is.
    await expect(store.persist(real)).rejects.toThrow(/does not match reference/);
  });
});
