/**
 * RFM Analysis — Recency, Frequency, Monetary.
 * Segments customers/pilgrims by engagement and value.
 * Each dimension scored 1-5 (5 = best).
 */

import { percentile } from '../math/statistics';
import { roundTo } from '../math/arithmetic';

export interface RFMInput {
  id: string;
  label: string;                // customer/pilgrim name
  daysSinceLastActivity: number; // recency — lower is better
  activityCount: number;        // frequency — higher is better
  totalValue: number;           // monetary — higher is better
}

export interface RFMResult {
  id: string;
  label: string;
  recencyScore: number;        // 1-5
  frequencyScore: number;      // 1-5
  monetaryScore: number;       // 1-5
  rfmScore: number;            // weighted average 1-5
  segment: RFMSegment;
  daysSinceLastActivity: number;
  activityCount: number;
  totalValue: number;
}

export type RFMSegment =
  | 'CHAMPION'         // 5-5-5: most valuable, very recent
  | 'LOYAL'            // freq high, recent
  | 'POTENTIAL_LOYAL'  // recent, low freq
  | 'NEW_CUSTOMER'     // very recent, low freq+monetary
  | 'AT_RISK'          // good history but fading
  | 'HIBERNATING'      // low recency, some history
  | 'LOST'             // long gone, low engagement
  | 'OTHERS';

function scoreByPercentile(
  values: number[],
  target: number,
  higherIsBetter: boolean,
): number {
  // Assign 1-5 score based on which quintile the value falls in
  const p20 = percentile(values, 20)!;
  const p40 = percentile(values, 40)!;
  const p60 = percentile(values, 60)!;
  const p80 = percentile(values, 80)!;

  if (higherIsBetter) {
    if (target >= p80) return 5;
    if (target >= p60) return 4;
    if (target >= p40) return 3;
    if (target >= p20) return 2;
    return 1;
  } else {
    // Lower is better (e.g., recency days)
    if (target <= p20) return 5;
    if (target <= p40) return 4;
    if (target <= p60) return 3;
    if (target <= p80) return 2;
    return 1;
  }
}

function classifySegment(r: number, f: number, m: number): RFMSegment {
  if (r >= 4 && f >= 4 && m >= 4) return 'CHAMPION';
  if (r >= 3 && f >= 4) return 'LOYAL';
  if (r >= 4 && f <= 2) return 'NEW_CUSTOMER';
  if (r >= 4 && f >= 2 && f < 4) return 'POTENTIAL_LOYAL';
  if (r <= 2 && f >= 3) return 'AT_RISK';
  if (r <= 2 && f <= 2 && m >= 3) return 'HIBERNATING';
  if (r === 1 && f === 1) return 'LOST';
  return 'OTHERS';
}

export interface RFMSummary {
  results: RFMResult[];
  segments: Record<RFMSegment, { count: number; totalValue: number }>;
  averageRFMScore: number | null;
}

export function rfmAnalysis(inputs: RFMInput[]): RFMSummary {
  if (inputs.length === 0) {
    const emptySegments = {} as Record<RFMSegment, { count: number; totalValue: number }>;
    const segs: RFMSegment[] = ['CHAMPION', 'LOYAL', 'POTENTIAL_LOYAL', 'NEW_CUSTOMER', 'AT_RISK', 'HIBERNATING', 'LOST', 'OTHERS'];
    for (const s of segs) emptySegments[s] = { count: 0, totalValue: 0 };
    return { results: [], segments: emptySegments, averageRFMScore: null };
  }

  const recencyValues = inputs.map(i => i.daysSinceLastActivity);
  const freqValues = inputs.map(i => i.activityCount);
  const monetaryValues = inputs.map(i => i.totalValue);

  const results: RFMResult[] = inputs.map(input => {
    const r = scoreByPercentile(recencyValues, input.daysSinceLastActivity, false);
    const f = scoreByPercentile(freqValues, input.activityCount, true);
    const m = scoreByPercentile(monetaryValues, input.totalValue, true);
    const rfmScore = roundTo((r * 0.3 + f * 0.35 + m * 0.35), 2)!;
    return {
      id: input.id,
      label: input.label,
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      rfmScore,
      segment: classifySegment(r, f, m),
      daysSinceLastActivity: input.daysSinceLastActivity,
      activityCount: input.activityCount,
      totalValue: input.totalValue,
    };
  });

  const segs: RFMSegment[] = ['CHAMPION', 'LOYAL', 'POTENTIAL_LOYAL', 'NEW_CUSTOMER', 'AT_RISK', 'HIBERNATING', 'LOST', 'OTHERS'];
  const segments = {} as Record<RFMSegment, { count: number; totalValue: number }>;
  for (const s of segs) segments[s] = { count: 0, totalValue: 0 };
  for (const r of results) {
    segments[r.segment].count++;
    segments[r.segment].totalValue += r.totalValue;
  }

  const avgScore = results.length > 0
    ? roundTo(results.reduce((a, b) => a + b.rfmScore, 0) / results.length, 2)
    : null;

  return { results, segments, averageRFMScore: avgScore };
}
