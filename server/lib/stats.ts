export interface NumericStats {
  avg: number;
  count: number;
  variance: number;
}

/** Population variance (divide by n, not n-1). */
export function computeStats(values: number[]): NumericStats {
  const count = values.length;
  if (count === 0) {
    return { avg: 0, count: 0, variance: 0 };
  }
  const sum = values.reduce((s, v) => s + v, 0);
  const avg = sum / count;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / count;
  return { avg, count, variance };
}

export function computeMinMaxStats(values: number[]): NumericStats & { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, count: 0, variance: 0 };
  }
  const { avg, count, variance } = computeStats(values);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg,
    count,
    variance,
  };
}
