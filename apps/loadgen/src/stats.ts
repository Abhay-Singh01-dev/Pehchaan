// Latency summaries for the load reports (spec 21.4): nearest-rank percentiles over the recorded samples.

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** The nearest-rank percentile of already sorted values (0 when there are none). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export class Samples {
  private values: number[] = [];

  add(ms: number): void {
    this.values.push(ms);
  }

  get count(): number {
    return this.values.length;
  }

  /** Summarises and, with `reset`, starts a new window (the capacity ramp measures each step on its own). */
  summary(reset = false): Summary {
    const sorted = [...this.values].sort((a, b) => a - b);
    if (reset) this.values = [];
    return {
      count: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  }
}
