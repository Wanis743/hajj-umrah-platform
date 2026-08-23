/**
 * Event Bus (spec §7, §71) — typed domain events connecting CRM, Operations,
 * Accounting, DMS, BI and Finance OS without duplicated logic.
 */

import type { CorrelationId, KernelError, ObjectTypeId, Result } from './types.ts';

export interface DomainEvent<T extends string = string> {
  readonly type: T;
  readonly at: string;
  readonly agencyId: string;
  readonly branchId: string | null;
  /** The object that raised the event. */
  readonly source: { readonly objectTypeId: ObjectTypeId; readonly objectId: string };
  readonly correlationId: CorrelationId | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type DomainEventType =
  | 'LeadQualified'
  | 'QuoteAccepted'
  | 'BookingCreated'
  | 'InvoiceIssued'
  | 'PaymentReceived'
  | 'DocumentVerified'
  | 'GroupReadinessChanged'
  | 'SupplierCostChanged'
  | 'JournalPosted'
  | 'ReconciliationCertified'
  | 'BudgetPublished';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

interface Subscription {
  readonly id: number;
  readonly types: readonly DomainEventType[] | null; // null = all
  readonly handler: EventHandler;
}

export class EventBus {
  private nextSubId = 1;
  private readonly subscriptions: Subscription[] = [];
  /** Bounded in-memory recent-event feed for the console (§10 bottom console). */
  private readonly recent: DomainEvent[] = [];
  private readonly maxRecent = 500;

  subscribe(types: readonly DomainEventType[] | null, handler: EventHandler): () => void {
    const id = this.nextSubId++;
    this.subscriptions.push({ id, types, handler });
    return () => {
      const idx = this.subscriptions.findIndex((s) => s.id === id);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  async publish(event: Omit<DomainEvent, 'at'> & { at?: string }): Promise<Result<null, KernelError>> {
    const full: DomainEvent = {
      ...event,
      at: event.at ?? new Date().toISOString(),
    } as DomainEvent;
    this.recent.push(full);
    if (this.recent.length > this.maxRecent) this.recent.shift();

    for (const sub of this.subscriptions) {
      if (sub.types !== null && !sub.types.includes(full.type as DomainEventType)) continue;
      try {
        await sub.handler(full);
      } catch (cause) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Event handler raised an unexpected error',
            details: { domain: 'EVENT_BUS', eventType: full.type, cause: String(cause) },
          },
        };
      }
    }
    return { ok: true, value: null };
  }

  recentEvents(limit = 50): readonly DomainEvent[] {
    return this.recent.slice(-limit);
  }
}
