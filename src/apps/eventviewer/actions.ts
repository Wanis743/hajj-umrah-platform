/**
 * Event Viewer — the three things it can do to a log.
 *
 * Copy, save and clear share one shape: one syscall, one toast, and no state
 * beyond which of them is in flight. They live in a hook rather than in the shell
 * because the shell is about *which* records you are looking at, and these are
 * about what happens to them.
 *
 * Clear is the interesting one. `eventlog.write` is unprivileged, so the kernel's
 * elevation gate never fires and no consent dialog appears on its own — the
 * inverse of the power buttons in Settings, where asking twice would be noise.
 * Wiping an audit trail is exactly the act that deserves the question, so this
 * asks it, and says plainly that the clear is itself written to the Security log.
 */
import { useCallback, useState } from 'react';
import { type EventChannel, type EventRecord, fmt, useApp } from '@/platform/sdk';
import { DOCUMENTS, join } from '../shared/paths';
import { describe, logFileName, toCsv } from './catalog';

export interface LogActions {
  readonly busy: 'save' | 'clear' | null;
  readonly copy: (record: EventRecord) => void;
  readonly save: () => void;
  readonly clear: () => void;
}

/**
 * @param channel   the log being shown, or `null` on a custom view (nothing to clear)
 * @param label     that log's name, for the confirmation and the file name
 * @param rows       the filtered rows — Event Viewer saves the screen, not the ring
 * @param onCleared  called after a successful clear so the shell can re-query
 */
export function useLogActions(
  channel: EventChannel | null,
  label: string,
  rows: readonly EventRecord[],
  onCleared: () => void,
): LogActions {
  const runtime = useApp();
  const { tr, lang } = runtime.locale;
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);

  const copy = useCallback(
    (record: EventRecord) => {
      void runtime.invoke('shell.clipboardWrite', { text: describe(record) }).then((result) =>
        runtime.toast({
          kind: result.ok ? 'success' : 'error',
          title: result.ok ? tr('نُسخت التفاصيل', 'Détails copiés', 'Details copied') : result.error.message,
        }),
      );
    },
    [runtime, tr],
  );

  const save = useCallback(() => {
    const run = async () => {
      setBusy('save');
      const path = join(DOCUMENTS, logFileName(channel ?? 'Administrative', Date.now()));
      const result = await runtime.invoke('fs.writeText', {
        path,
        content: toCsv(rows),
        contentType: 'text/csv',
      });
      setBusy(null);
      void runtime.toast({
        kind: result.ok ? 'success' : 'error',
        title: result.ok ? tr('حُفظ السجل', 'Journal enregistré', 'Log saved') : result.error.message,
        ...(result.ok ? { body: path } : {}),
      });
    };
    void run();
  }, [runtime, tr, channel, rows]);

  const clear = useCallback(() => {
    if (channel === null) return;
    const run = async () => {
      const agreed = await runtime.confirm({
        kind: 'warning',
        destructive: true,
        title: tr('مسح السجل؟', 'Effacer le journal ?', 'Clear this log?'),
        body: tr(
          `سيُحذف كل ما في سجل ${label} نهائيًا، وليس الصفوف المعروضة فقط. وسيُسجَّل المسح نفسه في سجل الأمان.`,
          `Tout le journal ${label} sera supprimé définitivement, pas seulement les lignes affichées. L’effacement lui-même est consigné dans le journal Sécurité.`,
          `The entire ${label} log is removed permanently, not just the rows on screen. The clear itself is recorded in the Security log.`,
        ),
        confirmLabel: { ar: 'مسح', fr: 'Effacer', en: 'Clear' },
      });
      if (!agreed) return;
      setBusy('clear');
      const result = await runtime.invoke('eventlog.clear', { channel });
      setBusy(null);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message });
        return;
      }
      const cleared = fmt.integer(result.value.cleared, lang);
      onCleared();
      void runtime.toast({
        kind: 'success',
        title: tr(`مُسح ${cleared} حدثًا`, `${cleared} événements effacés`, `Cleared ${cleared} events`),
      });
    };
    void run();
  }, [runtime, tr, lang, channel, label, onCleared]);

  return { busy, copy, save, clear };
}
