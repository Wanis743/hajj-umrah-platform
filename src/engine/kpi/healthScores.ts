/**
 * Agency Health Score Engine
 * Computes 5 composite health scores for the executive dashboard.
 * Each score is 0–100. Sources are documented for each score.
 */

import {  roundTo, clamp } from '../math/arithmetic';

export type HealthLevel = 'CRITICAL' | 'WARNING' | 'GOOD' | 'EXCELLENT';

export interface HealthScore {
  id: string;
  nameAr: string;
  nameFr: string;
  nameEn: string;
  score: number | null;           // 0–100
  level: HealthLevel;
  components: {
    name: string;
    value: number | null;
    weight: number;              // 0–1
    contribution: number | null; // score contribution
  }[];
  explanation: string;           // Arabic explanation
  sources: string[];
  warning?: string;
}

function level(score: number | null): HealthLevel {
  if (score == null) return 'CRITICAL';
  if (score >= 80) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'WARNING';
  return 'CRITICAL';
}

function pct(value: number | null, max: number | null): number | null {
  if (value == null || max == null || max === 0) return null;
  return clamp((value / max) * 100, 0, 100);
}

// ── Financial Health (صحة مالية) ───────────────────────────────────────

export interface FinancialHealthInput {
  totalRevenue: number | null;
  totalCollected: number | null;       // actual payments received
  totalCost: number | null;
  overdueReceivables: number | null;
  totalReceivables: number | null;
}

export function financialHealth(input: FinancialHealthInput): HealthScore {
  const { totalRevenue, totalCollected, totalCost, overdueReceivables, totalReceivables } = input;

  const collectionRate = pct(totalCollected, totalRevenue); // 40%
  const marginScore = totalRevenue != null && totalCost != null && totalRevenue > 0
    ? clamp(((totalRevenue - totalCost) / totalRevenue) * 500, 0, 100) : null; // 30%
  const overdueScore = overdueReceivables != null && totalReceivables != null && totalReceivables > 0
    ? clamp(100 - (overdueReceivables / totalReceivables) * 200, 0, 100) : null; // 30%

  const components = [
    { name: 'نسبة التحصيل', value: collectionRate, weight: 0.40, contribution: collectionRate != null ? collectionRate * 0.40 : null },
    { name: 'هامش الربح', value: marginScore, weight: 0.30, contribution: marginScore != null ? marginScore * 0.30 : null },
    { name: 'تأخير المستحقات', value: overdueScore, weight: 0.30, contribution: overdueScore != null ? overdueScore * 0.30 : null },
  ];

  const defined = components.filter(c => c.contribution != null);
  const score = defined.length > 0
    ? roundTo(defined.reduce((a, c) => a + (c.contribution ?? 0), 0) / defined.reduce((a, c) => a + c.weight, 0), 0)
    : null;

  return {
    id: 'financial',
    nameAr: 'صحة مالية',
    nameFr: 'Santé financière',
    nameEn: 'Financial Health',
    score,
    level: level(score),
    components,
    explanation: `تحصيل ${collectionRate?.toFixed(0) ?? '?'}% • هامش الربح ${marginScore?.toFixed(0) ?? '?'}% • تأخير المستحقات ${overdueScore?.toFixed(0) ?? '?'}%`,
    sources: ['payments', 'bookings', 'accounting'],
  };
}

// ── Operational Health (صحة تشغيلية) ─────────────────────────────────

export interface OperationalHealthInput {
  visaReadinessPct: number | null;      // % pilgrims with visa approved
  paymentCompletionPct: number | null;  // % pilgrims fully paid
  docCompletePct: number | null;        // % pilgrims with complete docs
  slaOverdueCount: number | null;       // external ops overdue SLA
  totalExternalOps: number | null;
}

export function operationalHealth(input: OperationalHealthInput): HealthScore {
  const { visaReadinessPct, paymentCompletionPct, docCompletePct, slaOverdueCount, totalExternalOps } = input;

  const slaScore = slaOverdueCount != null && totalExternalOps != null && totalExternalOps > 0
    ? clamp(100 - (slaOverdueCount / totalExternalOps) * 200, 0, 100)
    : slaOverdueCount === 0 ? 100 : null;

  const components = [
    { name: 'جاهزية التأشيرات', value: visaReadinessPct, weight: 0.35, contribution: visaReadinessPct != null ? visaReadinessPct * 0.35 : null },
    { name: 'اكتمال الدفع', value: paymentCompletionPct, weight: 0.30, contribution: paymentCompletionPct != null ? paymentCompletionPct * 0.30 : null },
    { name: 'اكتمال الوثائق', value: docCompletePct, weight: 0.20, contribution: docCompletePct != null ? docCompletePct * 0.20 : null },
    { name: 'التزام SLA', value: slaScore, weight: 0.15, contribution: slaScore != null ? slaScore * 0.15 : null },
  ];

  const defined = components.filter(c => c.contribution != null);
  const score = defined.length > 0
    ? roundTo(defined.reduce((a, c) => a + (c.contribution ?? 0), 0) / defined.reduce((a, c) => a + c.weight, 0), 0)
    : null;

  return {
    id: 'operational',
    nameAr: 'صحة تشغيلية',
    nameFr: 'Santé opérationnelle',
    nameEn: 'Operational Health',
    score,
    level: level(score),
    components,
    explanation: `تأشيرات ${visaReadinessPct?.toFixed(0) ?? '?'}% • دفع ${paymentCompletionPct?.toFixed(0) ?? '?'}% • وثائق ${docCompletePct?.toFixed(0) ?? '?'}%`,
    sources: ['pilgrims', 'external_operations', 'documents'],
  };
}

// ── Sales Health (صحة مبيعات) ────────────────────────────────────────

export interface SalesHealthInput {
  confirmedBookings: number | null;
  totalReservations: number | null;    // inquiries/leads
  totalCapacity: number | null;
  filledCapacity: number | null;
}

export function salesHealth(input: SalesHealthInput): HealthScore {
  const { confirmedBookings, totalReservations, totalCapacity, filledCapacity } = input;

  const conversionRate = pct(confirmedBookings, totalReservations); // 50%
  const occupancyRate = pct(filledCapacity, totalCapacity); // 50%

  const components = [
    { name: 'معدل التحويل', value: conversionRate, weight: 0.50, contribution: conversionRate != null ? conversionRate * 0.50 : null },
    { name: 'الإشغال', value: occupancyRate, weight: 0.50, contribution: occupancyRate != null ? occupancyRate * 0.50 : null },
  ];

  const defined = components.filter(c => c.contribution != null);
  const score = defined.length > 0
    ? roundTo(defined.reduce((a, c) => a + (c.contribution ?? 0), 0) / defined.reduce((a, c) => a + c.weight, 0), 0)
    : null;

  return {
    id: 'sales',
    nameAr: 'صحة مبيعات',
    nameFr: 'Santé commerciale',
    nameEn: 'Sales Health',
    score,
    level: level(score),
    components,
    explanation: `تحويل ${conversionRate?.toFixed(0) ?? '?'}% • إشغال ${occupancyRate?.toFixed(0) ?? '?'}%`,
    sources: ['bookings', 'reservations', 'packages'],
  };
}

// ── Data Health (صحة بيانات) ───────────────────────────────────────────

export interface DataHealthInput {
  avgCompletenessScore: number | null;  // 0–100 from get_agency_data_quality_summary
  duplicateCount: number | null;
  totalPilgrims: number | null;
  staleRecords: number | null;          // not updated in 30+ days
}

export function dataHealth(input: DataHealthInput): HealthScore {
  const { avgCompletenessScore, duplicateCount, totalPilgrims, staleRecords } = input;

  const dupScore = duplicateCount != null && totalPilgrims != null && totalPilgrims > 0
    ? clamp(100 - (duplicateCount / totalPilgrims) * 500, 0, 100) : null;
  const staleScore = staleRecords != null && totalPilgrims != null && totalPilgrims > 0
    ? clamp(100 - (staleRecords / totalPilgrims) * 200, 0, 100) : null;

  const components = [
    { name: 'اكتمال البيانات', value: avgCompletenessScore, weight: 0.50, contribution: avgCompletenessScore != null ? avgCompletenessScore * 0.50 : null },
    { name: 'غياب التكرار', value: dupScore, weight: 0.30, contribution: dupScore != null ? dupScore * 0.30 : null },
    { name: 'حداثة البيانات', value: staleScore, weight: 0.20, contribution: staleScore != null ? staleScore * 0.20 : null },
  ];

  const defined = components.filter(c => c.contribution != null);
  const score = defined.length > 0
    ? roundTo(defined.reduce((a, c) => a + (c.contribution ?? 0), 0) / defined.reduce((a, c) => a + c.weight, 0), 0)
    : null;

  return {
    id: 'data',
    nameAr: 'صحة بيانات',
    nameFr: 'Santé des données',
    nameEn: 'Data Health',
    score,
    level: level(score),
    components,
    explanation: `اكتمال ${avgCompletenessScore?.toFixed(0) ?? '?'}% • تكرار ${duplicateCount ?? '?'} سجل`,
    sources: ['pilgrims', 'data_quality_rpc'],
  };
}

// ── Risk Health (صحة المخاطر) ──────────────────────────────────────────

export interface RiskHealthInput {
  expiredDocuments: number | null;     // passports/visas expired
  expiringDocuments: number | null;    // expiring within 30 days
  openIncidents: number | null;
  visaDelayedCount: number | null;     // pilgrims pending visa > 30 days
  totalPilgrims: number | null;
}

export function riskHealth(input: RiskHealthInput): HealthScore {
  const { expiredDocuments, expiringDocuments, openIncidents, visaDelayedCount, totalPilgrims } = input;

  const expiredScore = expiredDocuments != null && totalPilgrims != null && totalPilgrims > 0
    ? clamp(100 - (expiredDocuments / totalPilgrims) * 500, 0, 100) : null;
  const expiringScore = expiringDocuments != null && totalPilgrims != null && totalPilgrims > 0
    ? clamp(100 - (expiringDocuments / totalPilgrims) * 300, 0, 100) : null;
  const incidentScore = openIncidents != null ? clamp(100 - openIncidents * 10, 0, 100) : null;
  const visaDelayScore = visaDelayedCount != null && totalPilgrims != null && totalPilgrims > 0
    ? clamp(100 - (visaDelayedCount / totalPilgrims) * 300, 0, 100) : null;

  const components = [
    { name: 'وثائق منتهية', value: expiredScore, weight: 0.30, contribution: expiredScore != null ? expiredScore * 0.30 : null },
    { name: 'وثائق تنتهي قريباً', value: expiringScore, weight: 0.25, contribution: expiringScore != null ? expiringScore * 0.25 : null },
    { name: 'حوادث مفتوحة', value: incidentScore, weight: 0.20, contribution: incidentScore != null ? incidentScore * 0.20 : null },
    { name: 'تأخير التأشيرات', value: visaDelayScore, weight: 0.25, contribution: visaDelayScore != null ? visaDelayScore * 0.25 : null },
  ];

  const defined = components.filter(c => c.contribution != null);
  const score = defined.length > 0
    ? roundTo(defined.reduce((a, c) => a + (c.contribution ?? 0), 0) / defined.reduce((a, c) => a + c.weight, 0), 0)
    : null;

  return {
    id: 'risk',
    nameAr: 'صحة المخاطر',
    nameFr: 'Santé des risques',
    nameEn: 'Risk Health',
    score,
    level: level(score),
    components,
    explanation: `وثائق منتهية ${expiredDocuments ?? '?'} • حوادث ${openIncidents ?? '?'}`,
    sources: ['expiring_documents_view', 'incidents', 'pilgrims'],
  };
}

// ── Aggregate all 5 health scores ─────────────────────────────────────────────

export interface AllHealthInputs {
  financial: FinancialHealthInput;
  operational: OperationalHealthInput;
  sales: SalesHealthInput;
  data: DataHealthInput;
  risk: RiskHealthInput;
}

export interface AgencyHealthReport {
  scores: HealthScore[];
  overallScore: number | null;
  overallLevel: HealthLevel;
  generatedAt: string;
}

export function computeAgencyHealth(inputs: AllHealthInputs): AgencyHealthReport {
  const scores = [
    financialHealth(inputs.financial),
    operationalHealth(inputs.operational),
    salesHealth(inputs.sales),
    dataHealth(inputs.data),
    riskHealth(inputs.risk),
  ];

  const validScores = scores.filter(s => s.score != null);
  const overallScore = validScores.length > 0
    ? roundTo(validScores.reduce((a, s) => a + (s.score ?? 0), 0) / validScores.length, 0)
    : null;

  return {
    scores,
    overallScore,
    overallLevel: level(overallScore),
    generatedAt: new Date().toISOString(),
  };
}
