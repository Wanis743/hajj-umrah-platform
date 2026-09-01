/**
 * One place for "run a BI command, then tell the user what happened".
 *
 * Two kinds of write arrive here and they must feel the same to a screen. A status
 * change is an RPC that raises 22023 with an authored sentence ("Deprecating this
 * metric would blank 2 published dashboards"); a definition edit is a table write
 * whose BEFORE trigger raises the same way ("Expression names a column that is not
 * on this source"). domainCommands surfaces both as `user_safe_message`, so this
 * hook does not have to know which one it called.
 *
 * Showing that text is the whole point. A generic "save failed" on an expression
 * editor is the difference between a fixable typo and an unusable screen.
 */
import { useCallback, useRef, useState } from 'react';
import type { CommandResult } from '@/services/domainCommands';

export interface BiCommandState {
  /** True while a command is in flight. Buttons disable on it, so a double click
   *  cannot publish twice or add the same tile to a dashboard twice. */
  busy: boolean;
  error: string | null;
  notice: string | null;
  clear: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  run: <T>(
    op: () => Promise<CommandResult<T>>,
    opts?: { onSuccess?: (data: T | null) => void | Promise<void>; notice?: string },
  ) => Promise<boolean>;
}

export function useBiCommand(): BiCommandState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);

  const clear = useCallback(() => { setError(null); setNotice(null); }, []);

  const run = useCallback(async <T,>(
    op: () => Promise<CommandResult<T>>,
    opts: { onSuccess?: (data: T | null) => void | Promise<void>; notice?: string } = {},
  ): Promise<boolean> => {
    // A ref, not the busy state: two clicks in the same tick both read the old
    // state value, and the second one would still fire the command.
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await op();
      if (!res.success || res.error) {
        setError(res.error?.user_safe_message ?? 'حدث خطأ غير متوقع');
        return false;
      }
      if (opts.notice) setNotice(opts.notice);
      await opts.onSuccess?.(res.data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, error, notice, clear, setError, setNotice, run };
}
