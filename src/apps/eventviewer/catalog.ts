/**
 * Event Viewer — the message catalogue.
 *
 * A Windows event is a number plus a payload; the words come from a message
 * table shipped alongside the provider. This is that table. It has to live app
 * side because `kernel/core/eventlog.ts` owns the ids and an app may not import
 * kernel internals — so the numbers below were copied from `EVENT_IDS` and the
 * two ids the kernel writes from elsewhere (1102 on a clear, 3001 on a timer).
 *
 * An id with no entry still renders: the grid falls back to the raw number, the
 * way Event Viewer shows "The description for Event ID … cannot be found".
 */
import { Bug, CircleX, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { EventChannel, EventLevel, EventRecord, Localized, Tone } from '@/platform/sdk';


/** Newest-first, and never unbounded: the kernel rings are 1500–3000 deep. */
export const PAGE_LIMIT = 500;

export const LEVELS: readonly EventLevel[] = ['critical', 'error', 'warning', 'information', 'verbose'];

/**
 * Windows ships one custom view out of the box — Administrative Events — and it
 * is nothing more than "every channel, but only the three levels an operator has
 * to act on". Same definition here.
 */
export const ADMIN_LEVELS: readonly EventLevel[] = ['critical', 'error', 'warning'];

export const ADMIN_VIEW: Localized = {
  ar: 'أحداث إدارية',
  fr: 'Événements d’administration',
  en: 'Administrative Events',
};

export const LEVEL_LABEL: Readonly<Record<EventLevel, Localized>> = {
  critical: { ar: 'حرج', fr: 'Critique', en: 'Critical' },
  error: { ar: 'خطأ', fr: 'Erreur', en: 'Error' },
  warning: { ar: 'تحذير', fr: 'Avertissement', en: 'Warning' },
  information: { ar: 'معلومات', fr: 'Information', en: 'Information' },
  verbose: { ar: 'تفصيلي', fr: 'Détaillé', en: 'Verbose' },
};

/** Mirrors the kernel's own ordering so a level sort matches `levelRank`. */
export const LEVEL_RANK: Readonly<Record<EventLevel, number>> = {
  critical: 0,
  error: 1,
  warning: 2,
  information: 3,
  verbose: 4,
};

/** The glyph and colour Event Viewer puts in the leftmost column. */
export const LEVEL_ICON: Readonly<Record<EventLevel, LucideIcon>> = {
  critical: OctagonAlert,
  error: CircleX,
  warning: TriangleAlert,
  information: Info,
  verbose: Bug,
};

export function levelTone(level: EventLevel): Tone {
  if (level === 'critical' || level === 'error') return 'danger';
  if (level === 'warning') return 'warning';
  if (level === 'information') return 'info';
  return 'neutral';
}

export const CHANNELS: readonly EventChannel[] = ['Application', 'Security', 'Setup', 'System'];

export const CHANNEL_LABEL: Readonly<Record<EventChannel, Localized>> = {
  Application: { ar: 'التطبيقات', fr: 'Application', en: 'Application' },
  Security: { ar: 'الأمان', fr: 'Sécurité', en: 'Security' },
  Setup: { ar: 'التثبيت', fr: 'Installation', en: 'Setup' },
  System: { ar: 'النظام', fr: 'Système', en: 'System' },
};

export const CHANNEL_HINT: Readonly<Record<EventChannel, Localized>> = {
  Application: {
    ar: 'ما تكتبه التطبيقات نفسها',
    fr: 'Ce que les applications écrivent elles-mêmes',
    en: 'What the apps themselves write',
  },
  Security: {
    ar: 'الصلاحيات والرفض والقيود المحاسبية',
    fr: 'Privilèges, refus et écritures comptables',
    en: 'Privileges, denials and ledger commands',
  },
  Setup: { ar: 'التثبيت والإقلاع', fr: 'Installation et démarrage', en: 'Install and boot' },
  System: { ar: 'النواة والخدمات', fr: 'Noyau et services', en: 'Kernel and services' },
};

/**
 * The "Logged" dropdown of Windows' filter dialog.
 *
 * `EventQuery` has a `since`, but a cutoff derived from `Date.now()` would change
 * on every render and `usePolledSyscall` keys its effect on the request — so the
 * age filter is applied to the returned page instead. The page is the newest 500
 * records either way, which makes the two identical in practice.
 */
export type RangeId = 'hour' | 'day' | 'week' | 'all';

export const RANGES: readonly { readonly id: RangeId; readonly label: Localized; readonly hours: number }[] = [
  { id: 'hour', label: { ar: 'آخر ساعة', fr: 'Dernière heure', en: 'Last hour' }, hours: 1 },
  { id: 'day', label: { ar: 'آخر ٢٤ ساعة', fr: 'Dernières 24 h', en: 'Last 24 hours' }, hours: 24 },
  { id: 'week', label: { ar: 'آخر ٧ أيام', fr: 'Derniers 7 jours', en: 'Last 7 days' }, hours: 24 * 7 },
  { id: 'all', label: { ar: 'كل الفترات', fr: 'Toute la période', en: 'Any time' }, hours: 0 },
];

/** Epoch ms a record must reach to survive the range, or `-Infinity` for all. */
export function rangeCutoff(range: RangeId, nowMs: number): number {
  const entry = RANGES.find((candidate) => candidate.id === range);
  if (entry === undefined || entry.hours === 0) return Number.NEGATIVE_INFINITY;
  return nowMs - entry.hours * 3_600_000;
}

/**
 * The message table: numeric id → what an operator should read.
 *
 * Copied from the kernel's `EVENT_IDS` rather than imported, because the ABI is
 * the only thing an app may depend on. Windows solves it the same way — the
 * numbers are the contract and the strings ship with the viewer.
 */
export const EVENT_NAME: Readonly<Partial<Record<number, Localized>>> = {
  98: { ar: 'تحميل قرص', fr: 'Volume monté', en: 'Volume mounted' },
  100: { ar: 'بدء الإقلاع', fr: 'Démarrage lancé', en: 'Boot started' },
  101: { ar: 'اكتمال الإقلاع', fr: 'Démarrage terminé', en: 'Boot completed' },
  102: { ar: 'بدء الإيقاف', fr: 'Arrêt lancé', en: 'Shutdown started' },
  103: { ar: 'اكتمال الإيقاف', fr: 'Arrêt terminé', en: 'Shutdown completed' },
  200: { ar: 'إنشاء نافذة', fr: 'Fenêtre créée', en: 'Window created' },
  201: { ar: 'إغلاق نافذة', fr: 'Fenêtre fermée', en: 'Window closed' },
  1000: { ar: 'تشغيل تطبيق', fr: 'Application lancée', en: 'App launched' },
  1026: { ar: 'خطأ في نداء نظام', fr: 'Faute d’appel système', en: 'Syscall fault' },
  1033: { ar: 'تثبيت تطبيق', fr: 'Application installée', en: 'App installed' },
  1034: { ar: 'إزالة تطبيق', fr: 'Application désinstallée', en: 'App uninstalled' },
  1074: { ar: 'طلب طاقة', fr: 'Demande d’alimentation', en: 'Power requested' },
  1102: { ar: 'مسح سجل', fr: 'Journal effacé', en: 'Log cleared' },
  2013: { ar: 'تجاوز الحصة', fr: 'Quota dépassé', en: 'Quota exceeded' },
  3001: { ar: 'تسليح مؤقّت', fr: 'Minuteur armé', en: 'Timer armed' },
  4624: { ar: 'تغيّر المستخدم', fr: 'Principal changé', en: 'Principal changed' },
  4647: { ar: 'سحب الصلاحية', fr: 'Privilège révoqué', en: 'Elevation revoked' },
  4656: { ar: 'رفض صلاحية', fr: 'Capacité refusée', en: 'Capability denied' },
  4657: { ar: 'كتابة في السجل', fr: 'Écriture registre', en: 'Registry write' },
  4660: { ar: 'حذف ملف', fr: 'Fichier supprimé', en: 'File deleted' },
  4663: { ar: 'كتابة ملف', fr: 'Fichier écrit', en: 'File written' },
  4673: { ar: 'طلب رفع صلاحية', fr: 'Élévation demandée', en: 'Elevation requested' },
  4674: { ar: 'منح رفع صلاحية', fr: 'Élévation accordée', en: 'Elevation granted' },
  4675: { ar: 'رفض رفع صلاحية', fr: 'Élévation refusée', en: 'Elevation denied' },
  4688: { ar: 'بدء عملية', fr: 'Processus démarré', en: 'Process started' },
  4689: { ar: 'انتهاء عملية', fr: 'Processus terminé', en: 'Process exited' },
  4690: { ar: 'تعليق عملية', fr: 'Processus suspendu', en: 'Process suspended' },
  4691: { ar: 'استئناف عملية', fr: 'Processus reprise', en: 'Process resumed' },
  4692: { ar: 'تغيير أولوية', fr: 'Priorité modifiée', en: 'Priority changed' },
  5136: { ar: 'أمر محاسبي', fr: 'Commande comptable', en: 'Ledger command' },
  5137: { ar: 'فشل أمر محاسبي', fr: 'Commande comptable échouée', en: 'Ledger command failed' },
  5145: { ar: 'استعلام بيانات', fr: 'Requête de données', en: 'Dataset query' },
  7031: { ar: 'تعطّل خدمة', fr: 'Service en panne', en: 'Service faulted' },
  7032: { ar: 'إعادة تشغيل خدمة', fr: 'Service redémarré', en: 'Service restarted' },
  7035: { ar: 'بدء تشغيل خدمة', fr: 'Service en démarrage', en: 'Service starting' },
  7036: { ar: 'تشغيل خدمة', fr: 'Service démarré', en: 'Service started' },
  7037: { ar: 'إيقاف خدمة', fr: 'Service arrêté', en: 'Service stopped' },
  7040: { ar: 'تغيير نوع البدء', fr: 'Type de démarrage modifié', en: 'Start type changed' },
};

/** `EVENT_NAME` is deliberately partial; an unknown id shows as itself. */
export function eventName(eventId: number): Localized | null {
  return EVENT_NAME[eventId] ?? null;
}

/**
 * One event as a text block — what "Copy details" puts on the clipboard and
 * what the saved log repeats per record. Deliberately plain: it has to survive
 * being pasted into a ticket.
 */
export function describe(record: EventRecord): string {
  const lines = [
    `Log Name:      ${record.channel}`,
    `Source:        ${record.source}`,
    `Event ID:      ${record.eventId}`,
    `Level:         ${record.level}`,
    `Logged:        ${record.at}`,
    `Process:       ${record.pid === null ? '—' : record.pid}`,
    '',
    record.message,
  ];
  if (record.data !== undefined) {
    lines.push('', 'Event Data:');
    for (const [key, value] of Object.entries(record.data)) lines.push(`  ${key}: ${String(value)}`);
  }
  return lines.join('\n');
}

/** RFC 4180 quoting: a message can hold a comma, a quote or a line break. */
function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The visible list as CSV.
 *
 * Event Viewer saves what you are looking at rather than what the channel holds,
 * so the caller hands over the filtered rows and the file matches the screen.
 */
export function toCsv(rows: readonly EventRecord[]): string {
  const lines = ['Level,Logged,Channel,Source,EventId,Pid,Message'];
  for (const row of rows) {
    lines.push(
      [
        cell(row.level),
        cell(row.at),
        cell(row.channel),
        cell(row.source),
        cell(row.eventId),
        cell(row.pid),
        cell(row.message),
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** `EventLog-System-20260827-1432.csv` — sortable, and legal on this VFS. */
export function logFileName(scope: string, atMs: number): string {
  const stamp = new Date(atMs).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `EventLog-${scope}-${stamp}.csv`;
}
