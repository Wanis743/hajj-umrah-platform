import { useCallback, useState } from 'react';
import type { CommandResult } from '@/services/domainCommands';
import { runCommand, type CommandLang, type CommandOutcome } from '@/lib/commandFeedback';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * UI-side wrapper around the domain command layer.
 * - never treats a failed command as a success
 * - surfaces a localized error message and the correlation id
 * - only runs the success callback (refetch/close) when the command actually succeeded
 */
export function useCommandRunner() {
  const { lang } = useI18n();
  const commandLang: CommandLang = lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr' : 'en';
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T,>(
      eventName: string,
      exec: () => Promise<CommandResult<T>>,
      onSuccess?: () => void | Promise<void>,
    ): Promise<CommandOutcome<T>> => {
      setPending(true);
      setError(null);
      const outcome = await runCommand<T>(eventName, exec, commandLang);
      if (outcome.ok) {
        await onSuccess?.();
      } else {
        setError(outcome.message);
      }
      setPending(false);
      return outcome;
    },
    [commandLang],
  );

  return { run, error, setError, clearError, pending };
}
