import { percentageChange, roundTo, safeDivide } from '../math/arithmetic';
import { grossMarginPct } from '../math/financial';

export type KPITrend = 'RISING' | 'FALLING' | 'STABLE' | 'VOLATILE' | 'ACCELERATING' | 'DECELERATING';
export type KPIStatus = 'GOOD' | 'WARNING' | 'CRITICAL' | 'NEUTRAL';
export type DataSourceBadge = 'LIVE' | 'IMPORTED' | 'MIXED' | 'FORECAST' | 'SCENARIO';

export interface KPIExplanation {
  formula: string;
  sources: string[];
  period: string;
  includedCount: number;
  excludedCount: number;
  freshnessMinutes: number;
  target?: number | undefined;
  previous?: number | undefined;
  change?: number | undefined;
}

export interface KPIResult {
  id: string;
  label: string;
  value: number | null;
  formatted: string;
  unit: string;
  change: number | null;       // % vs previous period
  trend: KPITrend;
  status: KPIStatus;
  badge: DataSourceBadge;
  explanation: KPIExplanation;
  precision: number;
}

export interface KPIInput {
  current: number | null;
  previous: number | null;
  target?: number | null;
  warningThreshold?: number;  // below this = WARNING
  criticalThreshold?: number; // below this = CRITICAL
  higherIsBetter?: boolean;   // default true
  unit?: string;
  precision?: number;
  sources?: string[];
  period?: string;
  freshnessMinutes?: number;
  includedCount?: number;
  excludedCount?: number;
  formula?: string;
  badge?: DataSourceBadge;
}

function determineTrend(change: number | null): KPITrend {
  if (change == null) return 'STABLE';
  if (Math.abs(change) < 1) return 'STABLE';
  if (change > 15) return 'ACCELERATING';
  if (change > 0) return 'RISING';
  if (change < -15) return 'DECELERATING';
  return 'FALLING';
}

function determineStatus(
  value: number | null,
  warningThreshold?: number,
  criticalThreshold?: number,
  higherIsBetter = true,
): KPIStatus {
  if (value == null) return 'NEUTRAL';
  if (criticalThreshold != null) {
    const isCritical = higherIsBetter ? value <= criticalThreshold : value >= criticalThreshold;
    if (isCritical) return 'CRITICAL';
  }
  if (warningThreshold != null) {
    const isWarning = higherIsBetter ? value <= warningThreshold : value >= warningThreshold;
    if (isWarning) return 'WARNING';
  }
  return 'GOOD';
}

function formatValue(value: number | null, unit: string, precision: number): string {
  if (value == null) return '—';
  const rounded = roundTo(value, precision)!;
  if (unit === '%') return `${rounded.toLocaleString()}%`;
  if (unit === 'DZD') return `${rounded.toLocaleString('fr-DZ')} دج`;
  if (unit === 'SAR') return `${rounded.toLocaleString()} ﷼`;
  return `${rounded.toLocaleString()}`;
}

export function buildKPI(
  id: string,
  label: string,
  input: KPIInput,
): KPIResult {
  const change = percentageChange(input.previous, input.current);
  const trend = determineTrend(change);
  const status = determineStatus(input.current, input.warningThreshold, input.criticalThreshold, input.higherIsBetter);
  const precision = input.precision ?? 0;
  const unit = input.unit ?? '';

  return {
    id,
    label,
    value: input.current,
    formatted: formatValue(input.current, unit, precision),
    unit,
    change: change != null ? roundTo(change, 1) : null,
    trend,
    status,
    badge: input.badge ?? 'LIVE',
    precision,
    explanation: {
      formula: input.formula ?? 'Sum of values in selected period',
      sources: input.sources ?? ['database'],
      period: input.period ?? 'current',
      includedCount: input.includedCount ?? 0,
      excludedCount: input.excludedCount ?? 0,
      freshnessMinutes: input.freshnessMinutes ?? 0,
      target: input.target ?? undefined,
      previous: input.previous ?? undefined,
      change: change ?? undefined,
    },
  };
}

// ── Pre-built KPI factories ──────────────────────────────────────────────────

export function revenueKPI(current: number | null, previous: number | null, includedCount = 0): KPIResult {
  return buildKPI('revenue', 'الإيرادات', {
    current, previous, unit: 'DZD', precision: 0,
    formula: 'Σ(accounting revenue in period from journal entries)',
    warningThreshold: 0, criticalThreshold: 0,
    sources: ['journal_entries'],
    includedCount,
  });
}

export function pilgrymCountKPI(current: number | null, previous: number | null): KPIResult {
  return buildKPI('pilgrim_count', 'عدد الحجاج', {
    current, previous, unit: 'حاج', precision: 0,
    formula: 'COUNT(pilgrims WHERE status != CANCELLED)',
    sources: ['pilgrims'],
  });
}

export function grossMarginKPI(revenue: number | null, cost: number | null, prevRevenue: number | null, prevCost: number | null): KPIResult {
  const current = grossMarginPct(revenue, cost);
  const previous = grossMarginPct(prevRevenue, prevCost);
  return buildKPI('gross_margin', 'هامش الربح', {
    current, previous, unit: '%', precision: 1,
    formula: '(Revenue - Cost) / Revenue × 100',
    warningThreshold: 10, criticalThreshold: 5,
    sources: ['bookings', 'supplier_bills'],
  });
}

export function collectionRateKPI(collected: number | null, expected: number | null): KPIResult {
  const current = collected != null && expected != null && expected > 0
    ? (collected / expected) * 100 : null;
  return buildKPI('collection_rate', 'نسبة التحصيل', {
    current, previous: null, unit: '%', precision: 1,
    formula: 'Σ(payments) / Σ(expected booking amounts) × 100',
    warningThreshold: 70, criticalThreshold: 50,
    sources: ['payments', 'bookings'],
  });
}

export function visaReadinessKPI(ready: number | null, total: number | null): KPIResult {
  const current = ready != null && total != null && total > 0 ? (ready / total) * 100 : null;
  return buildKPI('visa_readiness', 'جاهزية التأشيرات', {
    current, previous: null, unit: '%', precision: 1,
    formula: 'COUNT(visa_status IN [ISSUED,APPROVED]) / COUNT(total pilgrims) × 100',
    warningThreshold: 80, criticalThreshold: 60,
    sources: ['pilgrims'],
  });
}
