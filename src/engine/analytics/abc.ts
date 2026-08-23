/**
 * ABC Analysis — Pareto classification of items by value.
 * A = top ~80% of total value, B = next ~15%, C = bottom ~5%.
 * Based on Pareto principle.
 */

import { roundTo } from '../math/arithmetic';

export type ABCCategory = 'A' | 'B' | 'C';

export interface ABCItem {
  id: string;
  label: string;
  value: number;
}

export interface ABCResult {
  id: string;
  label: string;
  value: number;
  category: ABCCategory;
  rank: number;
  cumulativeValue: number;
  cumulativePct: number;    // cumulative % of total value
  valuePct: number;         // this item's % of total value
}

export interface ABCSummary {
  results: ABCResult[];
  categories: {
    A: { count: number; valueTotal: number; valuePct: number };
    B: { count: number; valueTotal: number; valuePct: number };
    C: { count: number; valueTotal: number; valuePct: number };
  };
  thresholds: { A: number; B: number };  // cumulative % cutoffs used
  totalValue: number;
}

/**
 * Classify items by ABC analysis.
 * @param items — items with id, label, value
 * @param thresholdA — cumulative % for A category (default 80)
 * @param thresholdB — cumulative % for B category (default 95)
 */
export function abcAnalysis(
  items: ABCItem[],
  thresholdA = 80,
  thresholdB = 95,
): ABCSummary {
  if (items.length === 0) {
    return {
      results: [],
      categories: {
        A: { count: 0, valueTotal: 0, valuePct: 0 },
        B: { count: 0, valueTotal: 0, valuePct: 0 },
        C: { count: 0, valueTotal: 0, valuePct: 0 },
      },
      thresholds: { A: thresholdA, B: thresholdB },
      totalValue: 0,
    };
  }

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const totalValue = sorted.reduce((acc, i) => acc + Math.abs(i.value), 0);

  let cumulativeValue = 0;
  const results: ABCResult[] = sorted.map((item, idx) => {
    cumulativeValue += Math.abs(item.value);
    const cumulativePct = totalValue > 0 ? (cumulativeValue / totalValue) * 100 : 0;
    const valuePct = totalValue > 0 ? (Math.abs(item.value) / totalValue) * 100 : 0;
    const category: ABCCategory =
      cumulativePct <= thresholdA ? 'A' :
      cumulativePct <= thresholdB ? 'B' : 'C';

    return {
      id: item.id,
      label: item.label,
      value: item.value,
      category,
      rank: idx + 1,
      cumulativeValue: roundTo(cumulativeValue, 2)!,
      cumulativePct: roundTo(cumulativePct, 1)!,
      valuePct: roundTo(valuePct, 1)!,
    };
  });

  const catSummary = (cat: ABCCategory) => {
    const catItems = results.filter(r => r.category === cat);
    const valueTotal = catItems.reduce((a, i) => a + Math.abs(i.value), 0);
    return {
      count: catItems.length,
      valueTotal: roundTo(valueTotal, 2)!,
      valuePct: roundTo(totalValue > 0 ? (valueTotal / totalValue) * 100 : 0, 1)!,
    };
  };

  return {
    results,
    categories: { A: catSummary('A'), B: catSummary('B'), C: catSummary('C') },
    thresholds: { A: thresholdA, B: thresholdB },
    totalValue: roundTo(totalValue, 2)!,
  };
}
