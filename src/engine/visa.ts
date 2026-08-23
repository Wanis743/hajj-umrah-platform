import { emitEvent } from './events';
export type VisaState = 'NOT_STARTED' | 'DOCUMENTS_GATHERED' | 'SUBMITTED_TO_MOFA' | 'APPROVED' | 'REJECTED' | 'PRINTED' | 'CANCELLED';
export type Visa = { id: string; pilgrimId: string; groupId: string; status: VisaState; submissionDate?: Date; mofaNumber?: string };
export function submitVisa(pilgrimId: string, documents: Array<{ type?: string; status?: string }>) {
  if (!pilgrimId.trim()) throw new Error('Pilgrim is required for visa submission');
  if (!documents.length) throw new Error('Documents required for visa submission');
  const incomplete = documents.some(d => d.status && !['VERIFIED', 'UPLOADED', 'VALID'].includes(String(d.status).toUpperCase()));
  if (incomplete) throw new Error('All visa documents must be uploaded or verified before submission');
  const mofaNumber = `MOFA-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const timestamp = new Date();
  emitEvent({ id: `evt-${crypto.randomUUID()}`, type: 'VisaSubmitted', timestamp, payload: { pilgrimId, mofaNumber }, source: 'engine/visa' });
  return { success: true as const, status: 'SUBMITTED_TO_MOFA' as const, mofaNumber, timestamp };
}
export function checkVisaSLA(visa: Visa, slaHours = 72) {
  if (visa.status !== 'SUBMITTED_TO_MOFA' || !visa.submissionDate) return { withinSLA: true, alerts: [] as string[] };
  const elapsed = (Date.now() - visa.submissionDate.getTime()) / 3600000;
  const alerts = elapsed > slaHours ? [`Visa processing SLA breached for pilgrim ${visa.pilgrimId}. Overdue by ${Math.floor(elapsed - slaHours)} hours.`] : [];
  return { withinSLA: elapsed <= slaHours, alerts };
}
export function calculateDepartureUrgency(visa: Visa, departureDate: Date) {
  const days = (departureDate.getTime() - Date.now()) / 86400000;
  if (['APPROVED', 'PRINTED', 'CANCELLED'].includes(visa.status)) return 'LOW';
  if (days < 3) return 'CRITICAL'; if (days < 7) return 'HIGH'; if (days < 14) return 'MEDIUM'; return 'LOW';
}
export function getVisaPipeline(groupId: string, visas: Visa[] = []): Visa[] { return visas.filter((visa) => visa.groupId === groupId); }
