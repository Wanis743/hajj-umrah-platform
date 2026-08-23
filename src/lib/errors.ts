export type AppErrorCode =
  | 'AUTH_INVALID' | 'PERMISSION_DENIED' | 'VALIDATION_ERROR' | 'NETWORK_ERROR'
  | 'RATE_LIMITED' | 'SERVER_ERROR' | 'UNKNOWN_ERROR'
  | 'CAPACITY_EXCEEDED' | 'STALE_VERSION' | 'INVALID_STATE_TRANSITION'
  | 'PAYMENT_ALREADY_REVERSED' | 'FISCAL_PERIOD_CLOSED' | 'PACKAGE_NOT_FOUND'
  | 'DOCUMENT_NOT_VERIFIED' | 'NOT_FOUND' | 'CONFLICT';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly causeCode?: string;
  constructor(code: AppErrorCode, message: string, causeCode?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (causeCode !== undefined) this.causeCode = causeCode;
  }
}

export function normalizeError(error: unknown): AppError {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = (error as { code?: string })?.code;
  if (/JWT|invalid.*login|invalid.*credential|invalid.*password|invalid.*email|unauthorized|session expired/i.test(raw)) return new AppError('AUTH_INVALID', 'Your session or sign-in details are invalid. Please sign in again.', code);
  if (/permission|not authorized|forbidden|42501|rls/i.test(raw)) return new AppError('PERMISSION_DENIED', 'You do not have permission to perform this action.', code);
  if (/rate limit|too many requests|429/i.test(raw)) return new AppError('RATE_LIMITED', 'Too many requests. Please try again shortly.', code);
  if (/network|fetch|failed to fetch|timeout|econn|offline/i.test(raw)) return new AppError('NETWORK_ERROR', 'The service could not be reached. Check your connection and try again.', code);
  if (/capacity|sold out|full/i.test(raw)) return new AppError('CAPACITY_EXCEEDED', 'The requested capacity is no longer available.', code);
  if (/stale|version|concurrent/i.test(raw)) return new AppError('STALE_VERSION', 'This record changed while you were editing it. Reload and try again.', code);
  if (/state transition|invalid state/i.test(raw)) return new AppError('INVALID_STATE_TRANSITION', 'That status change is not allowed from the current state.', code);
  if (/already reversed|already refunded/i.test(raw)) return new AppError('PAYMENT_ALREADY_REVERSED', 'This payment has already been reversed.', code);
  if (/fiscal period|period closed/i.test(raw)) return new AppError('FISCAL_PERIOD_CLOSED', 'The fiscal period is closed and cannot be changed.', code);
  if (/package.*not found/i.test(raw)) return new AppError('PACKAGE_NOT_FOUND', 'The selected package is no longer available.', code);
  if (/document.*not verified/i.test(raw)) return new AppError('DOCUMENT_NOT_VERIFIED', 'The document must be verified before this action.', code);
  if (/not found|does not exist/i.test(raw)) return new AppError('NOT_FOUND', 'The requested record could not be found.', code);
  if (/conflict|duplicate|unique/i.test(raw)) return new AppError('CONFLICT', 'The requested change conflicts with an existing record.', code);
  if (/invalid|must|cannot|exceeds|required/i.test(raw)) return new AppError('VALIDATION_ERROR', 'The submitted information is not valid. Please review the fields and try again.', code);
  if (/5\d\d|server|database|postgres|supabase|rpc/i.test(raw)) return new AppError('SERVER_ERROR', 'The service encountered an internal problem. Please try again later.', code);
  return new AppError('UNKNOWN_ERROR', 'Something went wrong. Please try again later.', code);
}

export function toUserMessage(error: unknown): string {
  const safe = error instanceof AppError ? error : normalizeError(error);
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return `${safe.message} (Debug: ${raw})`;
}
