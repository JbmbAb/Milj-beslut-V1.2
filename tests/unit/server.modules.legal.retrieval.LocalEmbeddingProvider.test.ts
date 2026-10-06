/**
 * W-NO-GOOGLE-02A -- LocalEmbeddingProvider (RED first).
 *
 * The provider is the only embedding producer of the legal retrieval path. It is fully local: the
 * vectors come from a pinned, offline sentence-transformers runtime behind an injected transport.
 * It fails closed on every defect (no mock vector, no fallback provider, no padding/truncation to
 * reach a dimension) and it refuses to run unless the runtime proves it is exactly the pinned model.
 */
import { describe, expect, it, vi } from "vitest";
import { getLocalEmbeddingPipelineByKey } from "@miljobeslut/mps-embedding-identity";
import { EmbeddingProviderError } from "../../server/modules/legal/retrieval/EmbeddingProvider";
import {
  createLocalEmbeddingProvider,
  createLocalEmbeddingProviderFromEnv,
  type LocalEmbeddingRuntimeReport,
  type LocalEmbeddingTransport,
  type LocalEmbeddingWireRequest,
} from "../../server/modules/legal/retrieval/LocalEmbeddingProvider";

const BGE = getLocalEmbeddingPipelineByKey("bge-m3")!;
const E5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;

/** A unit vector of the given dimension (L2 norm exactly 1 up to float rounding). */
function unit(dim: number, hot = 0): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hot % dim] = 1;
  return v;
}

function runtimeFor(spec: typeof BGE, overrides: Partial<LocalEmbeddingRuntimeReport> = {}): LocalEmbeddingRuntimeReport {
  return {
    hf_repo: spec.hf_repo,
    hf_revision: spec.hf_revision,
    pipeline_version: spec.pipeline_version,
    dimension: 1024,
    normalization: "l2",
    device: "cuda:0",
    dtype: "float16",
    max_seq_length: spec.max_seq_length ?? 8192,
    truncated_count: 0,
    library_versions: { torch: "2.6.0+cu124", sentence_transformers: "6.1.0", transformers: "5.17.0" },
    ...overrides,
  };
}

function fakeTransport(
  spec: typeof BGE,
  build?: (req: LocalEmbeddingWireRequest) => { vectors: number[][]; runtime?: Partial<LocalEmbeddingRuntimeReport> },
) {
  const calls: LocalEmbeddingWireRequest[] = [];
  const transport: LocalEmbeddingTransport = {
    async embed(_spec, request) {
      calls.push(request);
      const built = build
        ? build(request)
        : { vectors: request.texts.map((_t, i) => unit(1024, i)), runtime: {} };
      return { runtime: runtimeFor(spec, built.runtime ?? {}), vectors: built.vectors };
    },
  };
  return { transport, calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EmbeddingProviderError);
    return (error as EmbeddingProviderError).code;
  }
  throw new Error("expected the call to throw an EmbeddingProviderError");
}

describe("LocalEmbeddingProvider -- identity and shape", () => {
  it("exposes the registered model, exact revision, pipeline and the 1024 dimension", () => {
    const { transport } = fakeTransport(BGE);
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(p.model_id).toBe("BAAI/bge-m3");
    expect(p.model_version).toBe("5617a9f61b028005a4858fdac845db406aefb181");
    expect(p.pipeline_version).toBe("local-st-bge-m3-dense-v1");
    expect(p.dimension).toBe(1024);
  });

  it("returns 1024-dimensional vectors, one per input, in input order", async () => {
    const { transport } = fakeTransport(BGE);
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    const out = await p.embedQueries(["a", "b", "c"]);
    expect(out).toHaveLength(3);
    for (const v of out) expect(v).toHaveLength(1024);
    expect(out[1]![1]).toBe(1);
  });

  it("does not call the runtime for an empty batch", async () => {
    const { transport, calls } = fakeTransport(BGE);
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await p.embedQueries([])).toEqual([]);
    expect(await p.embedPassages([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("refuses a key that is not one of the two frozen candidates", () => {
    const { transport } = fakeTransport(BGE);
    for (const key of ["gemini-embedding-001", "text-embedding-004", "bge-large", ""]) {
      expect(() => createLocalEmbeddingProvider({ key, transport })).toThrow(EmbeddingProviderError);
    }
  });
});

describe("LocalEmbeddingProvider -- input convention is part of the fixed pipeline", () => {
  it("bge-m3: no prefix for queries or passages; roles are passed to the runtime", async () => {
    const { transport, calls } = fakeTransport(BGE);
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    await p.embedQueries(["fråga"]);
    await p.embedPassages(["stycke"]);
    expect(calls.map((c) => [c.role, c.texts])).toEqual([
      ["query", ["fråga"]],
      ["passage", ["stycke"]],
    ]);
  });

  it('multilingual-e5-large: queries get exactly "query: ", passages exactly "passage: ", max_seq_length 512', async () => {
    const { transport, calls } = fakeTransport(E5);
    const p = createLocalEmbeddingProvider({ key: "multilingual-e5-large", transport });
    await p.embedQueries(["fråga"]);
    await p.embedPassages(["stycke"]);
    expect(calls.map((c) => [c.role, c.texts])).toEqual([
      ["query", ["query: fråga"]],
      ["passage", ["passage: stycke"]],
    ]);
    expect(calls.every((c) => c.max_seq_length === 512)).toBe(true);
  });
});

describe("LocalEmbeddingProvider -- 1024 can never be mixed with 3072 (no pad, no truncate)", () => {
  it("rejects a 3072-dimensional vector instead of truncating it to 1024", async () => {
    const { transport } = fakeTransport(BGE, (req) => ({ vectors: req.texts.map(() => unit(3072)) }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedQueries(["x"]))).toBe("EMBEDDING_DIMENSION_MISMATCH");
  });

  it("rejects a shorter vector instead of zero-padding it to 1024", async () => {
    const { transport } = fakeTransport(BGE, (req) => ({ vectors: req.texts.map(() => unit(768)) }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedPassages(["x"]))).toBe("EMBEDDING_DIMENSION_MISMATCH");
  });

  it("rejects one wrong-length vector anywhere in the batch (whole batch fails)", async () => {
    const { transport } = fakeTransport(BGE, (req) => ({
      vectors: req.texts.map((_t, i) => (i === 1 ? unit(1023) : unit(1024, i))),
    }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedPassages(["a", "b", "c"]))).toBe("EMBEDDING_DIMENSION_MISMATCH");
  });

  it("rejects a runtime that reports a dimension other than 1024 even if the vectors look fine", async () => {
    const { transport } = fakeTransport(BGE, (req) => ({ vectors: req.texts.map(() => unit(1024)), runtime: { dimension: 3072 } }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedQueries(["x"]))).toBe("EMBEDDING_RUNTIME_IDENTITY_MISMATCH");
  });
});

describe("LocalEmbeddingProvider -- the runtime must prove it is the pinned model", () => {
  it.each([
    ["hf_repo", { hf_repo: "intfloat/multilingual-e5-large" }],
    ["hf_revision", { hf_revision: "0".repeat(40) }],
    ["pipeline_version", { pipeline_version: "embed-pipeline-gemini-v1" }],
    ["normalization", { normalization: "none" as never }],
  ])("rejects a runtime report whose %s differs from the registered pipeline", async (_field, override) => {
    const { transport } = fakeTransport(BGE, (req) => ({ vectors: req.texts.map(() => unit(1024)), runtime: override }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedQueries(["x"]))).toBe("EMBEDDING_RUNTIME_IDENTITY_MISMATCH");
  });

  it("rejects e5 when the runtime did not apply the fixed max_seq_length of 512", async () => {
    const { transport } = fakeTransport(E5, (req) => ({ vectors: req.texts.map(() => unit(1024)), runtime: { max_seq_length: 8192 } }));
    const p = createLocalEmbeddingProvider({ key: "multilingual-e5-large", transport });
    expect(await codeOf(p.embedQueries(["x"]))).toBe("EMBEDDING_RUNTIME_IDENTITY_MISMATCH");
  });

  it("has no hidden CPU fallback: a required cuda device that ran on cpu is rejected", async () => {
    const { transport } = fakeTransport(BGE, (req) => ({ vectors: req.texts.map(() => unit(1024)), runtime: { device: "cpu" } }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport, requiredDevice: "cuda" });
    expect(await codeOf(p.embedQueries(["x"]))).toBe("EMBEDDING_RUNTIME_DEVICE_MISMATCH");
  });

  it("accepts cpu only when cpu was explicitly required", async () => {
    const { transport } = fakeTransport(BGE, (req) => ({ vectors: req.texts.map(() => unit(1024)), runtime: { device: "cpu" } }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport, requiredDevice: "cpu" });
    await expect(p.embedQueries(["x"])).resolves.toHaveLength(1);
  });

  it("keeps the last runtime report (versions, device, dtype, truncation) for the audit trail", async () => {
    const { transport } = fakeTransport(BGE);
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(p.last_runtime_report).toBeNull();
    await p.embedQueries(["x"]);
    expect(p.last_runtime_report?.library_versions.sentence_transformers).toBe("6.1.0");
    expect(p.last_runtime_report?.device).toBe("cuda:0");
  });
});

describe("LocalEmbeddingProvider -- fail closed, never fabricate", () => {
  it("rejects a vector count different from the input count", async () => {
    const { transport } = fakeTransport(BGE, () => ({ vectors: [unit(1024)] }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedQueries(["a", "b"]))).toBe("EMBEDDING_BATCH_SIZE_MISMATCH");
  });

  it("rejects non-finite components", async () => {
    const bad = unit(1024);
    bad[3] = Number.NaN;
    const { transport } = fakeTransport(BGE, () => ({ vectors: [bad] }));
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
    expect(await codeOf(p.embedQueries(["a"]))).toBe("EMBEDDING_NOT_FINITE");
  });

  it("rejects vectors that are not L2-normalised", async () => {
    const big = unit(1024).map((x) => x * 2);
    const zero = new Array<number>(1024).fill(0);
    for (const vector of [big, zero]) {
      const { transport } = fakeTransport(BGE, () => ({ vectors: [vector] }));
      const p = createLocalEmbeddingProvider({ key: "bge-m3", transport });
      expect(await codeOf(p.embedQueries(["a"]))).toBe("EMBEDDING_NOT_NORMALIZED");
    }
  });

  it("turns a runtime failure into EMBEDDING_LOCAL_RUNTIME_FAILED -- no vector, no mock, no second provider", async () => {
    const embed = vi.fn(async () => {
      throw new Error("worker exited with code 1");
    });
    const p = createLocalEmbeddingProvider({ key: "bge-m3", transport: { embed } });
    expect(await codeOf(p.embedQueries(["a"]))).toBe("EMBEDDING_LOCAL_RUNTIME_FAILED");
    expect(embed).toHaveBeenCalledTimes(1);
  });
});

describe("createLocalEmbeddingProviderFromEnv -- explicit configuration only, no Google, no default model", () => {
  const FULL = {
    MIMER_LOCAL_EMBEDDING_MODEL: "bge-m3",
    MIMER_LOCAL_EMBEDDING_PYTHON: "D:\\mimer-eval\\venv\\Scripts\\python.exe",
    MIMER_LOCAL_EMBEDDING_HF_HOME: "D:\\mimer-eval\\hf-cache",
  };

  it("does not guess a model: an unset model is EMBEDDING_PROVIDER_NOT_CONFIGURED", () => {
    try {
      createLocalEmbeddingProviderFromEnv({ ...FULL, MIMER_LOCAL_EMBEDDING_MODEL: undefined });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingProviderError);
      expect((error as EmbeddingProviderError).code).toBe("EMBEDDING_PROVIDER_NOT_CONFIGURED");
    }
  });

  it("is not satisfied by a Google key: with only a Google key present it still refuses", () => {
    expect(() => createLocalEmbeddingProviderFromEnv({ GEMINI_API_KEY: "present", GOOGLE_API_KEY: "present" })).toThrow(
      EmbeddingProviderError,
    );
  });

  it("rejects any model outside the two frozen candidates", () => {
    for (const model of ["gemini-embedding-001", "text-embedding-004", "BAAI/bge-large-en", "mock"]) {
      try {
        createLocalEmbeddingProviderFromEnv({ ...FULL, MIMER_LOCAL_EMBEDDING_MODEL: model });
        throw new Error("expected a throw for " + model);
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingProviderError);
        expect((error as EmbeddingProviderError).code).toBe("EMBEDDING_MODEL_NOT_ALLOWED");
      }
    }
  });

  it.each(["MIMER_LOCAL_EMBEDDING_PYTHON", "MIMER_LOCAL_EMBEDDING_HF_HOME"])("requires %s", (name) => {
    expect(() => createLocalEmbeddingProviderFromEnv({ ...FULL, [name]: undefined })).toThrow(EmbeddingProviderError);
  });

  it("rejects an unknown device value instead of defaulting", () => {
    expect(() => createLocalEmbeddingProviderFromEnv({ ...FULL, MIMER_LOCAL_EMBEDDING_DEVICE: "tpu" })).toThrow(
      EmbeddingProviderError,
    );
  });

  it("builds the provider without starting the runtime (the worker starts lazily on first use)", () => {
    const createTransport = vi.fn(() => ({ embed: vi.fn() }));
    const p = createLocalEmbeddingProviderFromEnv(FULL, { createTransport });
    expect(p.pipeline_version).toBe("local-st-bge-m3-dense-v1");
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0]![0]).toMatchObject({
      pythonPath: FULL.MIMER_LOCAL_EMBEDDING_PYTHON,
      hfHome: FULL.MIMER_LOCAL_EMBEDDING_HF_HOME,
      device: "cuda",
    });
  });
});
