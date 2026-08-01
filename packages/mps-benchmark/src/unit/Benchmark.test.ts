import { describe, expect, it } from "vitest";
import { BenchmarkStore, BenchmarkSuite } from "../index";

describe("Benchmark Store Suite", () => {
  it("should register and list benchmark suites deterministically", async () => {
    const store = new BenchmarkStore();

    const suite: BenchmarkSuite = {
      benchmark_id: "bench-pfas-v1",
      dataset: {
        dataset_id: "ds-pfas",
        dataset_hash: "hash-123",
      },
      target_accuracy_threshold: 0.95,
    };

    await store.registerSuite(suite);

    const retrieved = await store.getSuite("bench-pfas-v1");
    expect(retrieved).toEqual(suite);

    const list = await store.listSuites();
    expect(list).toHaveLength(1);
  });
});
