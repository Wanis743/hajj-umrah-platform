import { X, Check, Phone, Mail, Calendar, Users, FileText, Clock, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

export interface Reservation {
  id: string;
  reference: string;
  package_id: string;
  package_name: string;
  start_date: string;
  end_date: string;
  travelers: number;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

interface Props {
  reservation: Reservation;
  onClose: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function formatDate(dateStr: string, locale: string) {
  try {
    return new Date(dateStr).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function tripDays(start: string, end: string) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function ReservationDetailPanel({ reservation: r, onClose, onConfirm, onCancel, onDelete }: Props) {
  const { t, lang } = useI18n();
  const locale = lang === 'fr' ? 'fr-FR' : lang === 'en' ? 'en-GB' : 'ar-DZ';

  const statusConfig = {
    pending: { label: t.admin.pending, icon: Clock, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/20' },
    confirmed: { label: t.admin.confirmed, icon: CheckCircle2, cls: 'bg-[var(--success-soft)] text-[var(--success)] ring-[var(--success)]/20' },
    cancelled: { label: t.admin.cancelled, icon: XCircle, cls: 'bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/20' },
  }[r.status] ?? { label: r.status, icon: Clock, cls: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] ring-[var(--border-strong)]' };

  const StatusIcon = statusConfig.icon;
  const days = tripDays(r.start_date, r.end_date);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 z-50 flex w-full max-w-md flex-col bg-[var(--surface)] shadow-md ltr:right-0 rtl:left-0 animate-slide-in">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t.admin.reference}</p>
            <p className="font-mono text-lg font-bold text-[var(--accent)]">{r.reference}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusConfig.cls}`}>
            <StatusIcon className="h-3.5 w-3.5" />
            {statusConfig.label}
          </span>

          <div className="mt-6 space-y-4">
            <InfoBlock icon={FileText} label={t.admin.package} value={r.package_name} />
            <InfoBlock icon={Calendar} label={t.admin.dates} value={`${formatDate(r.start_date, locale)} → ${formatDate(r.end_date, locale)}`} sub={`${days} ${t.admin.days}`} />
            <InfoBlock icon={Users} label={t.admin.travelers} value={String(r.travelers)} />
          </div>

          <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t.admin.customer}</p>
            <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{r.name}</p>
            <a href={`tel:${r.phone}`} className="mt-2 flex items-center gap-2 text-sm text-[var(--accent)] hover:underline" dir="ltr">
              <Phone className="h-4 w-4" />
              {r.phone}
            </a>
            {r.email && (
              <a href={`mailto:${r.email}`} className="mt-1 flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:underline" dir="ltr">
                <Mail className="h-4 w-4" />
                {r.email}
              </a>
            )}
          </div>

          {r.notes && (
            <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t.admin.notes}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{r.notes}</p>
            </div>
          )}

          <p className="mt-4 text-xs text-[var(--text-muted)]">
            {t.admin.submittedAt} {formatDate(r.created_at, locale)}
          </p>
        </div>

        <div className="border-t border-[var(--border-subtle)] p-4">
          <div className="flex gap-2">
            {r.status !== 'confirmed' && (
              <button
                onClick={onConfirm}
                className="btn btn-primary flex-1 py-2.5"
              >
                <Check className="h-4 w-4" />
                {t.admin.confirm}
              </button>
            )}
            {r.status !== 'cancelled' && (
              <button
                onClick={onCancel}
                className="btn flex-1 py-2.5 text-[var(--warning)] border-[var(--warning)]/40 bg-[var(--warning-soft)] hover:bg-[var(--warning-soft)]"
              >
                <X className="h-4 w-4" />
                {t.admin.cancel}
              </button>
            )}
            <button
              onClick={onDelete}
              className="btn btn-ghost h-10 w-10 shrink-0 rounded-xl text-[var(--danger)]"
              title={t.admin.delete}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function InfoBlock({ icon: Icon, label, value, sub }: { icon: typeof Calendar; label: string; value: string; sub?: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-hover)] text-[var(--text-secondary)]">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <p className="font-medium text-[var(--text-primary)]">{value}</p>
        {sub && <p className="text-xs text-[var(--text-secondary)]">{sub}</p>}
      </div>
    </div>
  );
}
