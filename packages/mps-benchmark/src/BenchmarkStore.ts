import type { BenchmarkSuite } from "./BenchmarkTypes";

export class BenchmarkStore {
  private suites = new Map<string, BenchmarkSuite>();

  async registerSuite(suite: BenchmarkSuite): Promise<void> {
    this.suites.set(suite.benchmark_id, suite);
  }

  async getSuite(benchmark_id: string): Promise<BenchmarkSuite | null> {
    return this.suites.get(benchmark_id) ?? null;
  }

  async listSuites(): Promise<BenchmarkSuite[]> {
    return Array.from(this.suites.values());
  }
}
