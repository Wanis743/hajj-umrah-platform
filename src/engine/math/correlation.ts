/**
 * Pearson and Spearman correlation coefficients.
 * Both return null for insufficient data or zero variance.
 */

import { mean } from './statistics';

/**
 * Pearson correlation coefficient: r = Σ((x - μx)(y - μy)) / (n × σx × σy)
 * Range: -1 (perfect negative) to +1 (perfect positive)
 * Returns null if stddev of either series is 0
 */
export function pearsonCorrelation(
  x: (number | null)[],
  y: (number | null)[],
): { r: number | null; strength: string; direction: string } | null {
  // Pair-wise clean: both must be non-null
  const pairs: [number, number][] = x
    .map((xi, i) => [xi, y[i]] as [number | null, number | null])
    .filter((p): p is [number, number] => p[0] != null && p[1] != null);

  if (pairs.length < 5) return null; // insufficient data

  const xs = pairs.map(p => p[0]);
  const ys = pairs.map(p => p[1]);
  const n = pairs.length;

  const meanX = mean(xs)!;
  const meanY = mean(ys)!;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (const [xi, yi] of pairs) {
    const dx = xi - meanX;
    const dy = yi - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return { r: null, strength: 'none', direction: 'none' };

  const r = numerator / denom;
  return {
    r: Math.max(-1, Math.min(1, r)), // clamp to [-1, 1]
    strength: Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'weak',
    direction: r > 0 ? 'positive' : r < 0 ? 'negative' : 'none',
  };
}

/**
 * Spearman rank correlation — robust, non-parametric.
 * Less sensitive to outliers than Pearson.
 * rs = 1 - 6Σd²/(n(n²-1))
 */
export function spearmanCorrelation(
  x: (number | null)[],
  y: (number | null)[],
): { rs: number | null; strength: string; direction: string } | null {
  const pairs: [number, number][] = x
    .map((xi, i) => [xi, y[i]] as [number | null, number | null])
    .filter((p): p is [number, number] => p[0] != null && p[1] != null);

  if (pairs.length < 5) return null;

  const n = pairs.length;

  // Compute ranks
  const rankOf = (arr: number[]): number[] => {
    const sorted = [...arr].sort((a, b) => a - b);
    return arr.map(v => sorted.indexOf(v) + 1);
  };

  const xRanks = rankOf(pairs.map(p => p[0]));
  const yRanks = rankOf(pairs.map(p => p[1]));

  const sumD2 = xRanks.reduce((acc, rx, i) => acc + Math.pow(rx - yRanks[i], 2), 0);
  const rs = 1 - (6 * sumD2) / (n * (n * n - 1));

  return {
    rs: Math.max(-1, Math.min(1, rs)),
    strength: Math.abs(rs) >= 0.7 ? 'strong' : Math.abs(rs) >= 0.4 ? 'moderate' : 'weak',
    direction: rs > 0 ? 'positive' : rs < 0 ? 'negative' : 'none',
  };
}
