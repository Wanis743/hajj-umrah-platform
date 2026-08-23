/* eslint-disable react-refresh/only-export-components -- provider module intentionally
   exports its context hook alongside the provider component. */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ConfirmOptions = { title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setPending({ ...options, resolve });
  }), []);
  const close = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setPending(null);
  }, []);
  const value = useMemo(() => confirm, [confirm]);
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <h2 id="confirm-title" className="text-base font-bold text-zinc-900 dark:text-zinc-50">{pending.title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{pending.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => close(false)} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5">{pending.cancelLabel ?? 'Cancel'}</button>
              <button type="button" autoFocus onClick={() => close(true)} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${pending.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{pending.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirmDialog() {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('useConfirmDialog must be used inside ConfirmProvider');
  return value;
}
