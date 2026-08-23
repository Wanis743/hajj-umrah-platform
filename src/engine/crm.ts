export type Lead = {
  id: string;
  source: string;
  contactInfo: Record<string, unknown>;
  packageInterest: string;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST' | 'UNQUALIFIED';
  createdAt: Date;
};

export function createLead(source: string, contactInfo: Record<string, unknown>, packageInterest: string): Lead {
  return {
    id: `LD-${Date.now()}`,
    source,
    contactInfo,
    packageInterest,
    status: 'NEW',
    createdAt: new Date()
  };
}

export function advanceLead(leadId: string, newStatus: Lead['status']) {
  return {
    success: true,
    leadId,
    newStatus,
    updatedAt: new Date()
  };
}

export function calculateConversionFunnel(leads: Lead[]) {
  const counts = {
    total: leads.length,
    new: leads.filter(l => l.status === 'NEW').length,
    contacted: leads.filter(l => l.status === 'CONTACTED').length,
    qualified: leads.filter(l => l.status === 'QUALIFIED').length,
    converted: leads.filter(l => l.status === 'CONVERTED').length
  };

  const conversionRate = counts.total > 0 ? (counts.converted / counts.total) * 100 : 0;

  return {
    counts,
    conversionRate
  };
}

type BookingAttribution = {
  source?: string | null;
  total_dzd?: number | null;
  amount_dzd?: number | null;
  amount?: number | null;
};

export function getMarketingAttribution(bookings: BookingAttribution[]) {
  const attribution: Record<string, number> = {};
  
  bookings.forEach(b => {
    const source = b.source || 'Organic';
    const amount = Number(b.total_dzd ?? b.amount_dzd ?? b.amount ?? 0);
    attribution[source] = (attribution[source] || 0) + amount;
  });

  return attribution;
}
