/**
 * RealtimeManager — domain-level Supabase Realtime subscriptions
 * ─────────────────────────────────────────────────────────────────
 * State machine per domain:
 *   DISCONNECTED → CONNECTING → SUBSCRIBED → (event fires listeners)
 *                                  ↓ error
 *                           CHANNEL_ERROR → RECONNECTING → CONNECTING…
 *
 * Status is observable by consumers via onStatusChange callback.
 */
import { supabase } from '@/lib/supabase';

type Subscriber = () => void;

export type ChannelStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

export type StatusChangeCallback = (domain: RealtimeDomain, status: ChannelStatus) => void;

const TABLES = {
  finance: 'payments',
  bookings: 'bookings',
  pilgrims: 'pilgrims',
  groups: 'groups',
  hotels: 'hotels',
  operations: 'flights',
  visas: 'visas',
  invoices: 'invoices',
  accounting: 'journal_entries',
  incidents: 'incidents',
  sos_events: 'sos_events',
  reservations: 'reservations',
  alerts: 'alerts',
} as const;
export type RealtimeDomain = keyof typeof TABLES;

const RECONNECT_DELAY_MS = 3_000;   // initial backoff
const MAX_RECONNECT_DELAY_MS = 30_000;

class RealtimeManager {
  private channels    = new Map<string, ReturnType<typeof supabase.channel>>();
  private listeners   = new Map<string, Set<Subscriber>>();
  private debounce    = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnect   = new Map<string, ReturnType<typeof setTimeout>>();
  private backoff     = new Map<string, number>();
  private statuses    = new Map<RealtimeDomain, ChannelStatus>();
  private statusCbs   = new Set<StatusChangeCallback>();
  private lastEventAt = new Map<RealtimeDomain, number>();

  // ── Public: subscribe to domain data events ───────────────────────────
  subscribe(domain: RealtimeDomain, listener: Subscriber): () => void {
    let set = this.listeners.get(domain);
    if (!set) {
      set = new Set();
      this.listeners.set(domain, set);
    }
    set.add(listener);
    this.ensure(domain);
    return () => {
      set?.delete(listener);
      if (!set?.size) this.teardown(domain);
    };
  }

  // ── Public: observe connection status changes ─────────────────────────
  onStatusChange(cb: StatusChangeCallback): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  getStatus(domain: RealtimeDomain): ChannelStatus {
    return this.statuses.get(domain) ?? 'DISCONNECTED';
  }

  getLastEventAt(domain: RealtimeDomain): number | null {
    return this.lastEventAt.get(domain) ?? null;
  }

  // ── Internal ──────────────────────────────────────────────────────────
  private setStatus(domain: RealtimeDomain, status: ChannelStatus) {
    this.statuses.set(domain, status);
    for (const cb of this.statusCbs) cb(domain, status);
  }

  private ensure(domain: RealtimeDomain) {
    if (this.channels.has(domain)) return;
    this.connect(domain);
  }

  private connect(domain: RealtimeDomain) {
    const table = TABLES[domain];
    if (!table) return;

    this.setStatus(domain, 'CONNECTING');

    const channel = supabase
      .channel(`domain-${domain}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        // Debounce rapid bursts (250ms)
        const old = this.debounce.get(domain);
        if (old) clearTimeout(old);
        this.debounce.set(domain, setTimeout(() => {
          this.lastEventAt.set(domain, Date.now());
          for (const listener of this.listeners.get(domain) ?? []) listener();
        }, 250));
      })
      .subscribe((status) => {
        switch (status) {
          case 'SUBSCRIBED':
            this.setStatus(domain, 'SUBSCRIBED');
            this.backoff.delete(domain);     // reset backoff on success
            break;

          case 'CHANNEL_ERROR':
          case 'TIMED_OUT':
            this.setStatus(domain, status);
            this.scheduleReconnect(domain);
            break;

          case 'CLOSED':
            this.setStatus(domain, 'CLOSED');
            // Only reconnect if we still have listeners
            if (this.listeners.get(domain)?.size) {
              this.scheduleReconnect(domain);
            }
            break;
        }
      });

    this.channels.set(domain, channel);
  }

  private scheduleReconnect(domain: RealtimeDomain) {
    const existing = this.reconnect.get(domain);
    if (existing) clearTimeout(existing);

    const delay = Math.min(
      (this.backoff.get(domain) ?? RECONNECT_DELAY_MS),
      MAX_RECONNECT_DELAY_MS,
    );
    this.backoff.set(domain, delay * 2);   // exponential backoff

    this.reconnect.set(domain, setTimeout(() => {
      if (!this.listeners.get(domain)?.size) return;   // nobody listening anymore
      this.teardownChannel(domain);
      this.connect(domain);
    }, delay));
  }

  private teardown(domain: RealtimeDomain) {
    this.teardownChannel(domain);
    this.listeners.delete(domain);
    this.statuses.delete(domain);
    this.backoff.delete(domain);
    const rt = this.reconnect.get(domain);
    if (rt) { clearTimeout(rt); this.reconnect.delete(domain); }
  }

  private teardownChannel(domain: RealtimeDomain) {
    const channel = this.channels.get(domain);
    if (channel) void supabase.removeChannel(channel);
    this.channels.delete(domain);
    const db = this.debounce.get(domain);
    if (db) { clearTimeout(db); this.debounce.delete(domain); }
  }
}

export const realtimeManager = new RealtimeManager();
