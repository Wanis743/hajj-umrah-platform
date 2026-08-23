/**
 * Central arithmetic engine — all primitive math operations.
 * All functions are pure, null-safe, and handle edge cases explicitly.
 */

/** Safe division — returns null if denominator is 0 or null */
export function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

export function safeSum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export function safeMin(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length === 0 ? null : Math.min(...nums);
}

export function safeMax(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length === 0 ? null : Math.max(...nums);
}

export function safeRange(values: (number | null | undefined)[]): number | null {
  const min = safeMin(values);
  const max = safeMax(values);
  if (min == null || max == null) return null;
  return max - min;
}

export function safeAbsolute(value: number | null): number | null {
  if (value == null) return null;
  return Math.abs(value);
}

/**
 * Weighted average: Σ(value × weight) / Σ(weight)
 * Returns null if weights sum to 0 or inputs are empty
 */
export function weightedAverage(
  values: (number | null)[],
  weights: (number | null)[],
): number | null {
  if (values.length !== weights.length || values.length === 0) return null;
  let sumProducts = 0;
  let sumWeights = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const w = weights[i];
    if (v != null && w != null && w > 0) {
      sumProducts += v * w;
      sumWeights += w;
    }
  }
  return sumWeights === 0 ? null : sumProducts / sumWeights;
}

/**
 * Percentage change: (new - old) / |old| × 100
 * Returns null if old is 0 (explicitly, to prevent misleading ∞)
 */
export function percentageChange(oldValue: number | null, newValue: number | null): number | null {
  if (oldValue == null || newValue == null) return null;
  if (oldValue === 0) return null; // Cannot compute % change from 0
  return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
}

/** Percentage of total: value / total × 100 */
export function percentageOf(value: number | null, total: number | null): number | null {
  return safeDivide(value, total) !== null ? (safeDivide(value, total)! * 100) : null;
}

/** Round to N decimal places using standard rounding */
export function roundTo(value: number | null, decimals: number): number | null {
  if (value == null) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
