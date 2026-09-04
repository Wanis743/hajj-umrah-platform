/**
 * Tray and taskbar flyouts: Quick Settings, Notification Centre, the calendar
 * and the Widgets board.
 *
 * These are the four surfaces Windows 11 hangs off the taskbar corners. Each one
 * is anchored with `position: absolute` against the shell root and `bottom:
 * calc(var(--fx-taskbar) + 8px)` — never against the taskbar element, which
 * carries `backdrop-filter` and would therefore become the containing block.
 *
 * Every value shown here is read from a kernel subsystem, and every switch
 * writes a registry value that something actually honours: the theme and accent
 * repaint the shell, "Do not disturb" suppresses notification banners, the
 * storage meters are the real VFS quotas. Nothing is decorative. Finance figures
 * deliberately do *not* appear on the Widgets board — those need the data broker
 * and belong to the Dashboard app, which can show a spinner while it loads; a
 * shell surface cannot.
 */
import {
  Activity,
  Bell,
  BellOff,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  FileClock,
  HardDrive,
  Languages,
  Layers,
  Moon,
  Settings as SettingsGlyph,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  APP_IDS,
  REG,
  type AppCategoryId,
  type AppId,
  type NotificationRecord,
  type SystemMetricSample,
  type ToastKind,
  type VfsStat,
} from '../kernel/abi';
import type { Kernel } from '../kernel/contracts';
import { KERNEL_USER_FOLDER } from '../kernel/kernel';
import type { AppLocale } from '../sdk';
import { fmt } from '../sdk';
import { ACCENTS, type Appearance, type ShellLang } from './appearance';
import { useKernel, useKernelAction, useKernelView, useWallClock } from './bindings';
import { iconForContentType } from './iconRegistry';
import { AppIcon } from './icons';

/** Any pointer-down inside one of these keeps the open flyout open. */
export const FLYOUT_DISMISS_SELECTOR =
  '.fx-flyout, .fx-taskbar, .fx-menu, .fx-dialog, .fx-toast-host';

/**
 * Bottom-corner anchoring, mirrored automatically in RTL.
 *
 * An attribute rather than an inline style, because an inline style outranks
 * every stylesheet rule: below desktop width these flyouts become full-bleed
 * sheets, and `data-anchor` lets fluent.css say so without `!important`.
 */
const TRAY_ANCHOR = 'tray';
const START_ANCHOR = 'start';

const LANGS: readonly { readonly id: ShellLang; readonly label: string }[] = [
  { id: 'ar', label: 'العربية' },
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

const pct = (used: number, quota: number): number =>
  quota <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((used / quota) * 100)));

/* ------------------------------------------------------------------ *
 * Quick settings
 * ------------------------------------------------------------------ */

export interface QuickSettingsProps {
  readonly locale: AppLocale;
  readonly appearance: Appearance;
  readonly onDismiss: () => void;
}

export function QuickSettings({ locale, appearance, onDismiss }: QuickSettingsProps) {
  const kernel = useKernel();
  const runAction = useKernelAction();
  const volumes = useKernelView(kernel.vfs, () => kernel.vfs.volumes());
  const quiet = useKernelView(kernel.registry, () =>
    kernel.registry.getBoolean(REG.userSession, 'DoNotDisturb', false),
  );

  const look = (name: string, value: string | boolean) => kernel.registry.set(REG.userAppearance, name, value);

  return (
    <div className="fx-flyout fx-quick" data-anchor={TRAY_ANCHOR} role="dialog" aria-label="Quick settings">
      <div className="fx-quick-grid">
        <QuickTile
          on={appearance.theme === 'dark'}
          glyph={appearance.theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          title={locale.tr('المظهر', 'Thème', 'Theme')}
          state={
            appearance.theme === 'dark' ? locale.tr('داكن', 'Sombre', 'Dark') : locale.tr('فاتح', 'Clair', 'Light')
          }
          onToggle={() => look('Theme', appearance.theme === 'dark' ? 'light' : 'dark')}
        />
        <QuickTile
          on={appearance.transparency}
          glyph={<Layers size={18} />}
          title={locale.tr('الشفافية', 'Transparence', 'Transparency')}
          state={onOff(locale, appearance.transparency)}
          onToggle={() => look('Transparency', !appearance.transparency)}
        />
        <QuickTile
          on={appearance.animations}
          glyph={<Sparkles size={18} />}
          title={locale.tr('الحركات', 'Animations', 'Animations')}
          state={onOff(locale, appearance.animations)}
          onToggle={() => look('Animations', !appearance.animations)}
        />
        <QuickTile
          on={quiet}
          glyph={quiet ? <BellOff size={18} /> : <Bell size={18} />}
          title={locale.tr('عدم الإزعاج', 'Ne pas déranger', 'Do not disturb')}
          state={onOff(locale, quiet)}
          onToggle={() => kernel.registry.set(REG.userSession, 'DoNotDisturb', !quiet)}
        />
      </div>

      <div className="fx-quick-row">
        <span className="fx-caption-text">{locale.tr('لون التمييز', 'Couleur d’accentuation', 'Accent colour')}</span>
        <div className="fx-quick-accents">
          {ACCENTS.map((swatch) => (
            <button
              key={swatch.id}
              type="button"
              className="fx-quick-accent"
              data-active={appearance.accent.toLowerCase() === swatch.hex ? 'true' : 'false'}
              style={{ background: swatch.hex }}
              title={locale.t(swatch.name)}
              aria-label={locale.t(swatch.name)}
              onClick={() => look('Accent', swatch.hex)}
            />
          ))}
        </div>
      </div>

      <div className="fx-quick-row">
        <span className="fx-caption-text">
          <Languages size={13} /> {locale.tr('اللغة', 'Langue', 'Language')}
        </span>
        <div className="fx-quick-langs">
          {LANGS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="fx-btn"
              data-size="sm"
              data-variant={appearance.language === entry.id ? 'accent' : undefined}
              onClick={() => look('Language', entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fx-quick-row">
        <span className="fx-caption-text">
          <HardDrive size={13} /> {locale.tr('التخزين', 'Stockage', 'Storage')}
        </span>
        {volumes.map((volume) => (
          <div key={volume.letter} className="fx-quick-volume">
            <div className="fx-quick-volume-head">
              <span>
                {locale.t(volume.label)} ({volume.letter})
              </span>
              <span className="fx-caption-text fx-num">
                {fmt.bytes(volume.usedBytes, locale.lang)} / {fmt.bytes(volume.quotaBytes, locale.lang)}
              </span>
            </div>
            <div className="fx-progress">
              <div className="fx-progress-fill" style={{ width: `${pct(volume.usedBytes, volume.quotaBytes)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="fx-quick-footer">
        <button
          type="button"
          className="fx-btn"
          data-size="sm"
          onClick={() => {
            onDismiss();
            void runAction(locale.tr('الإعدادات', 'Paramètres', 'Settings'), () => kernel.launch(APP_IDS.settings));
          }}
        >
          <SettingsGlyph size={14} />
          {locale.tr('كل الإعدادات', 'Tous les paramètres', 'All settings')}
        </button>
      </div>
    </div>
  );
}

const onOff = (locale: AppLocale, value: boolean): string =>
  value ? locale.tr('مفعّل', 'Activé', 'On') : locale.tr('معطّل', 'Désactivé', 'Off');

function QuickTile({
  on,
  glyph,
  title,
  state,
  onToggle,
}: {
  on: boolean;
  glyph: ReactNode;
  title: string;
  state: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="fx-quick-tile" data-on={on ? 'true' : 'false'} onClick={onToggle}>
      <span className="fx-quick-tile-glyph">{glyph}</span>
      <span className="fx-quick-tile-text">
        <span>{title}</span>
        <span className="fx-caption-text">{state}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Notification centre
 * ------------------------------------------------------------------ */

const TONES: Readonly<Record<ToastKind, string>> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

interface NotifGroup {
  readonly appId: AppId;
  readonly name: string;
  readonly icon: string;
  readonly category: AppCategoryId;
  readonly records: readonly NotificationRecord[];
}

export interface NotificationCentreProps {
  readonly locale: AppLocale;
  readonly onDismiss: () => void;
}

export function NotificationCentre({ locale, onDismiss }: NotificationCentreProps) {
  const kernel = useKernel();
  const runAction = useKernelAction();
  const records = useKernelView(kernel.notifications, () => kernel.notifications.list());

  // Opening the centre is what marks the queue read, exactly as in Windows.
  useEffect(() => {
    kernel.notifications.markAllRead();
  }, [kernel]);

  // Newest first is already the subsystem's order, so grouping only has to keep
  // first-seen order to leave the freshest sender at the top.
  const groups = useMemo<readonly NotifGroup[]>(() => {
    const order: AppId[] = [];
    const byApp = new Map<AppId, NotificationRecord[]>();
    for (const record of records) {
      const bucket = byApp.get(record.source);
      if (bucket === undefined) {
        byApp.set(record.source, [record]);
        order.push(record.source);
      } else {
        bucket.push(record);
      }
    }
    return order.map((appId) => {
      const installed = kernel.apps.get(appId);
      return {
        appId,
        name: installed === null ? (appId as string) : locale.t(installed.manifest.name),
        icon: installed === null ? 'bell' : installed.manifest.icon,
        category: installed === null ? ('system' as AppCategoryId) : installed.manifest.category,
        records: byApp.get(appId) ?? [],
      };
    });
  }, [records, kernel, locale]);

  const open = (record: NotificationRecord) => {
    onDismiss();
    kernel.notifications.dismiss(record.id);
    void runAction(record.title, () => kernel.launch(record.launch ?? record.source, record.args));
  };

  const act = (record: NotificationRecord, actionId: string) => {
    kernel.notifications.dismiss(record.id);
    void runAction(record.title, () => kernel.sendCommand(record.source, actionId, record.args));
  };

  return (
    <div className="fx-flyout fx-notif" data-anchor={TRAY_ANCHOR} role="dialog" aria-label="Notifications">
      <div className="fx-notif-head">
        <span className="fx-subtitle-text">{locale.tr('الإشعارات', 'Notifications', 'Notifications')}</span>
        <button
          type="button"
          className="fx-btn"
          data-size="sm"
          disabled={records.length === 0}
          onClick={() => kernel.notifications.clear()}
        >
          <Trash2 size={13} />
          {locale.tr('مسح الكل', 'Tout effacer', 'Clear all')}
        </button>
      </div>

      <div className="fx-notif-body fx-scroll">
        {groups.length === 0 ? (
          <p className="fx-notif-empty fx-caption-text">
            <Bell size={22} strokeWidth={1.5} />
            {locale.tr('لا إشعارات جديدة', 'Aucune notification', 'No new notifications')}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.appId as string} className="fx-notif-group">
              <header className="fx-notif-group-head">
                <AppIcon icon={group.icon} category={group.category} size={16} />
                <span className="fx-caption-text">{group.name}</span>
              </header>
              {group.records.map((record) => (
                <article key={record.id} className="fx-notif-card">
                  <button type="button" className="fx-notif-main" onClick={() => open(record)}>
                    <span className="fx-notif-title">
                      <span className="fx-badge" data-tone={TONES[record.kind]}>
                        {record.kind}
                      </span>
                      {record.title}
                    </span>
                    <span className="fx-notif-text">{record.body}</span>
                    <span className="fx-caption-text">{fmt.relativeTime(record.at, locale.lang)}</span>
                  </button>
                  {record.actions !== undefined && record.actions.length > 0 ? (
                    <div className="fx-notif-actions">
                      {record.actions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          className="fx-btn"
                          data-size="sm"
                          onClick={() => act(record, action.id)}
                        >
                          {locale.t(action.label)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="fx-notif-close"
                    title={locale.tr('تجاهل', 'Ignorer', 'Dismiss')}
                    aria-label={locale.tr('تجاهل', 'Ignorer', 'Dismiss')}
                    onClick={() => kernel.notifications.dismiss(record.id)}
                  >
                    <X size={13} />
                  </button>
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Six full weeks, so the grid never changes height between months. */
function monthGrid(month: Date, weekStart: number): readonly Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = first.getTime() - lead * DAY_MS;
  return Array.from({ length: 42 }, (_, index) => new Date(start + index * DAY_MS));
}

export interface CalendarFlyoutProps {
  readonly locale: AppLocale;
}

export function CalendarFlyout({ locale }: CalendarFlyoutProps) {
  const kernel = useKernel();
  const now = useWallClock(30_000);
  const [cursor, setCursor] = useState(() => new Date());
  const period = useKernelView(kernel.registry, () => kernel.registry.getString(REG.userSession, 'Period', ''));

  // French calendars start on Monday; Arabic and English on Sunday.
  const weekStart = locale.lang === 'fr' ? 1 : 0;
  const days = useMemo(() => monthGrid(cursor, weekStart), [cursor, weekStart]);
  const heading = new Intl.DateTimeFormat(locale.intlLocale, { month: 'long', year: 'numeric' }).format(cursor);
  const narrow = new Intl.DateTimeFormat(locale.intlLocale, { weekday: 'narrow' });

  const shift = (months: number) => {
    setCursor((value) => new Date(value.getFullYear(), value.getMonth() + months, 1));
  };

  return (
    <div className="fx-flyout fx-cal" data-anchor={TRAY_ANCHOR} role="dialog" aria-label="Calendar">
      <div className="fx-cal-now">
        <span className="fx-title-text">{fmt.time(now, locale.lang)}</span>
        <span className="fx-caption-text">{fmt.date(now, locale.lang)}</span>
        {period.length > 0 ? (
          <span className="fx-badge" data-tone="accent">
            {locale.tr('الفترة', 'Période', 'Period')} {period}
          </span>
        ) : null}
      </div>

      <div className="fx-cal-head">
        <button
          type="button"
          className="fx-btn"
          data-size="sm"
          onClick={() => setCursor(new Date())}
          disabled={sameDay(new Date(cursor.getFullYear(), cursor.getMonth(), 1), new Date(now.getFullYear(), now.getMonth(), 1))}
        >
          {locale.tr('اليوم', 'Aujourd’hui', 'Today')}
        </button>
        <span className="fx-cal-month">{heading}</span>
        <span className="fx-cal-nav">
          <button
            type="button"
            className="fx-icon-btn"
            aria-label={locale.tr('الشهر السابق', 'Mois précédent', 'Previous month')}
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="fx-icon-btn"
            aria-label={locale.tr('الشهر التالي', 'Mois suivant', 'Next month')}
            onClick={() => shift(1)}
          >
            <ChevronRight size={15} />
          </button>
        </span>
      </div>

      <div className="fx-cal-grid">
        {days.slice(0, 7).map((day) => (
          <span key={`h-${day.getTime()}`} className="fx-cal-weekday">
            {narrow.format(day)}
          </span>
        ))}
        {days.map((day) => (
          <span
            key={day.getTime()}
            className="fx-cal-day"
            data-today={sameDay(day, now) ? 'true' : 'false'}
            data-outside={day.getMonth() === cursor.getMonth() ? 'false' : 'true'}
          >
            {day.getDate()}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Widgets
 * ------------------------------------------------------------------ */

function Sparkline({ samples }: { samples: readonly SystemMetricSample[] }) {
  const recent = samples.slice(-40);
  if (recent.length < 2) return <div className="fx-spark" />;
  const points = recent
    .map((sample, index) => {
      const x = (index / (recent.length - 1)) * 100;
      const y = 28 - Math.max(0, Math.min(100, sample.cpuPercent)) * 0.26;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg className="fx-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--fx-accent)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Widget({
  glyph,
  title,
  action,
  onOpen,
  children,
}: {
  glyph: ReactNode;
  title: string;
  action?: ReactNode;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="fx-widget">
      <header className="fx-widget-head">
        <span className="fx-widget-title">
          {glyph}
          {title}
        </span>
        {action}
        {onOpen !== undefined ? (
          <button type="button" className="fx-btn" data-size="sm" onClick={onOpen}>
            <ChevronRight size={13} />
          </button>
        ) : null}
      </header>
      <div className="fx-widget-body">{children}</div>
    </section>
  );
}

export interface WidgetsBoardProps {
  readonly locale: AppLocale;
  readonly onDismiss: () => void;
}

export function WidgetsBoard({ locale, onDismiss }: WidgetsBoardProps) {
  const kernel = useKernel();
  const runAction = useKernelAction();
  const now = useWallClock(20_000);
  const metrics = useKernelView(kernel.metrics, () => kernel.metrics.system());
  const services = useKernelView(kernel.services, () => kernel.services.list());
  const volumes = useKernelView(kernel.vfs, () => kernel.vfs.volumes());
  const errors = useKernelView(kernel.eventLog, () =>
    kernel.eventLog.query({ levels: ['critical', 'error'], limit: 5 }),
  );
  const docs = useKernelView(kernel.vfs, () => recentDocuments(kernel, 4));

  const launch = (id: (typeof APP_IDS)[keyof typeof APP_IDS], args?: Record<string, string>) => {
    onDismiss();
    void runAction(locale.tr('تشغيل', 'Lancer', 'Launch'), () => kernel.launch(id, args));
  };

  const running = services.filter((service) => service.state === 'running').length;
  const faulted = services.filter((service) => service.state === 'faulted');
  const work = services.reduce((total, service) => total + service.workCompleted, 0);

  return (
    <div className="fx-flyout fx-widgets fx-scroll" data-anchor={START_ANCHOR} role="dialog" aria-label="Widgets">
      <Widget glyph={<Clock size={14} />} title={locale.tr('الوقت', 'Heure', 'Clock')}>
        <div className="fx-widget-clock">
          <span className="fx-widget-time">{fmt.time(now, locale.lang)}</span>
          <span className="fx-caption-text">{fmt.date(now, locale.lang)}</span>
        </div>
        <p className="fx-caption-text">
          {locale.tr('مدة التشغيل', 'Temps de fonctionnement', 'Uptime')} · {fmt.duration(metrics.uptimeMs, locale.lang)}
        </p>
      </Widget>

      <Widget
        glyph={<Cpu size={14} />}
        title={locale.tr('أداء النظام', 'Performances', 'Performance')}
        onOpen={() => launch(APP_IDS.settings, { command: 'page:system' })}
      >
        <Sparkline samples={metrics.history} />
        <dl className="fx-widget-stats">
          <Stat label="CPU" value={fmt.percent(metrics.cpuPercent / 100, locale.lang, 0)} />
          <Stat label={locale.tr('الذاكرة', 'Mémoire', 'Memory')} value={fmt.bytes(metrics.memoryBytes, locale.lang)} />
          <Stat
            label={locale.tr('العمليات', 'Processus', 'Processes')}
            value={fmt.integer(metrics.processCount, locale.lang)}
          />
          <Stat label={locale.tr('المقابض', 'Handles', 'Handles')} value={fmt.integer(metrics.handleCount, locale.lang)} />
        </dl>
      </Widget>

      <Widget
        glyph={<Activity size={14} />}
        title={locale.tr('الخدمات', 'Services', 'Services')}
        action={
          <span className="fx-badge" data-tone={faulted.length > 0 ? 'danger' : 'success'}>
            {running}/{services.length}
          </span>
        }
        onOpen={() => launch(APP_IDS.eventViewer, { command: 'channel:System' })}
      >
        {faulted.length > 0 ? (
          <p className="fx-widget-alert">
            {faulted.map((service) => locale.t(service.display)).join(' · ')}
          </p>
        ) : (
          <p className="fx-caption-text">
            {locale.tr('كل الخدمات تعمل', 'Tous les services fonctionnent', 'All services healthy')} ·{' '}
            {fmt.integer(work, locale.lang)} {locale.tr('مهمة', 'tâches', 'tasks')}
          </p>
        )}
      </Widget>

      <Widget
        glyph={<HardDrive size={14} />}
        title={locale.tr('التخزين', 'Stockage', 'Storage')}
        onOpen={() => launch(APP_IDS.settings, { command: 'page:storage' })}
      >
        {volumes.map((volume) => (
          <div key={volume.letter} className="fx-quick-volume">
            <div className="fx-quick-volume-head">
              <span>
                {locale.t(volume.label)} ({volume.letter})
              </span>
              <span className="fx-caption-text fx-num">{pct(volume.usedBytes, volume.quotaBytes)}%</span>
            </div>
            <div className="fx-progress">
              <div className="fx-progress-fill" style={{ width: `${pct(volume.usedBytes, volume.quotaBytes)}%` }} />
            </div>
          </div>
        ))}
      </Widget>

      <Widget
        glyph={<FileClock size={14} />}
        title={locale.tr('ملفات حديثة', 'Fichiers récents', 'Recent files')}
      >
        {docs.length === 0 ? (
          <p className="fx-caption-text">{locale.tr('لا شيء بعد', 'Rien pour l’instant', 'Nothing yet')}</p>
        ) : (
          docs.map((stat) => {
            const Glyph = iconForContentType(stat.contentType, stat.kind);
            return (
              <button
                key={stat.path}
                type="button"
                className="fx-widget-row"
                onClick={() => {
                  onDismiss();
                  void runAction(stat.name, () => kernel.openPath(stat.path));
                }}
              >
                <Glyph size={16} strokeWidth={1.6} />
                <span className="fx-widget-row-text">{stat.name}</span>
                <span className="fx-caption-text">{fmt.relativeTime(stat.modifiedAt, locale.lang)}</span>
              </button>
            );
          })
        )}
      </Widget>

      <Widget
        glyph={<CalendarDays size={14} />}
        title={locale.tr('سجل الأحداث', 'Journal des événements', 'Event log')}
        action={
          <span className="fx-badge" data-tone={errors.length > 0 ? 'warning' : 'neutral'}>
            {fmt.integer(errors.length, locale.lang)}
          </span>
        }
        onOpen={() => launch(APP_IDS.eventViewer)}
      >
        {errors.length === 0 ? (
          <p className="fx-caption-text">{locale.tr('لا أخطاء مسجلة', 'Aucune erreur', 'No errors logged')}</p>
        ) : (
          errors.slice(0, 3).map((record) => (
            <p key={record.id} className="fx-widget-row-text fx-caption-text">
              {record.source} · {record.message}
            </p>
          ))
        )}
      </Widget>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fx-widget-stat">
      <dt className="fx-caption-text">{label}</dt>
      <dd className="fx-num">{value}</dd>
    </div>
  );
}

/** Newest files in the user's Documents folder. */
function recentDocuments(kernel: Kernel, limit: number): readonly VfsStat[] {
  const listed = kernel.vfs.list(`${KERNEL_USER_FOLDER}\\Documents`, false);
  if (!listed.ok) return [];
  return listed.value
    .filter((stat) => stat.kind === 'file')
    .slice()
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, limit);
}
