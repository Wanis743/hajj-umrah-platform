/**
 * Event log — the kernel's audit and diagnostics spine.
 *
 * Four channels mirror Windows: `System` (kernel + services), `Application`
 * (app-issued writes), `Security` (capability denials, elevation, ledger
 * commands) and `Setup` (install / boot). Each channel is a bounded ring so a
 * chatty process cannot exhaust memory; Event Viewer queries this directly.
 */
import type { EventChannel, EventLevel, EventQuery, EventRecord, Pid } from '../abi';
import type { EventLogSubsystem, KernelClock } from '../contracts';
import { createSignal } from './store';
import { next } from './ids';

/** Per-channel retention. Security keeps the most: it is the audit trail. */
const CAPACITY: Readonly<Record<EventChannel, number>> = {
  System: 1500,
  Application: 1500,
  Security: 3000,
  Setup: 300,
};

const LEVEL_ORDER: Readonly<Record<EventLevel, number>> = {
  critical: 0,
  error: 1,
  warning: 2,
  information: 3,
  verbose: 4,
};

class EventLog implements EventLogSubsystem {
  private readonly channels = new Map<EventChannel, EventRecord[]>([
    ['System', []],
    ['Application', []],
    ['Security', []],
    ['Setup', []],
  ]);

  private readonly signal = createSignal();

  constructor(private readonly clock: KernelClock) {}

  write(
    channel: EventChannel,
    level: EventLevel,
    eventId: number,
    source: string,
    message: string,
    data?: Readonly<Record<string, string | number | boolean | null>>,
    pid?: Pid | null,
  ): void {
    const ring = this.channels.get(channel);
    if (!ring) return;
    const record: EventRecord = {
      id: next('event'),
      channel,
      level,
      eventId,
      source,
      at: this.clock.iso(),
      pid: pid ?? null,
      message,
      ...(data === undefined ? {} : { data }),
    };
    ring.push(record);
    const overflow = ring.length - CAPACITY[channel];
    if (overflow > 0) ring.splice(0, overflow);
    this.signal.bump();
  }

  query(query: EventQuery): readonly EventRecord[] {
    const source = query.channel !== undefined ? (this.channels.get(query.channel) ?? []) : this.everything();
    const levels = query.levels !== undefined && query.levels.length > 0 ? new Set(query.levels) : null;
    const needle = query.search?.trim().toLowerCase() ?? '';
    const sinceMs = query.since !== undefined ? Date.parse(query.since) : Number.NEGATIVE_INFINITY;

    const matched: EventRecord[] = [];
    // Walk newest-first so `limit` keeps the most recent records.
    for (let i = source.length - 1; i >= 0; i -= 1) {
      const record = source[i];
      if (levels !== null && !levels.has(record.level)) continue;
      if (query.source !== undefined && record.source !== query.source) continue;
      if (Number.isFinite(sinceMs) && Date.parse(record.at) < sinceMs) continue;
      if (needle !== '' && !this.matches(record, needle)) continue;
      matched.push(record);
      if (query.limit !== undefined && matched.length >= query.limit) break;
    }
    return matched;
  }

  clear(channel: EventChannel): number {
    const ring = this.channels.get(channel);
    if (!ring) return 0;
    const removed = ring.length;
    ring.length = 0;
    this.signal.bump();
    // Clearing an audit channel is itself an auditable act.
    this.write('Security', 'warning', 1102, 'EventLog', `Channel ${channel} cleared`, { removed });
    return removed;
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  size(): number {
    let total = 0;
    for (const ring of this.channels.values()) total += ring.length;
    return total;
  }

  private everything(): readonly EventRecord[] {
    const all: EventRecord[] = [];
    for (const ring of this.channels.values()) all.push(...ring);
    all.sort((a, b) => a.id - b.id);
    return all;
  }

  private matches(record: EventRecord, needle: string): boolean {
    if (record.message.toLowerCase().includes(needle)) return true;
    if (record.source.toLowerCase().includes(needle)) return true;
    if (String(record.eventId).includes(needle)) return true;
    if (record.data !== undefined) {
      for (const [key, value] of Object.entries(record.data)) {
        if (key.toLowerCase().includes(needle)) return true;
        if (String(value).toLowerCase().includes(needle)) return true;
      }
    }
    return false;
  }
}

export function createEventLog(clock: KernelClock): EventLogSubsystem {
  return new EventLog(clock);
}

/** Sort helper shared by Event Viewer columns. */
export function levelRank(level: EventLevel): number {
  return LEVEL_ORDER[level];
}

/**
 * Numeric event ids, kept in one place so Event Viewer can label them and
 * operators can filter on stable numbers rather than message text.
 */
export const EVENT_IDS = {
  bootStarted: 100,
  bootCompleted: 101,
  shutdownStarted: 102,
  shutdownCompleted: 103,
  processStarted: 4688,
  processExited: 4689,
  processSuspended: 4690,
  processResumed: 4691,
  processPriority: 4692,
  serviceStarting: 7035,
  serviceStarted: 7036,
  serviceStopped: 7037,
  serviceFaulted: 7031,
  serviceRestarted: 7032,
  serviceStartTypeChanged: 7040,
  volumeMounted: 98,
  quotaExceeded: 2013,
  fileWrite: 4663,
  fileDelete: 4660,
  registryWrite: 4657,
  capabilityDenied: 4656,
  elevationRequested: 4673,
  elevationGranted: 4674,
  elevationDenied: 4675,
  elevationRevoked: 4647,
  principalChanged: 4624,
  ledgerCommand: 5136,
  ledgerCommandFailed: 5137,
  datasetQuery: 5145,
  documentUploaded: 5150,
  documentUploadFailed: 5151,
  documentUrlIssued: 5152,
  appInstalled: 1033,
  appUninstalled: 1034,
  appLaunched: 1000,
  windowCreated: 200,
  windowClosed: 201,
  powerRequested: 1074,
  syscallFault: 1026,
} as const;
