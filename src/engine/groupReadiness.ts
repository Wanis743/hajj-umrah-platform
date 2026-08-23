export type ReadinessRule = {
  code: string;
  weight: number;
  config?: {
    required?: boolean;
    min_score?: number;
    required_per_member?: boolean;
    success_statuses?: string[];
  };
  is_active?: boolean;
};

export type ReadinessMember = {
  id: string;
  requiredPaymentDzd?: number;
  requiredPaymentSar?: number;
  communicationRequired?: boolean;
  requiredDocuments?: string[];
};

export type ReadinessRecord = {
  id?: string;
  member_id?: string;
  pilgrim_id?: string;
  status?: string | null;
  amount_dzd?: number | null;
  amount_sar?: number | null;
  type?: string | null;
  document_type?: string | null;
};

export type GroupReadiness = {
  groupId: string;
  overallScore: number;
  status: 'READY' | 'NOT_READY' | 'WARNING';
  components: Record<string, number>;
  hardBlockers: string[];
  warnings: string[];
  missingRequirements: string[];
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const ratioScore = (matched: number, total: number) => total <= 0 ? 100 : clamp((matched / total) * 100);
const normalized = (value: unknown) => String(value ?? '').trim().toUpperCase();

function successful(records: ReadinessRecord[], successStatuses: string[] = ['CONFIRMED', 'APPROVED', 'ISSUED', 'VERIFIED', 'SENT', 'DELIVERED', 'ACKNOWLEDGED']) {
  const accepted = new Set(successStatuses.map(normalized));
  return records.filter(record => accepted.has(normalized(record.status)));
}


function getDocumentScore(members: ReadinessMember[], documents: ReadinessRecord[]): number {
  const required = members.flatMap(member => (member.requiredDocuments ?? ['PASSPORT']).map(type => `${member.id}:${normalized(type)}`));
  const received = new Set(
    documents.filter(doc => successful([doc], ['RECEIVED', 'VALIDATED', 'VERIFIED']).length > 0)
             .map(doc => `${String(doc.member_id ?? doc.pilgrim_id ?? '')}:${normalized(doc.document_type ?? doc.type)}`)
  );
  return ratioScore(required.filter(key => received.has(key)).length, required.length);
}

function getVisaScore(members: Set<string>, visas: ReadinessRecord[], total: number): number {
  const approved = new Set(
    successful(visas, ['APPROVED', 'ISSUED'])
      .map(visa => String(visa.member_id ?? visa.pilgrim_id ?? ''))
      .filter(id => members.has(id))
  );
  return ratioScore(approved.size, total);
}

function getAssignmentScore(members: Set<string>, records: ReadinessRecord[], total: number): number {
  const assigned = new Set(records.map(row => String(row.member_id ?? row.pilgrim_id ?? '')).filter(id => members.has(id)));
  return ratioScore(assigned.size, total);
}

function getPaymentScore(members: ReadinessMember[], payments: ReadinessRecord[]): number {
  const memberIds = new Set(members.map(m => m.id));
  const paid = new Map<string, number>();
  for (const payment of successful(payments, ['CONFIRMED'])) {
    const id = String(payment.member_id ?? payment.pilgrim_id ?? '');
    if (!memberIds.has(id)) continue;
    paid.set(id, (paid.get(id) ?? 0) + Number(payment.amount_dzd ?? 0));
  }
  let totalDue = 0, totalPaid = 0;
  for (const member of members) {
    const due = Number(member.requiredPaymentDzd ?? 0);
    totalDue += due;
    totalPaid += Math.min(due, paid.get(member.id) ?? 0);
  }
  return totalDue > 0 ? ratioScore(totalPaid, totalDue) : ratioScore(paid.size, members.length);
}

function getCommunicationScore(members: ReadinessMember[], communications: ReadinessRecord[]): number {
  const memberIds = new Set(members.map(m => m.id));
  const successfulComms = new Set(
    successful(communications, ['DELIVERED', 'ACKNOWLEDGED'])
      .map(row => String(row.member_id ?? row.pilgrim_id ?? row.id ?? ''))
      .filter(id => memberIds.has(id))
  );
  const requiredCount = members.filter(member => member.communicationRequired !== false).length;
  return ratioScore(successfulComms.size, requiredCount);
}

export function calculateGroupReadiness(
  group: { id: string; departureDate?: string | null },
  members: ReadinessMember[],
  visas: ReadinessRecord[],
  documents: ReadinessRecord[],
  flights: ReadinessRecord[],
  hotels: ReadinessRecord[],
  transport: ReadinessRecord[],
  payments: ReadinessRecord[],
  guides: ReadinessRecord[],
  communications: ReadinessRecord[] = [],
  rules: ReadinessRule[] = []
): GroupReadiness {
  const hardBlockers: string[] = [];
  const warnings: string[] = [];
  const missingRequirements: string[] = [];
  const activeRules = rules.filter(rule => rule.is_active !== false && rule.weight > 0);
  if (activeRules.length === 0) {
    return { groupId: group.id, overallScore: 0, status: 'NOT_READY', components: {}, hardBlockers: ['Readiness rules are not configured'], warnings: [], missingRequirements: ['Configure readiness_rules'] };
  }


  const totalMembers = members.length;
  const memberIds = new Set(members.map(member => member.id));

  const documentScore = getDocumentScore(members, documents);
  const visaScore = getVisaScore(memberIds, visas, totalMembers);
  const flightScore = getAssignmentScore(memberIds, flights, totalMembers);
  const hotelScore = getAssignmentScore(memberIds, hotels, totalMembers);
  const transportScore = getAssignmentScore(memberIds, transport, totalMembers);
  const paymentScore = getPaymentScore(members, payments);
  const communicationScore = getCommunicationScore(members, communications);
  const guideScore = guides.length > 0 ? 100 : 0;


  const componentScores: Record<string, number> = {
    DOCUMENTS: documentScore,
    VISA: visaScore,
    FLIGHT: flightScore,
    HOTEL: hotelScore,
    TRANSPORT: transportScore,
    PAYMENTS: paymentScore,
    COMMUNICATION: communicationScore,
    GUIDE: guideScore,
  };

  const totalWeight = activeRules.reduce((sum, rule) => sum + rule.weight, 0);
  const overallScore = activeRules.reduce((sum, rule) => sum + (componentScores[rule.code] ?? 0) * rule.weight, 0) / Math.max(totalWeight, 1);
  const departureDate = group.departureDate ? new Date(group.departureDate) : null;
  const hoursToDeparture = departureDate ? (departureDate.getTime() - Date.now()) / 3600000 : Number.POSITIVE_INFINITY;

  for (const rule of activeRules) {
    const score = componentScores[rule.code] ?? 0;
    const minScore = rule.config?.min_score ?? 100;
    if ((rule.config?.required ?? false) && score < minScore) {
      missingRequirements.push(`Missing ${rule.code.toLowerCase()} readiness requirement`);
      if (hoursToDeparture < 48) hardBlockers.push(`Departure in less than 48h and ${rule.code.toLowerCase()} readiness is incomplete`);
      else warnings.push(`${rule.code.toLowerCase()} readiness is incomplete`);
    }
  }

  if (flightScore < 100) hardBlockers.push('Flight assignment is incomplete');
  if (hotelScore < 100) warnings.push('Hotel allocation is incomplete');
  if (transportScore < 100) warnings.push('Transport assignment is incomplete');
  if (paymentScore < 100) warnings.push('Payment collection is incomplete');
  if (communicationScore < 100) warnings.push('Required communications are incomplete');

  let status: GroupReadiness['status'] = 'READY';
  if (hardBlockers.length > 0) status = 'NOT_READY';
  else if (warnings.length > 0 || overallScore < 80) status = 'WARNING';

  return {
    groupId: group.id,
    overallScore: clamp(overallScore),
    status,
    components: componentScores,
    hardBlockers: [...new Set(hardBlockers)],
    warnings: [...new Set(warnings)],
    missingRequirements: [...new Set(missingRequirements)],
  };
}
