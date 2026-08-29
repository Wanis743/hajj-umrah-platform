/**
 * Registry Editor — the writes.
 *
 * Where the confirmations sit is a deliberate split, and it follows the kernel
 * rather than taste. `registry.write` is a privileged capability, but
 * `syscalls.ts` exempts anything under `HKCU` from the elevation gate — your own
 * preferences are yours — so a machine-wide write raises the consent dialog and a
 * per-user one does not. Asking twice for the same act is noise, so:
 *
 *   • setting a value never asks here; `HKLM` gets the kernel's prompt.
 *   • deleting a value asks only under `HKCU`, where nothing else would.
 *   • deleting a key always asks, because it is recursive. The kernel's prompt
 *     names a capability; only this app knows the delete takes 4 subkeys and 11
 *     values with it, and that is the number a person needs before agreeing.
 */
import { useCallback, useState } from 'react';
import { type RegistryEntry, type RegistryValue, fmt, useApp } from '@/platform/sdk';
import { DOCUMENTS, join } from '../shared/paths';
import { isMachineKey, keyName, regFileName, toLongPath, toReg } from './catalog';

export type RegBusy = 'save' | 'delete' | 'export' | null;

export interface RegActions {
  readonly busy: RegBusy;
  /** Resolves `true` when the value landed, so the editor knows to close. */
  readonly write: (key: string, name: string, value: RegistryValue) => Promise<boolean>;
  /** Both resolve `true` only when something was actually removed. */
  readonly removeValue: (key: string, name: string) => Promise<boolean>;
  readonly removeKey: (key: string, subkeys: number, values: number) => Promise<boolean>;
  readonly exportKey: (key: string, subtree: readonly (readonly [string, readonly RegistryEntry[]])[]) => void;
  readonly copy: (text: string) => void;
}

export function useRegActions(onChanged: () => void): RegActions {
  const runtime = useApp();
  const { tr, lang } = runtime.locale;
  const [busy, setBusy] = useState<RegBusy>(null);

  const write = useCallback(
    async (key: string, name: string, value: RegistryValue): Promise<boolean> => {
      setBusy('save');
      const result = await runtime.invoke('registry.set', { key, name, value });
      setBusy(null);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message });
        return false;
      }
      onChanged();
      void runtime.toast({
        kind: 'success',
        title: tr('حُفظت القيمة', 'Valeur enregistrée', 'Value saved'),
        body: `${toLongPath(key)}\\${name}`,
      });
      return true;
    },
    [runtime, tr, onChanged],
  );

  const removeValue = useCallback(
    async (key: string, name: string): Promise<boolean> => {
      if (!isMachineKey(key)) {
        const agreed = await runtime.confirm({
          kind: 'warning',
          destructive: true,
          title: tr('حذف القيمة؟', 'Supprimer la valeur ?', 'Delete this value?'),
          body: tr(
            `ستُحذف القيمة ${name} نهائيًا من ${toLongPath(key)}.`,
            `La valeur ${name} sera définitivement supprimée de ${toLongPath(key)}.`,
            `${name} will be permanently removed from ${toLongPath(key)}.`,
          ),
          confirmLabel: { ar: 'حذف', fr: 'Supprimer', en: 'Delete' },
        });
        if (!agreed) return false;
      }
      setBusy('delete');
      const result = await runtime.invoke('registry.delete', { key, name });
      setBusy(null);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message });
        return false;
      }
      onChanged();
      void runtime.toast({ kind: 'success', title: tr('حُذفت القيمة', 'Valeur supprimée', 'Value deleted') });
      return true;
    },
    [runtime, tr, onChanged],
  );

  const removeKey = useCallback(
    async (key: string, subkeys: number, values: number): Promise<boolean> => {
      const counts = tr(
        `${fmt.integer(subkeys, lang)} مفتاحًا فرعيًا و${fmt.integer(values, lang)} قيمة`,
        `${fmt.integer(subkeys, lang)} sous-clés et ${fmt.integer(values, lang)} valeurs`,
        `${fmt.integer(subkeys, lang)} subkeys and ${fmt.integer(values, lang)} values`,
      );
      const agreed = await runtime.confirm({
        kind: 'warning',
        destructive: true,
        title: tr('حذف المفتاح وكل ما تحته؟', 'Supprimer la clé et son contenu ?', 'Delete this key and everything under it?'),
        body: tr(
          `سيُحذف ${keyName(key)} مع ${counts}. لا يمكن التراجع، وقد تتوقّف الميزات التي تقرأ هذه المفاتيح عن العمل.`,
          `${keyName(key)} sera supprimée avec ${counts}. L’opération est irréversible et les fonctions qui lisent ces clés peuvent cesser de fonctionner.`,
          `${keyName(key)} goes, and with it ${counts}. This cannot be undone, and anything that reads these keys may stop working.`,
        ),
        confirmLabel: { ar: 'حذف', fr: 'Supprimer', en: 'Delete' },
      });
      if (!agreed) return false;
      setBusy('delete');
      const result = await runtime.invoke('registry.delete', { key });
      setBusy(null);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message });
        return false;
      }
      onChanged();
      void runtime.toast({
        kind: 'success',
        title: tr(
          `حُذف ${fmt.integer(result.value.deleted, lang)} قيمة`,
          `${fmt.integer(result.value.deleted, lang)} valeurs supprimées`,
          `Deleted ${fmt.integer(result.value.deleted, lang)} values`,
        ),
      });
      return true;
    },
    [runtime, tr, lang, onChanged],
  );

  const exportKey = useCallback(
    (key: string, subtree: readonly (readonly [string, readonly RegistryEntry[]])[]) => {
      const run = async () => {
        setBusy('export');
        const path = join(DOCUMENTS, regFileName(key));
        const result = await runtime.invoke('fs.writeText', {
          path,
          content: toReg(subtree),
          contentType: 'text/plain',
        });
        setBusy(null);
        void runtime.toast({
          kind: result.ok ? 'success' : 'error',
          title: result.ok ? tr('صُدِّر الفرع', 'Branche exportée', 'Branch exported') : result.error.message,
          ...(result.ok ? { body: path } : {}),
        });
      };
      void run();
    },
    [runtime, tr],
  );

  const copy = useCallback(
    (text: string) => {
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) =>
        runtime.toast({
          kind: result.ok ? 'success' : 'error',
          title: result.ok ? tr('نُسخ', 'Copié', 'Copied') : result.error.message,
          ...(result.ok ? { body: text } : {}),
        }),
      );
    },
    [runtime, tr],
  );

  return { busy, write, removeValue, removeKey, exportKey, copy };
}
