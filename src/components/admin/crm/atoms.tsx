/**
 * Presentational atoms shared by the CRM screens. Components only -- the
 * formatters, tone tokens and read hooks live in ./crmFormat and ./crmRows,
 * because a .tsx file that exports a component may not also export plain
 * functions (react-refresh/only-export-components).
 */
import type { ReactNode } from 'react';
import { TONE_CLASS, type Tone } from './crmFormat';

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** A metric. `value` is already formatted -- the tile never rounds or fills in a
 *  missing number, so an em dash here means the server returned null. */
export function Tile({ label, value, hint, tone, onClick }: {
  label: string; value: string; hint?: string; tone?: Tone; onClick?: () => void;
}) {
  const body = (
    <>
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-1 tabular">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>}
      {tone && <span className={`mt-2 block h-1 w-8 rounded-full ${TONE_CLASS[tone]}`} aria-hidden="true" />}
    </>
  );
  if (!onClick) return <div className="card p-4">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="card p-4 text-start transition-colors hover:bg-[var(--bg-hover)]">
      {body}
    </button>
  );
}

export function Panel({ title, subtitle, actions, children, className = '' }: {
  title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Proportional bar. Never scales an unknown value: pass max <= 0 and it renders
 *  an empty track rather than a full one. */
export function Meter({ value, max, tone = 'info', label }: {
  value: number; max: number; tone?: Tone; label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-hover)]"
    >
      <span className={`block h-full rounded-full ${TONE_CLASS[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Label + control. The label wraps the control, so the association survives a
 *  component that renders its own id. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`mt-0.5 text-[13px] text-[var(--text-primary)] ${mono ? 'tabular' : ''}`}>{value}</p>
    </div>
  );
}

/** Success line after a command. Separate from ErrorBanner so a screen can show
 *  "Booking BK-1234 created" without borrowing the danger colours. */
export function NoticeBar({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--success-soft)] bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]"
      role="status"
    >
      <p>{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} className="text-xs font-medium underline underline-offset-2">
          ×
        </button>
      )}
    </div>
  );
}

export function SubTabs({ tabs, active, onChange }: {
  tabs: ReadonlyArray<{ key: string; label: string; count?: number | null }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
            active === tab.key
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && (
            <span className="ms-1.5 text-[11px] opacity-70 tabular">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
