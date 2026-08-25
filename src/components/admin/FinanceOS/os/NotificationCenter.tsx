import React from 'react';
import { BellOff, Info, AlertTriangle, CheckCircle2, XCircle, Trash2, ExternalLink } from 'lucide-react';
import { useOS } from './OSContext';
import { APP_MAP } from './apps';
import type { OSNotification } from './osTypes';

const KIND_ICON = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  error: XCircle,
} as const;

const KIND_COLOR = {
  info: 'text-sky-400',
  warning: 'text-amber-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
} as const;

function timeAgo(time: number, locale: string, now: number): string {
  const diffSec = Math.max(0, Math.round((now - time) / 1000));
  if (diffSec < 60) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'minute') ?? '';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffMin, 'minute');
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffH, 'hour');
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.round(diffH / 24), 'day');
}

/**
 * macOS-style notification center, fed by live ledger signals (unposted
 * journals, unmatched bank lines, open fiscal period) plus session messages.
 * Every action item deep-links into the relevant app.
 */
export function NotificationCenter() {
  const { notifications, clearNotifications, markAllRead, setOverlay, openApp, tr, lang } = useOS();
  const locale = lang === 'ar' || lang === 'dz' ? 'ar' : lang;

  React.useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  const open = (n: OSNotification) => {
    if (!n.appId) return;
    openApp(n.appId);
    setOverlay(null);
  };

  return (
    <div className="fos-pop absolute bottom-[74px] end-3 z-[310] flex max-h-[min(560px,calc(100vh-120px))] w-[min(380px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#131622]/95 shadow-2xl backdrop-blur-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white/90">{tr('مركز الإشعارات', 'Centre de notifications', 'Notifications')}</div>
          <div className="text-[11px] text-white/40">
            {tr('مباشرة من الدفاتر', 'En direct du grand livre', 'Straight from the ledger')}
          </div>
        </div>
        {notifications.length > 0 && (
          <button
            onClick={clearNotifications}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tr('مسح الكل', 'Tout effacer', 'Clear all')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5">
              <BellOff className="h-6 w-6 text-white/25" />
            </span>
            <div>
              <div className="text-sm font-medium text-white/60">{tr('لا جديد', 'Rien à signaler', 'All caught up')}</div>
              <div className="mt-1 text-xs text-white/35">
                {tr('الدفاتر متوازنة والتسوية مكتملة.', 'Grand livre équilibré, rapprochement à jour.', 'Books are balanced and the bank is reconciled.')}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {notifications.map((n) => {
              const Icon = KIND_ICON[n.kind];
              const target = n.appId ? APP_MAP[n.appId] : undefined;
              return (
                <button
                  key={n.id}
                  onClick={() => open(n)}
                  disabled={!target}
                  className={`w-full rounded-xl border border-white/5 bg-white/[0.04] p-3 text-start transition-colors ${
                    target ? 'cursor-pointer hover:bg-white/[0.08]' : 'cursor-default'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon className={`mt-0.5 h-4 w-4 flex-none ${KIND_COLOR[n.kind]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-white/85">{n.title}</span>
                        <span className="flex-none text-[10px] text-white/30">
                          {timeAgo(n.time, locale, Date.now())}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-white/55">{n.body}</p>
                      {target && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-white/40">
                          <ExternalLink className="h-3 w-3" />
                          {tr(target.title.ar, target.title.fr, target.title.en)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
