export class MetricsCollector {
  private timers = new Map<string, bigint>();
  private values: Record<string, any> = {};

  start(name: string): void {
    this.timers.set(name, process.hrtime.bigint());
  }

  stop(name: string): void {
    const start = this.timers.get(name);
    if (!start) return;
    const deltaNs = process.hrtime.bigint() - start;
    const deltaMs = Number(deltaNs) / 1_000_000;
    this.values[`${name}Ms`] = deltaMs;
    this.timers.delete(name);
  }

  inc(name: string, n = 1): void {
    this.values[name] = (this.values[name] || 0) + n;
  }

  set(name: string, v: any): void {
    this.values[name] = v;
  }

  export(): Record<string, any> {
    return { ...this.values };
  }
}
