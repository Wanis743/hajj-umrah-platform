import { reportError, reportInfo } from '@/lib/logger';
export type DomainEvent = {
  id: string;
  type: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  source: string;
};

type EventHandler = (event: DomainEvent) => void | Promise<void>;

class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private eventLog: DomainEvent[] = [];

  subscribe(eventType: string, handler: EventHandler): void {
    const currentHandlers = this.handlers.get(eventType) || [];
    this.handlers.set(eventType, [...currentHandlers, handler]);
  }

  emitEvent(event: DomainEvent): void {
    this.eventLog.push(event);
    const handlers = this.handlers.get(event.type) || [];
    
    // Execute handlers asynchronously to prevent blocking
    handlers.forEach(handler => {
      try {
        Promise.resolve(handler(event)).catch(err => {
          reportError(`event.${event.type}`, err);
        });
      } catch (err) {
        reportError(`event-sync.${event.type}`, err);
      }
    });
  }

  getEventLog(): DomainEvent[] {
    return [...this.eventLog];
  }
}

export const eventBus = new EventBus();

export const emitEvent = (event: DomainEvent) => eventBus.emitEvent(event);
export const subscribe = (eventType: string, handler: EventHandler) => eventBus.subscribe(eventType, handler);
export const getEventLog = () => eventBus.getEventLog();

// Pre-register important side-effect handlers
subscribe('PaymentReceived', () => {
  reportInfo('event.payment_received', { metadata: { entity: 'booking' } });
});

subscribe('VisaApproved', () => {
  reportInfo('event.visa_approved', { metadata: { entity: 'pilgrim' } });
});

subscribe('FlightChanged', () => {
  reportInfo('event.flight_changed', { metadata: { entity: 'flight' } });
});

subscribe('DocumentVerified', () => {
  reportInfo('event.document_verified', { metadata: { entity: 'document' } });
});
