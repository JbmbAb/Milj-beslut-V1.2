import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeStrict } from "@miljobeslut/mimers-brunn-core";

import type { ContentReference } from "../../mps-core/src/types";
import type { DownloadManifest } from "./GovernedDownloadContracts";
import { buildDownloadManifestIdentityPayload, buildDownloadManifestRef } from "./DownloadManifestIdentity";

/**
 * P2_DOWNLOAD_MANIFEST_PERSISTENCE_V1.
 *
 * P2 owns the exact, content-addressed body of acquisition manifests. A manifest reference is
 * useful provenance only when it resolves back to the body whose identity it claims to bind.
 * This store has no corpus, CAS, promotion, or signing capability.
 */
export interface DownloadManifestStore {
  persist(manifest: DownloadManifest): Promise<ContentReference>;
  resolve(reference: ContentReference): Promise<DownloadManifest | null>;
}

/**
 * P2-DOWNLOAD-MANIFEST-REPLAY-01 — the canonical semantic comparison shared by every store.
 *
 * `DownloadManifest` represents WHAT was acquired, not HOW any one execution went (see the
 * `generated_at` doc comment on the type itself). `buildDownloadManifestIdentityPayload` already
 * encodes exactly that boundary for the identity hash; reusing it here — rather than a second,
 * independently-written notion of "same" — is what keeps identity and persistence from being able
 * to drift apart again. Two manifests at the same identity are the same download observed twice,
 * however many times `generated_at`/`attempts`/`deduplicated` differ between the observations.
 * A difference in any identity-bearing fact is still a hard rejection: this makes storage more
 * accepting of replay, not more tolerant of corruption.
 */
function sameSemanticManifest(a: DownloadManifest, b: DownloadManifest): boolean {
  return (
    canonicalizeStrict(buildDownloadManifestIdentityPayload(a)) ===
    canonicalizeStrict(buildDownloadManifestIdentityPayload(b))
  );
}

/** A deterministic test/runtime-independent implementation of the P2 persistence contract. */
export class InMemoryDownloadManifestStore implements DownloadManifestStore {
  private readonly manifests = new Map<string, string>();

  async persist(manifest: DownloadManifest): Promise<ContentReference> {
    const reference = buildDownloadManifestRef(manifest);
    const existingBody = this.manifests.get(reference.content_hash.digest);

    if (existingBody !== undefined) {
      const existing = JSON.parse(existingBody) as DownloadManifest;
      if (!sameSemanticManifest(existing, manifest)) {
        throw new Error(
          `Download manifest hash collision for '${reference.content_hash.digest}': existing body differs.`,
        );
      }
      // Same identity already persisted — this execution's own generated_at/attempts/deduplicated
      // are a second, equally valid observation of it, not a reason to overwrite the first.
      return reference;
    }

    this.manifests.set(reference.content_hash.digest, canonicalizeStrict(manifest));
    return reference;
  }

  async resolve(reference: ContentReference): Promise<DownloadManifest | null> {
    const body = this.manifests.get(reference.content_hash.digest);
    return body === undefined ? null : validateResolvedManifest(body, reference);
  }
}

/**
 * Disk-backed P2 manifest store used by the governed harvest runtime.
 *
 * Files are named by the identity digest, while the persisted body retains full execution and
 * provenance fields. A pre-existing file is always revalidated rather than trusted by name.
 */
export class FileDownloadManifestStore implements DownloadManifestStore {
  constructor(private readonly rootPath: string) {}

  async persist(manifest: DownloadManifest): Promise<ContentReference> {
    const reference = buildDownloadManifestRef(manifest);
    const body = canonicalizeStrict(manifest);
    const path = this.pathFor(reference);
    await mkdir(this.rootPath, { recursive: true });

    try {
      await writeFile(path, body, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;

      const existing = await readFile(path, "utf8");
      const resolved = validateResolvedManifest(existing, reference);
      if (!sameSemanticManifest(resolved, manifest)) {
        throw new Error(
          `Download manifest hash collision for '${reference.content_hash.digest}': existing body differs.`,
        );
      }
      // Same identity already on disk — a second live execution reaching the same acquisition
      // is a replay, not a conflict. The first-persisted body stays; it is an equally valid
      // observation of the same identity as this one.
    }

    return reference;
  }

  async resolve(reference: ContentReference): Promise<DownloadManifest | null> {
    try {
      return validateResolvedManifest(await readFile(this.pathFor(reference), "utf8"), reference);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private pathFor(reference: ContentReference): string {
    return join(this.rootPath, `${reference.content_hash.digest}.json`);
  }
}

/** Recomputes both the content hash and stable reference from persisted bytes. */
export function validateResolvedManifest(
  serialized: string,
  expected: ContentReference,
): DownloadManifest {
  let manifest: DownloadManifest;
  try {
    manifest = JSON.parse(serialized) as DownloadManifest;
  } catch {
    throw new Error(`Persisted download manifest '${expected.id}' is not valid JSON.`);
  }

  const actual = buildDownloadManifestRef(manifest);
  if (
    actual.id !== expected.id ||
    actual.content_hash.algorithm !== expected.content_hash.algorithm ||
    actual.content_hash.digest !== expected.content_hash.digest
  ) {
    throw new Error(
      `Persisted download manifest does not match reference '${expected.id}'.`,
    );
  }

  return manifest;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
