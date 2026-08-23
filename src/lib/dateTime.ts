export const APP_TIMEZONE = import.meta.env.VITE_AGENCY_TIMEZONE || 'Africa/Algiers';
export const APP_LOCALE = import.meta.env.VITE_AGENCY_LOCALE || 'fr-DZ';

export function formatDate(value: string | Date, locale = APP_LOCALE, timeZone = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(value));
}
export function formatDateTime(value: string | Date, locale = APP_LOCALE, timeZone = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}
export function formatPhone(value: string): string {
  return value.replace(/\s+/g, '').replace(/^00/, '+');
}
