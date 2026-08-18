import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeStrict } from "@miljobeslut/mimers-brunn-core";

import type { ContentReference } from "../../mps-core/src/types";
import type { DownloadManifest } from "./GovernedDownloadContracts";
import { buildDownloadManifestRef } from "./DownloadManifestIdentity";

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

/** A deterministic test/runtime-independent implementation of the P2 persistence contract. */
export class InMemoryDownloadManifestStore implements DownloadManifestStore {
  private readonly manifests = new Map<string, string>();

  async persist(manifest: DownloadManifest): Promise<ContentReference> {
    const reference = buildDownloadManifestRef(manifest);
    const existing = this.manifests.get(reference.content_hash.digest);
    const body = canonicalizeStrict(manifest);

    if (existing !== undefined && existing !== body) {
      throw new Error(
        `Download manifest hash collision for '${reference.content_hash.digest}': existing body differs.`,
      );
    }

    this.manifests.set(reference.content_hash.digest, body);
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
      if (canonicalizeStrict(resolved) !== body) {
        throw new Error(
          `Download manifest hash collision for '${reference.content_hash.digest}': existing body differs.`,
        );
      }
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
