/**
 * Audit Log (spec §7, §64) — immutable in-memory audit event records for
 * consequential actions. Append-only; no update/delete paths exist by design.
 *
 * When a Supabase project is bound, events are mirrored to the server audit
 * tables via RPC (server remains authoritative); this buffer is the
 * front-end evidence trail and console feed.
 */

import type { AuditEventId, CorrelationId, IsoTimestamp, ObjectTypeId, Principal } from './types.ts';

export interface AuditEvent {
  readonly eventId: AuditEventId;
  readonly at: IsoTimestamp;
  readonly actor: Principal['userId'];
  readonly actorRoles: readonly string[];
  readonly agencyId: string;
  readonly branchId: string | null;
  readonly eventType: string;
  readonly objectTypeId: ObjectTypeId | null;
  readonly objectId: string | null;
  readonly correlationId: CorrelationId | null;
  /** Why/source of the action (§64: reason/source). */
  readonly reason: string | null;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export interface AuditQuery {
  readonly actor?: string;
  readonly eventType?: string;
  readonly objectTypeId?: ObjectTypeId;
  readonly objectId?: string;
  readonly correlationId?: CorrelationId;
  readonly limit?: number;
}

export class AuditLog {
  private seq = 0n;
  private readonly events: AuditEvent[] = [];

  append(input: Omit<AuditEvent, 'eventId' | 'at'> & { at?: IsoTimestamp }): AuditEventId {
    const id: AuditEventId = (`audit-${(++this.seq).toString(36)}`) as AuditEventId;
    this.events.push({
      ...input,
      eventId: id,
      at: input.at ?? (new Date().toISOString() as IsoTimestamp),
    });
    return id;
  }

  query(q: AuditQuery = {}): readonly AuditEvent[] {
    const limit = q.limit ?? 100;
    return this.events
      .filter((e) => {
        if (q.actor !== undefined && e.actor !== q.actor) return false;
        if (q.eventType !== undefined && e.eventType !== q.eventType) return false;
        if (q.objectTypeId !== undefined && e.objectTypeId !== q.objectTypeId) return false;
        if (q.objectId !== undefined && e.objectId !== q.objectId) return false;
        if (q.correlationId !== undefined && e.correlationId !== q.correlationId) return false;
        return true;
      })
      .slice(-limit);
  }

  get size(): number {
    return this.events.length;
  }
}
