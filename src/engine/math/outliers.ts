import { mean, sampleStdDev, percentile } from './statistics';

export type OutlierMethod = 'IQR' | 'Z_SCORE' | 'MAD';

export interface OutlierResult {
  method: OutlierMethod;
  threshold: number;
  lower: number | null;
  upper: number | null;
  outliers: { value: number; index: number; reason: string }[];
  inliers: number[];
}

/**
 * IQR method: lower = Q1 - 1.5×IQR, upper = Q3 + 1.5×IQR
 * Standard Tukey fences.
 */
export function iqrOutliers(
  data: (number | null)[],
  multiplier = 1.5,
): OutlierResult {
  const nums = data.filter((v): v is number => v != null);
  const q1 = percentile(nums, 25)!;
  const q3 = percentile(nums, 75)!;
  const iqr = q3 - q1;
  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;
  const outliers: OutlierResult['outliers'] = [];
  const inliers: number[] = [];

  data.forEach((v, i) => {
    if (v == null) return;
    if (v < lower || v > upper) {
      outliers.push({ value: v, index: i, reason: v < lower ? 'BELOW_LOWER_FENCE' : 'ABOVE_UPPER_FENCE' });
    } else {
      inliers.push(v);
    }
  });

  return { method: 'IQR', threshold: multiplier, lower, upper, outliers, inliers };
}

/**
 * Z-score method: |z| > threshold
 * z = (x - μ) / σ
 */
export function zScoreOutliers(
  data: (number | null)[],
  threshold = 3,
): OutlierResult {
  const nums = data.filter((v): v is number => v != null);
  const μ = mean(nums);
  const σ = sampleStdDev(nums);
  const outliers: OutlierResult['outliers'] = [];
  const inliers: number[] = [];

  if (μ == null || σ == null || σ === 0) {
    return { method: 'Z_SCORE', threshold, lower: null, upper: null, outliers: [], inliers: nums };
  }

  data.forEach((v, i) => {
    if (v == null) return;
    const z = Math.abs((v - μ) / σ);
    if (z > threshold) {
      outliers.push({ value: v, index: i, reason: `Z=${z.toFixed(2)}` });
    } else {
      inliers.push(v);
    }
  });

  return {
    method: 'Z_SCORE',
    threshold,
    lower: μ - threshold * σ,
    upper: μ + threshold * σ,
    outliers,
    inliers,
  };
}

/**
 * MAD (Median Absolute Deviation) — robust to extreme outliers.
 * threshold × MAD / 0.6745
 */
export function madOutliers(
  data: (number | null)[],
  threshold = 3.5,
): OutlierResult {
  const nums = data.filter((v): v is number => v != null).sort((a, b) => a - b);
  const med = percentile(nums, 50)!;
  const deviations = nums.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = percentile(deviations, 50)!;
  const modifiedThreshold = (threshold * mad) / 0.6745;
  const lower = med - modifiedThreshold;
  const upper = med + modifiedThreshold;
  const outliers: OutlierResult['outliers'] = [];
  const inliers: number[] = [];

  data.forEach((v, i) => {
    if (v == null) return;
    if (v < lower || v > upper) {
      outliers.push({ value: v, index: i, reason: v < lower ? 'BELOW_MAD_FENCE' : 'ABOVE_MAD_FENCE' });
    } else {
      inliers.push(v);
    }
  });

  return { method: 'MAD', threshold, lower, upper, outliers, inliers };
}
