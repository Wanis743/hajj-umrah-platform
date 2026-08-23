import { Loader2, Inbox, AlertTriangle, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)]">
        <Inbox className="h-4.5 w-4.5 h-5 w-5 text-[var(--text-muted)]" />
      </div>
      <p className="empty-title text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      {description && <p className="empty-desc mt-1 text-[13px] text-[var(--text-muted)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p>{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function TableEmpty({ query }: { query?: string }) {
  return (
    <div className="py-10 text-center">
      {query ? (
        <SearchX className="mx-auto mb-2 h-5 w-5 text-[var(--text-muted)]" />
      ) : (
        <Inbox className="mx-auto mb-2 h-5 w-5 text-[var(--text-muted)]" />
      )}
      <p className="text-[13px] text-[var(--text-muted)]">
        {query ? `No results for "${query}"` : 'No data found'}
      </p>
    </div>
  );
}