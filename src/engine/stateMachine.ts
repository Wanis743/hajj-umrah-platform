export type EntityType = 
  | 'Booking'
  | 'Visa'
  | 'Document'
  | 'Pilgrim'
  | 'Group'
  | 'Flight'
  | 'Payment'
  | 'Lead'
  | 'Ticket'
  | 'Incident';

export type StateTransitionResult = {
  success: boolean;
  newState?: string;
  error?: string;
};

const VALID_TRANSITIONS: Record<EntityType, Record<string, string[]>> = {
  Booking: {
    DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
    PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: []
  },
  Visa: {
    NOT_STARTED: ['DOCUMENTS_GATHERED'],
    DOCUMENTS_GATHERED: ['SUBMITTED_TO_MOFA'],
    SUBMITTED_TO_MOFA: ['APPROVED', 'REJECTED'],
    APPROVED: ['PRINTED'],
    REJECTED: ['APPEALED', 'CANCELLED'],
    APPEALED: ['APPROVED', 'REJECTED'],
    PRINTED: [],
    CANCELLED: []
  },
  Document: {
    MISSING: ['UPLOADED'],
    UPLOADED: ['VERIFIED', 'REJECTED'],
    VERIFIED: [],
    REJECTED: ['UPLOADED']
  },
  Pilgrim: {
    REGISTERED: ['PROFILING'],
    PROFILING: ['CLEARED', 'FLAGGED'],
    CLEARED: ['READY_FOR_VISA'],
    FLAGGED: ['CLEARED', 'REJECTED'],
    READY_FOR_VISA: ['VISA_ISSUED'],
    VISA_ISSUED: ['TRAVELED'],
    TRAVELED: ['RETURNED'],
    RETURNED: [],
    REJECTED: []
  },
  Group: {
    FORMING: ['READY'],
    READY: ['DEPARTED'],
    DEPARTED: ['IN_MECCA', 'IN_MEDINA'],
    IN_MECCA: ['IN_MEDINA', 'COMPLETED'],
    IN_MEDINA: ['IN_MECCA', 'COMPLETED'],
    COMPLETED: []
  },
  Flight: {
    SCHEDULED: ['BOARDING', 'DELAYED', 'CANCELLED'],
    BOARDING: ['DEPARTED'],
    DEPARTED: ['ARRIVED'],
    DELAYED: ['BOARDING', 'CANCELLED'],
    ARRIVED: [],
    CANCELLED: []
  },
  Payment: {
    PENDING: ['CONFIRMED', 'FAILED'],
    CONFIRMED: [],
    FAILED: ['PENDING'],
    CANCELLED: []
  },
  Lead: {
    NEW: ['CONTACTED', 'UNQUALIFIED'],
    CONTACTED: ['QUALIFIED', 'UNQUALIFIED'],
    QUALIFIED: ['CONVERTED', 'LOST'],
    CONVERTED: [],
    LOST: [],
    UNQUALIFIED: []
  },
  Ticket: {
    OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
    IN_PROGRESS: ['RESOLVED', 'ESCALATED', 'CLOSED'],
    ESCALATED: ['RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED', 'OPEN'],
    CLOSED: []
  },
  Incident: {
    REPORTED: ['INVESTIGATING'],
    INVESTIGATING: ['MITIGATED', 'RESOLVED'],
    MITIGATED: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: []
  }
};

export function transition(entityType: EntityType, currentState: string, targetState: string): StateTransitionResult {
  const entityTransitions = VALID_TRANSITIONS[entityType];
  
  if (!entityTransitions) {
    return { success: false, error: `Unknown entity type: ${entityType}` };
  }
  
  const allowedNextStates = entityTransitions[currentState];
  
  if (!allowedNextStates) {
    return { success: false, error: `Unknown current state: ${currentState} for entity ${entityType}` };
  }
  
  if (allowedNextStates.includes(targetState)) {
    return { success: true, newState: targetState };
  }
  
  return { 
    success: false, 
    error: `Invalid transition from ${currentState} to ${targetState} for entity ${entityType}. Allowed: ${allowedNextStates.join(', ')}` 
  };
}

export function getAvailableTransitions(entityType: EntityType, currentState: string): string[] {
  const entityTransitions = VALID_TRANSITIONS[entityType];
  if (!entityTransitions) return [];
  return entityTransitions[currentState] || [];
}
