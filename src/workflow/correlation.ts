export type CorrelatedAlert = { id: string; message?: string; type?: string; detectedAt?: string | Date; severity?: string; entityId?: string };
export type CorrelatedIncident = { incidentId: string; rootAlertId: string; relatedAlerts: string[]; summary: string; status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED'; createdAt: Date };

export function correlateAlerts(alerts: CorrelatedAlert[], windowMinutes = 30): CorrelatedAlert[][] {
  const sorted = [...alerts].filter(a => a?.id).sort((a, b) => new Date(a.detectedAt ?? 0).getTime() - new Date(b.detectedAt ?? 0).getTime());
  const groups: CorrelatedAlert[][] = [];
  for (const alert of sorted) {
    const ts = new Date(alert.detectedAt ?? 0).getTime();
    const compatible = groups.find(group => {
      const last = group[group.length - 1]; if (!last) return false;
      const lastTs = new Date(last.detectedAt ?? 0).getTime();
      return Math.abs(ts - lastTs) <= windowMinutes * 60_000 && (alert.entityId == null || last.entityId == null || alert.entityId === last.entityId);
    });
    if (compatible) compatible.push(alert); else groups.push([alert]);
  }
  return groups;
}

export function buildIncidentFromAlerts(alerts: CorrelatedAlert[]): CorrelatedIncident {
  if (!alerts.length) throw new Error('Cannot build an incident from an empty alert set');
  const ids = alerts.map(a => a.id);
  return { incidentId: `INC-${crypto.randomUUID()}`, rootAlertId: ids[0] ?? '', relatedAlerts: ids.slice(1), summary: `Correlated incident involving ${alerts.length} alert(s): ${alerts[0].message ?? 'Operational alert'}`, status: 'OPEN', createdAt: new Date() };
}
