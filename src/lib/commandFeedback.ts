import type { CommandResult } from '@/services/domainCommands';
import { reportError, reportWarning } from '@/lib/logger';

export type CommandLang = 'ar' | 'fr' | 'en';

type Localized = { ar: string; fr: string; en: string };

const CODE_MESSAGES: Record<string, Localized> = {
  UNAUTHORIZED: {
    ar: 'ليست لديك الصلاحية لتنفيذ هذه العملية.',
    fr: "Vous n'avez pas l'autorisation d'effectuer cette opération.",
    en: 'You are not authorized to perform this operation.',
  },
  INVALID_STATE_TRANSITION: {
    ar: 'انتقال حالة غير صالح: العملية مرفوضة للحفاظ على سلامة البيانات.',
    fr: 'Transition de statut invalide : opération refusée.',
    en: 'Invalid state transition: the operation was rejected.',
  },
  NOT_FOUND: {
    ar: 'العنصر غير موجود أو خارج نطاق صلاحياتك.',
    fr: "Élément introuvable ou hors de votre périmètre.",
    en: 'Item not found or outside your scope.',
  },
  VALIDATION_FAILED: {
    ar: 'بيانات غير صالحة. راجع الحقول المطلوبة.',
    fr: 'Données invalides. Vérifiez les champs requis.',
    en: 'Invalid data. Please review the required fields.',
  },
  CONFLICT: {
    ar: 'تعارض في التعديل: تم تحديث السجل من مستخدم آخر. أعد المحاولة بعد التحديث.',
    fr: 'Conflit de modification : enregistrement déjà modifié. Réessayez après actualisation.',
    en: 'Edit conflict: the record was changed by someone else. Refresh and retry.',
  },
  RETRYABLE: {
    ar: 'تعذّر تنفيذ العملية مؤقتًا. أعد المحاولة.',
    fr: "Opération temporairement indisponible. Réessayez.",
    en: 'The operation failed temporarily. Please retry.',
  },
  UNKNOWN: {
    ar: 'فشلت العملية على الخادم. تم تسجيل المرجع للدعم الفني.',
    fr: "Échec de l'opération côté serveur. La référence a été enregistrée.",
    en: 'The server rejected the operation. A support reference was logged.',
  },
};

/** Maps Postgres/PostgREST error codes to the business command codes above. */
export function normalizeCommandCode(code: string | undefined, retryable: boolean): string {
  if (!code) return retryable ? 'RETRYABLE' : 'UNKNOWN';
  if (code in CODE_MESSAGES) return code;
  switch (code) {
    case '42501':
    case 'PGRST301':
      return 'UNAUTHORIZED';
    case '22023':
      return 'INVALID_STATE_TRANSITION';
    case 'P0002':
    case 'PGRST116':
      return 'NOT_FOUND';
    case '23514':
    case '23502':
      return 'VALIDATION_FAILED';
    case '23505':
    case '40001':
      return 'CONFLICT';
    default:
      return retryable ? 'RETRYABLE' : 'UNKNOWN';
  }
}

export function commandErrorMessage(
  error: CommandResult<unknown>['error'],
  lang: CommandLang,
): string {
  if (!error) return '';
  const key = normalizeCommandCode(String(error.code ?? ''), Boolean(error.retryable));
  return (CODE_MESSAGES[key] ?? CODE_MESSAGES['UNKNOWN'])[lang];
}

export interface CommandOutcome<T> {
  ok: boolean;
  data: T | null;
  /** Localized, user-facing message. Empty when the command succeeded. */
  message: string;
  /** Support reference to quote in a ticket. */
  correlationId: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
}

/**
 * Executes a domain command, logs the correlation id, and returns a localized outcome.
 * Callers must only refetch/close dialogs when `ok` is true.
 */
export async function runCommand<T>(
  eventName: string,
  exec: () => Promise<CommandResult<T>>,
  lang: CommandLang,
): Promise<CommandOutcome<T>> {
  let result: CommandResult<T>;
  try {
    result = await exec();
  } catch (err) {
    reportError(eventName, err);
    return {
      ok: false,
      data: null,
      message: CODE_MESSAGES['UNKNOWN'][lang],
      correlationId: '',
      retryable: true,
    };
  }

  if (result.success && !result.error) {
    return { ok: true, data: result.data, message: '', correlationId: result.correlationId, retryable: false };
  }

  const code = normalizeCommandCode(String(result.error?.code ?? ''), Boolean(result.error?.retryable));
  reportWarning(eventName, { code, correlation_id: result.correlationId });
  return {
    ok: false,
    data: null,
    message: `${(CODE_MESSAGES[code] ?? CODE_MESSAGES['UNKNOWN'])[lang]} [${result.correlationId.slice(0, 8)}]`,
    correlationId: result.correlationId,
    retryable: code === 'RETRYABLE' || code === 'CONFLICT',
    fieldErrors: result.error?.fieldErrors ?? {},
  };
}
