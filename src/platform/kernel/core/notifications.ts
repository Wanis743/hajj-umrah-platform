/**
 * Notification centre.
 *
 * The kernel owns the notification history; the shell only renders it. That
 * split is what lets a service raise a notification while no window is open,
 * lets the taskbar badge survive a reload, and lets the kernel account the
 * notification to the process that sent it.
 *
 * Records are a bounded ring: the newest `RETENTION` survive, everything older
 * is dropped. Windows behaves the same way — Action Center is not an archive.
 */
import {
  type AppId,
  type NotificationRecord,
  type NotificationSpec,
  type ToastKind,
} from '../abi';
import type { IsoTimestamp } from '../types';
import type { KernelClock, NotificationSubsystem } from '../contracts';
import { uuid } from './ids';
import { createFlusher, isRecord, type Flusher, type KernelStorage } from './persist';
import { createSignal } from './store';

/** Notifications retained across the whole session. */
const RETENTION = 100;

const KINDS: readonly ToastKind[] = ['info', 'success', 'warning', 'error'];

export interface NotificationsHandle extends NotificationSubsystem {
  /** Writes pending state immediately (shutdown path). */
  flush(): void;
  dispose(): void;
}

interface Mutable {
  readonly id: string;
  readonly source: AppId;
  readonly at: IsoTimestamp;
  readonly kind: ToastKind;
  readonly title: string;
  readonly body: string;
  readonly launch?: AppId;
  readonly args?: Readonly<Record<string, string>>;
  readonly actions?: NotificationSpec['actions'];
  read: boolean;
}

class Notifications implements NotificationsHandle {
  private records: Mutable[] = [];
  private readonly signal = createSignal();
  private readonly flusher: Flusher;

  constructor(
    private readonly clock: KernelClock,
    private readonly storage: KernelStorage,
    private readonly storageKey: string,
  ) {
    this.records = this.load();
    this.flusher = createFlusher(400, () => this.persist());
  }

  push(source: AppId, spec: NotificationSpec): NotificationRecord {
    const record: Mutable = {
      id: uuid(),
      source,
      at: this.clock.iso(),
      kind: KINDS.includes(spec.kind) ? spec.kind : 'info',
      title: spec.title,
      body: spec.body,
      launch: spec.launch ?? source,
      args: spec.args,
      actions: spec.actions,
      read: false,
    };
    this.records = [record, ...this.records].slice(0, RETENTION);
    this.flusher.schedule();
    this.signal.bump();
    return snapshot(record);
  }

  list(): readonly NotificationRecord[] {
    return this.records.map(snapshot);
  }

  unreadCount(): number {
    return this.records.reduce((total, record) => total + (record.read ? 0 : 1), 0);
  }

  markAllRead(): void {
    if (this.unreadCount() === 0) return;
    for (const record of this.records) record.read = true;
    this.flusher.schedule();
    this.signal.bump();
  }

  dismiss(id: string): void {
    const remaining = this.records.filter((record) => record.id !== id);
    if (remaining.length === this.records.length) return;
    this.records = remaining;
    this.flusher.schedule();
    this.signal.bump();
  }

  clear(): void {
    if (this.records.length === 0) return;
    this.records = [];
    this.flusher.schedule();
    this.signal.bump();
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  flush(): void {
    this.flusher.flush();
  }

  dispose(): void {
    this.flusher.dispose();
  }

  /* ---------------- persistence ---------------- */

  private persist(): void {
    this.storage.write(this.storageKey, JSON.stringify(this.records.map(snapshot)));
  }

  private load(): Mutable[] {
    const raw = this.storage.read(this.storageKey);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isPersisted).slice(0, RETENTION).map(revive);
    } catch {
      // Corrupt history is not worth faulting a boot over.
      return [];
    }
  }
}

function snapshot(record: Mutable): NotificationRecord {
  return {
    id: record.id,
    source: record.source,
    at: record.at,
    read: record.read,
    kind: record.kind,
    title: record.title,
    body: record.body,
    launch: record.launch,
    args: record.args,
    actions: record.actions,
  };
}

function isPersisted(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.title === 'string' && typeof value.source === 'string';
}

function revive(value: Record<string, unknown>): Mutable {
  const kind = typeof value.kind === 'string' && KINDS.includes(value.kind as ToastKind) ? (value.kind as ToastKind) : 'info';
  return {
    id: String(value.id),
    source: String(value.source) as AppId,
    at: String(value.at ?? '') as IsoTimestamp,
    kind,
    title: String(value.title),
    body: typeof value.body === 'string' ? value.body : '',
    launch: typeof value.launch === 'string' ? (value.launch as AppId) : undefined,
    args: isRecord(value.args) ? (value.args as Readonly<Record<string, string>>) : undefined,
    actions: Array.isArray(value.actions) ? (value.actions as NotificationSpec['actions']) : undefined,
    read: value.read === true,
  };
}

export function createNotifications(
  clock: KernelClock,
  storage: KernelStorage,
  namespace: string,
): NotificationsHandle {
  return new Notifications(clock, storage, `${namespace}:notifications`);
}
