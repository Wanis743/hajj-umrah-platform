/**
 * One place for "run a DMS command, then tell the user what happened".
 *
 * Every write in these screens is a SECURITY DEFINER RPC that either succeeds or
 * raises. The raises are business rules with text written for the person reading
 * the screen ("Only the submitter's document can be reopened", "A sealed package
 * cannot be voided"), which domainCommands surfaces as user_safe_message for
 * SQLSTATE 22023 and P0001. Showing that text is the whole point: a generic
 * "operation failed" would hide the one sentence that says what to do next.
 */
import { useCallback, useRef, useState } from 'react';
import type { CommandResult } from '@/services/domainCommands';

export interface DmsCommandState {
  /** True while a command is in flight. Buttons disable on it so a double click
   *  cannot seal a package twice. */
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

export function useDmsCommand(): DmsCommandState {
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
