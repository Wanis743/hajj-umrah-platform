import type { CommandResult } from '@/services/domainCommands';

export type FieldErrors = Record<string, string>;
export type ResultCode =
  | 'OK' | 'UNAUTHORIZED' | 'INVALID_STATE_TRANSITION' | 'NOT_FOUND'
  | 'VALIDATION_FAILED' | 'CONFLICT' | 'CAPACITY_EXCEEDED' | 'STALE_VERSION'
  | 'FISCAL_PERIOD_CLOSED' | 'UNKNOWN';

export type BusinessResult<T> = CommandResult<T> & {
  error: CommandResult<T>['error'] & { fieldErrors?: FieldErrors } | null;
};

export const isSuccess = <T>(result: BusinessResult<T>): result is BusinessResult<T> & { success: true; data: T } =>
  result.success && result.data !== null;

export const unwrapOrThrow = <T>(result: BusinessResult<T>): T => {
  if (isSuccess(result)) return result.data;
  const error = result.error;
  throw new Error(error?.message ?? 'Business command failed');
};
