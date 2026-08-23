import type { ComponentType } from 'react';

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="shrink-0 text-sm text-sand-500 dark:text-sand-400">{label}</span>
      <span className="min-w-0 break-words text-end text-sm font-semibold text-sand-900 dark:text-white">{value}</span>
    </div>
  );
}

export function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-sand-50 p-4 dark:bg-sand-950">
      <p className="text-xs text-sand-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-sand-900 dark:text-white">{value}</p>
    </div>
  );
}

export function SideRow({ icon: Icon, label, value }: { icon: ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sand-600 dark:text-sand-400">
      <Icon className="h-4 w-4 shrink-0 text-oasis-500" />
      <span className="shrink-0 text-xs text-sand-400">{label}:</span>
      <span className="min-w-0 break-all text-xs font-medium text-sand-700 dark:text-sand-300" dir="ltr">{value}</span>
    </div>
  );
}
