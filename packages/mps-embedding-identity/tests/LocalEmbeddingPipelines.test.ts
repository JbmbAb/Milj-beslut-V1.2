/**
 * W-NO-GOOGLE-02A -- local embedding pipeline identity (RED first).
 *
 * The identity contract embed-identity-1 binds six fields and is NOT changed here. What is added
 * is the closed, frozen registry of the only two admitted LOCAL pipelines (the frozen A7
 * candidates BAAI/bge-m3 and intfloat/multilingual-e5-large) and the explicit 3072 -> 1024 identity
 * boundary: an identity is "local" only if its (model id, exact HF revision, pipeline version)
 * triple is exactly one registered pipeline. Anything else -- in particular every historical Google
 * identity -- is rejected, never reinterpreted.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindEmbeddingIdentity,
  EmbeddingIdentityError,
} from "../src/index";
import {
  LEGACY_GOOGLE_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_PIPELINES,
  assertLocalEmbeddingIdentity,
  bindLocalEmbeddingIdentity,
  computeSnapshotManifestSha256,
  findLocalEmbeddingPipeline,
  getLocalEmbeddingPipelineByKey,
  type SnapshotManifestFile,
} from "../src/LocalEmbeddingPipelines";

const WORKER_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../server/modules/legal/retrieval/localEmbeddingWorker.py",
);

const CHUNK = {
  fragment_id: "frag:abc",
  materialization_id: "mat:1",
  chunk_content_hash: "hash:abc",
} as const;

const GOOGLE_IDENTITY = bindEmbeddingIdentity({
  ...CHUNK,
  embedding_model_id: "gemini-embedding-001",
  embedding_model_version: "001",
  embedding_pipeline_version: "embed-pipeline-gemini-v1",
});

describe("local embedding pipeline registry", () => {
  it("admits exactly the two frozen A7 candidates and nothing else", () => {
    expect(LOCAL_EMBEDDING_PIPELINES.map((p) => p.key)).toEqual(["bge-m3", "multilingual-e5-large"]);
    expect(LOCAL_EMBEDDING_PIPELINES.map((p) => p.hf_repo)).toEqual([
      "BAAI/bge-m3",
      "intfloat/multilingual-e5-large",
    ]);
    expect(LOCAL_EMBEDDING_PIPELINES.map((p) => p.pipeline_version)).toEqual([
      "local-st-bge-m3-dense-v1",
      "local-st-multilingual-e5-large-v1",
    ]);
  });

  it("pins the exact Hugging Face revision of each candidate (full 40-hex commit)", () => {
    expect(getLocalEmbeddingPipelineByKey("bge-m3")?.hf_revision).toBe("5617a9f61b028005a4858fdac845db406aefb181");
    expect(getLocalEmbeddingPipelineByKey("multilingual-e5-large")?.hf_revision).toBe(
      "3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
    );
    for (const p of LOCAL_EMBEDDING_PIPELINES) expect(p.hf_revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is frozen: no entry can be added, replaced or edited at runtime", () => {
    expect(Object.isFrozen(LOCAL_EMBEDDING_PIPELINES)).toBe(true);
    for (const p of LOCAL_EMBEDDING_PIPELINES) expect(Object.isFrozen(p)).toBe(true);
  });

  it("makes the dimension boundary explicit: local is 1024, the Google history is 3072, they differ", () => {
    expect(LOCAL_EMBEDDING_DIMENSION).toBe(1024);
    expect(LEGACY_GOOGLE_EMBEDDING_DIMENSION).toBe(3072);
    expect(LOCAL_EMBEDDING_DIMENSION).not.toBe(LEGACY_GOOGLE_EMBEDDING_DIMENSION);
    for (const p of LOCAL_EMBEDDING_PIPELINES) {
      expect(p.dimension).toBe(1024);
      expect(p.normalization).toBe("l2");
    }
  });

  it("records the model-specific input convention as part of the fixed pipeline", () => {
    const bge = getLocalEmbeddingPipelineByKey("bge-m3")!;
    const e5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;
    expect([bge.query_prefix, bge.passage_prefix]).toEqual(["", ""]);
    expect([e5.query_prefix, e5.passage_prefix]).toEqual(["query: ", "passage: "]);
    expect(e5.max_seq_length).toBe(512);
  });

  it("offers no third candidate and no Google entry by key", () => {
    for (const key of ["gemini-embedding-001", "gemini-embedding-2", "text-embedding-004", "bge-large", "", "BGE-M3"]) {
      expect(getLocalEmbeddingPipelineByKey(key)).toBeUndefined();
    }
  });
});

describe("bindLocalEmbeddingIdentity", () => {
  it("binds the registered model, exact revision and pipeline into embed-identity-1", () => {
    const id = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    expect(id.embedding_model_id).toBe("BAAI/bge-m3");
    expect(id.embedding_model_version).toBe("5617a9f61b028005a4858fdac845db406aefb181");
    expect(id.embedding_pipeline_version).toBe("local-st-bge-m3-dense-v1");
    expect(id.contract_version).toBe("embed-identity-1");
    expect(id.embedding_identity_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and differs per local pipeline for the same chunk", () => {
    const a1 = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    const a2 = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    const b = bindLocalEmbeddingIdentity(CHUNK, "multilingual-e5-large");
    expect(a1.embedding_identity_hash).toBe(a2.embedding_identity_hash);
    expect(a1.embedding_identity_hash).not.toBe(b.embedding_identity_hash);
  });

  it("never collides with the historical Google identity of the same chunk", () => {
    for (const key of ["bge-m3", "multilingual-e5-large"] as const) {
      expect(bindLocalEmbeddingIdentity(CHUNK, key).embedding_identity_hash).not.toBe(
        GOOGLE_IDENTITY.embedding_identity_hash,
      );
    }
  });

  it("refuses a key that is not a registered local pipeline", () => {
    expect(() => bindLocalEmbeddingIdentity(CHUNK, "gemini-embedding-001" as never)).toThrow(EmbeddingIdentityError);
  });
});

describe("assertLocalEmbeddingIdentity -- historical Google values are never accepted as local", () => {
  it("accepts exactly the identities that bindLocalEmbeddingIdentity produces", () => {
    for (const key of ["bge-m3", "multilingual-e5-large"] as const) {
      const spec = assertLocalEmbeddingIdentity(bindLocalEmbeddingIdentity(CHUNK, key));
      expect(spec.key).toBe(key);
    }
  });

  it("rejects the historical Google identity (gemini-embedding-001 / 001 / embed-pipeline-gemini-v1)", () => {
    try {
      assertLocalEmbeddingIdentity(GOOGLE_IDENTITY);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingIdentityError);
      expect((error as EmbeddingIdentityError).code).toBe("EMBEDDING_IDENTITY_NOT_LOCAL");
    }
  });

  it("rejects the second historical Google model (gemini-embedding-2)", () => {
    const g2 = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: "gemini-embedding-2",
      embedding_model_version: "001",
      embedding_pipeline_version: "embed-pipeline-gemini-v1",
    });
    expect(() => assertLocalEmbeddingIdentity(g2)).toThrow(EmbeddingIdentityError);
  });

  it("rejects a local model id under a different revision (a revision bump is a new, explicit pipeline)", () => {
    const moved = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: "BAAI/bge-m3",
      embedding_model_version: "0".repeat(40),
      embedding_pipeline_version: "local-st-bge-m3-dense-v1",
    });
    expect(() => assertLocalEmbeddingIdentity(moved)).toThrow(EmbeddingIdentityError);
  });

  it("rejects a mixed triple (bge-m3 model under the e5 pipeline, and the reverse)", () => {
    const bge = getLocalEmbeddingPipelineByKey("bge-m3")!;
    const e5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;
    const mixed = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: bge.hf_repo,
      embedding_model_version: bge.hf_revision,
      embedding_pipeline_version: e5.pipeline_version,
    });
    const mixed2 = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: e5.hf_repo,
      embedding_model_version: e5.hf_revision,
      embedding_pipeline_version: bge.pipeline_version,
    });
    expect(() => assertLocalEmbeddingIdentity(mixed)).toThrow(EmbeddingIdentityError);
    expect(() => assertLocalEmbeddingIdentity(mixed2)).toThrow(EmbeddingIdentityError);
  });

  // Repair round (owner decision 3, A9): the hash re-derivation is its OWN branch. These cases carry a
  // fully registered local triple, so they cannot be satisfied by the earlier NOT_LOCAL check.
  it("a registered local triple with a wrong identity hash fails with EMBEDDING_IDENTITY_HASH_MISMATCH, not NOT_LOCAL", () => {
    for (const key of ["bge-m3", "multilingual-e5-large"] as const) {
      const good = bindLocalEmbeddingIdentity(CHUNK, key);
      expect(findLocalEmbeddingPipeline(good)?.key).toBe(key); // the triple really is local
      const forged = { ...good, embedding_identity_hash: "0".repeat(64) };
      try {
        assertLocalEmbeddingIdentity(forged);
        throw new Error("expected a throw");
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingIdentityError);
        expect((error as EmbeddingIdentityError).code).toBe("EMBEDDING_IDENTITY_HASH_MISMATCH");
      }
    }
  });

  it("a registered local triple whose chunk field was edited after binding fails with HASH_MISMATCH", () => {
    const good = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    const edited = { ...good, chunk_content_hash: "hash:other" };
    expect(findLocalEmbeddingPipeline(edited)?.key).toBe("bge-m3");
    try {
      assertLocalEmbeddingIdentity(edited);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as EmbeddingIdentityError).code).toBe("EMBEDDING_IDENTITY_HASH_MISMATCH");
    }
  });

  it("finds a pipeline only by the exact triple", () => {
    const bge = getLocalEmbeddingPipelineByKey("bge-m3")!;
    expect(
      findLocalEmbeddingPipeline({
        embedding_model_id: bge.hf_repo,
        embedding_model_version: bge.hf_revision,
        embedding_pipeline_version: bge.pipeline_version,
      })?.key,
    ).toBe("bge-m3");
    expect(
      findLocalEmbeddingPipeline({
        embedding_model_id: bge.hf_repo,
        embedding_model_version: bge.hf_revision,
        embedding_pipeline_version: "embed-pipeline-gemini-v1",
      }),
    ).toBeUndefined();
  });
});

// Repair round (owner decision 3, A4/A5): the worker -- not the caller -- establishes which pinned snapshot
// was loaded. Node pins the digest of the expected snapshot manifest; the worker holds the file list and
// measures the files on disk. Both sides must stay the same frozen definition.
interface WorkerRegistryEntry {
  readonly hf_repo: string;
  readonly hf_revision: string;
  readonly pipeline_version: string;
  readonly dimension: number;
  readonly files: readonly SnapshotManifestFile[];
}

function workerRegistry(): Record<string, WorkerRegistryEntry> {
  const source = fs.readFileSync(WORKER_FILE, "utf8");
  const begin = source.indexOf('_FROZEN_REGISTRY_JSON = r"""');
  expect(begin, "the worker must hold its frozen registry as a JSON literal").toBeGreaterThan(-1);
  const bodyStart = begin + '_FROZEN_REGISTRY_JSON = r"""'.length;
  const bodyEnd = source.indexOf('"""', bodyStart);
  const parsed = JSON.parse(source.slice(bodyStart, bodyEnd)) as { schema: string; pipelines: Record<string, WorkerRegistryEntry> };
  expect(parsed.schema).toBe("mimer-local-embedding-registry-1");
  return parsed.pipelines;
}

describe("pinned snapshot manifests -- the worker's frozen registry and the Node registry are one definition", () => {
  const EXPECTED_DIGEST = {
    "bge-m3": "3a2bfb3e454e9e86ff9aaeba900f4f76ef344ee73601021db65a4b9730e6bcdc",
    "multilingual-e5-large": "5d338fb073d0d9841782030aafaf996784bc1f44a2162fc76d0243253112a5e7",
  } as const;

  it("every registered pipeline pins the digest of its snapshot manifest (the Hugging Face verified file list)", () => {
    for (const p of LOCAL_EMBEDDING_PIPELINES) {
      expect(p.snapshot_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.snapshot_manifest_sha256).toBe(EXPECTED_DIGEST[p.key]);
    }
  });

  it("the worker's registry names exactly the same closed set of keys", () => {
    expect(Object.keys(workerRegistry()).sort()).toEqual(LOCAL_EMBEDDING_PIPELINES.map((p) => p.key).sort());
  });

  it.each(["bge-m3", "multilingual-e5-large"] as const)(
    "%s: repo, exact revision, pipeline and dimension agree, and the worker's file list hashes to the pinned digest",
    (key) => {
      const spec = getLocalEmbeddingPipelineByKey(key)!;
      const entry = workerRegistry()[key]!;
      expect(entry.hf_repo).toBe(spec.hf_repo);
      expect(entry.hf_revision).toBe(spec.hf_revision);
      expect(entry.pipeline_version).toBe(spec.pipeline_version);
      expect(entry.dimension).toBe(spec.dimension);
      expect(computeSnapshotManifestSha256(entry.files)).toBe(spec.snapshot_manifest_sha256);
    },
  );

  it("every manifest entry is a relative path with a known digest algorithm and a lowercase hex digest", () => {
    for (const entry of Object.values(workerRegistry())) {
      expect(entry.files.length).toBeGreaterThan(5);
      for (const f of entry.files) {
        expect(f.path).not.toMatch(/^\/|^[A-Za-z]:|\.\./);
        expect(["sha256", "git-blob-sha1"]).toContain(f.algo);
        expect(f.digest).toMatch(f.algo === "sha256" ? /^[0-9a-f]{64}$/ : /^[0-9a-f]{40}$/);
        expect(Number.isInteger(f.size) && f.size > 0).toBe(true);
      }
      expect(new Set(entry.files.map((f) => f.path)).size).toBe(entry.files.length);
    }
  });

  it("the manifest digest is order-independent but content-sensitive (it is a real binding, not a label)", () => {
    const files = workerRegistry()["bge-m3"]!.files;
    const reversed = [...files].reverse();
    expect(computeSnapshotManifestSha256(reversed)).toBe(computeSnapshotManifestSha256(files));
    const flipped = files.map((f, i) => (i === 0 ? { ...f, digest: f.digest.replace(/^./, (c) => (c === "0" ? "1" : "0")) } : f));
    expect(computeSnapshotManifestSha256(flipped)).not.toBe(computeSnapshotManifestSha256(files));
    expect(computeSnapshotManifestSha256(files.slice(1))).not.toBe(computeSnapshotManifestSha256(files));
  });

  it("the worker is configured by a closed model KEY only: it holds the mapping, the caller does not send repo/revision", () => {
    const source = fs.readFileSync(WORKER_FILE, "utf8");
    expect(source).toContain("MIMER_EMBED_MODEL_KEY");
    expect(source).not.toMatch(/MIMER_EMBED_REPO|MIMER_EMBED_REVISION|MIMER_EMBED_PIPELINE/);
  });
});
