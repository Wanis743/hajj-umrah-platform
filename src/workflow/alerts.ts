export type AlertRule = { id: string; type: 'THRESHOLD' | 'RATE_OF_CHANGE' | 'TREND' | 'FORECAST' | 'ANOMALY' | 'COMPOUND' | 'PERSISTENCE'; kpiId: string; condition: string };
export type Alert = { id: string; ruleId: string; kpiId: string; message: string; priorityScore: number; timestamp: Date };
export const PREDEFINED_RULES: AlertRule[] = [
  { id: 'R1', type: 'THRESHOLD', kpiId: 'GroupReadiness', condition: '< 80 and departure < 7d' },
  { id: 'R2', type: 'RATE_OF_CHANGE', kpiId: 'VisaClearanceRate', condition: 'drop > 10% in 24h' },
  { id: 'R3', type: 'ANOMALY', kpiId: 'CancellationRate', condition: 'anomaly_score > 80' },
  { id: 'R4', type: 'PERSISTENCE', kpiId: 'PaymentCollection', condition: '< 50% for 3 days' },
];
export type AlertContext = { groupReadiness?: number; daysToDeparture?: number; visaCurrent?: number; visaPrevious?: number; cancellationAnomalyScore?: number; paymentCollectionHistory?: number[] };
export function evaluateAlertRules(context: AlertContext = {}): Alert[] {
  const now = new Date(); const alerts: Alert[] = [];
  if ((context.groupReadiness ?? 100) < 80 && (context.daysToDeparture ?? Infinity) < 7) alerts.push({ id: `ALT-${crypto.randomUUID()}`, ruleId: 'R1', kpiId: 'GroupReadiness', message: `Group readiness is ${context.groupReadiness ?? 0}% with ${context.daysToDeparture} day(s) to departure.`, priorityScore: 90, timestamp: now });
  if (context.visaCurrent != null && context.visaPrevious != null && context.visaPrevious - context.visaCurrent > 10) alerts.push({ id: `ALT-${crypto.randomUUID()}`, ruleId: 'R2', kpiId: 'VisaClearanceRate', message: `Visa clearance rate dropped by ${(context.visaPrevious - context.visaCurrent).toFixed(1)}%.`, priorityScore: 80, timestamp: now });
  if ((context.cancellationAnomalyScore ?? 0) > 80) alerts.push({ id: `ALT-${crypto.randomUUID()}`, ruleId: 'R3', kpiId: 'CancellationRate', message: 'Cancellation anomaly score exceeded 80.', priorityScore: 85, timestamp: now });
  const history = context.paymentCollectionHistory ?? [];
  if (history.length >= 3 && history.slice(-3).every(v => v < 50)) alerts.push({ id: `ALT-${crypto.randomUUID()}`, ruleId: 'R4', kpiId: 'PaymentCollection', message: 'Payment collection remained below 50% for three consecutive periods.', priorityScore: 88, timestamp: now });
  return alerts;
}
export const prioritizeAlerts = (alerts: Alert[]) => [...alerts].sort((a, b) => b.priorityScore - a.priorityScore);
