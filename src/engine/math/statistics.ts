/**
 * Descriptive statistics engine.
 * All functions handle null/empty gracefully.
 * Documented with formulas.
 */

export interface DataSufficiencyWarning {
  code: 'DATA_INSUFFICIENT' | 'TOO_MANY_NULLS' | 'SINGLE_VALUE';
  message: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface DescriptiveStats {
  count: number;
  mean: number | null;
  median: number | null;

  mode: number[];
  variance: number | null;           // population variance
  sampleVariance: number | null;     // sample variance (n-1)
  stdDev: number | null;             // population
  sampleStdDev: number | null;       // sample (n-1)
  min: number | null;
  max: number | null;
  range: number | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  iqr: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  cv: number | null;                 // coefficient of variation = stdDev/mean
  warning?: DataSufficiencyWarning | null;
}

function cleanNumbers(data: (number | null | undefined)[]): number[] {
  return data.filter((v): v is number => v != null && isFinite(v));
}

/** Mean = Σx / n */
export function mean(data: (number | null | undefined)[]): number | null {
  const nums = cleanNumbers(data);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Median — middle value after sorting.
 * Uses linear interpolation for even n.
 */
export function median(data: (number | null | undefined)[]): number | null {
  const nums = cleanNumbers(data).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 !== 0
    ? (nums[mid] ?? 0)
    : ((nums[mid - 1] ?? 0) + (nums[mid] ?? 0)) / 2;
}

/** Mode — most frequent values (may return multiple) */
export function mode(data: (number | null | undefined)[]): number[] {
  const nums = cleanNumbers(data);
  if (nums.length === 0) return [];
  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1);
  const maxFreq = Math.max(...freq.values());
  if (maxFreq === 1) return []; // All values unique, no mode
  return [...freq.entries()].filter(([, f]) => f === maxFreq).map(([v]) => v);
}

/**
 * Population variance: Σ(x - μ)² / N
 */
export function populationVariance(data: (number | null | undefined)[]): number | null {
  const nums = cleanNumbers(data);
  if (nums.length < 2) return null;
  const μ = mean(nums)!;
  return nums.reduce((acc, x) => acc + Math.pow(x - μ, 2), 0) / nums.length;
}

/**
 * Sample variance: Σ(x - μ)² / (N - 1)
 * Use when data is a sample from a larger population.
 */
export function sampleVariance(data: (number | null | undefined)[]): number | null {
  const nums = cleanNumbers(data);
  if (nums.length < 2) return null;
  const μ = mean(nums)!;
  return nums.reduce((acc, x) => acc + Math.pow(x - μ, 2), 0) / (nums.length - 1);
}

export function stdDev(data: (number | null | undefined)[]): number | null {
  const v = populationVariance(data);
  return v != null ? Math.sqrt(v) : null;
}

export function sampleStdDev(data: (number | null | undefined)[]): number | null {
  const v = sampleVariance(data);
  return v != null ? Math.sqrt(v) : null;
}

/**
 * Percentile using linear interpolation.
 * @param p — percentile 0-100 (e.g., 90 for P90)
 * Algorithm: https://en.wikipedia.org/wiki/Percentile#Interpolation_between_closest_ranks
 */
export function percentile(data: (number | null | undefined)[], p: number): number | null {
  const nums = cleanNumbers(data).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  if (p <= 0) return nums[0] ?? null;
  if (p >= 100) return (nums[nums.length - 1] ?? 0);
  const index = (p / 100) * (nums.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return (nums[lower] ?? 0) * (1 - weight) + (nums[upper] ?? 0) * weight;
}

export function quartiles(data: (number | null | undefined)[]): {
  q1: number | null;
  q2: number | null;
  q3: number | null;
  iqr: number | null;
} {
  const q1 = percentile(data, 25);
  const q2 = percentile(data, 50);
  const q3 = percentile(data, 75);
  return {
    q1,
    q2,
    q3,
    iqr: q1 != null && q3 != null ? q3 - q1 : null,
  };
}

/** Coefficient of variation = stdDev / |mean| × 100 */
export function coefficientOfVariation(data: (number | null | undefined)[]): number | null {
  const sd = sampleStdDev(data);
  const m = mean(data);
  if (sd == null || m == null || m === 0) return null;
  return (sd / Math.abs(m)) * 100;
}

/** Full descriptive stats summary */
export function describe(data: (number | null | undefined)[]): DescriptiveStats {
  const nums = cleanNumbers(data);
  const q = quartiles(nums);
  const sd = stdDev(nums);
  const m = mean(nums);
  
  let warning: DataSufficiencyWarning | undefined;
  if (nums.length < 10) {
    warning = {
      code: 'DATA_INSUFFICIENT',
      message: `لا توجد بيانات كافية لهذا التحليل الإحصائي (${nums.length} سجل فقط، الحد الأدنى الموصى به 30)`,
      confidence: nums.length < 3 ? 'LOW' : 'MEDIUM',
    };
  }

  return {
    count: nums.length,
    mean: m,
    median: median(nums),
    mode: mode(nums),
    variance: populationVariance(nums),
    sampleVariance: sampleVariance(nums),
    stdDev: sd,
    sampleStdDev: sampleStdDev(nums),
    min: nums.length > 0 ? Math.min(...nums) : null,
    max: nums.length > 0 ? Math.max(...nums) : null,
    range: nums.length > 0 ? Math.max(...nums) - Math.min(...nums) : null,
    q1: q.q1,
    q2: q.q2,
    q3: q.q3,
    iqr: q.iqr,
    p90: percentile(nums, 90),
    p95: percentile(nums, 95),
    p99: percentile(nums, 99),
    cv: m != null && sd != null && m !== 0 ? (sd / Math.abs(m)) * 100 : null,
    warning,
  };
}

