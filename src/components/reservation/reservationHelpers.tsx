/* eslint-disable react-refresh/only-export-components -- constants module shared across sibling components */
/** Shared small components and utilities for ReservationPage */
import { type ElementType } from 'react';

/** Everything the wizard collects. Shared so the step panels can be typed. */
export interface ReservationData {
  packageId: string;
  packageName: string;
  startDateTime: string;
  endDateTime: string;
  travelers: number;
  name: string;
  phone: string;
  email: string;
  notes: string;
  honeypot: string;
}

export type ReservationStatus = 'idle' | 'loading' | 'success' | 'error';

/** Which of the three contact fields is filled in but malformed. */
export interface FieldErrors {
  readonly name: boolean;
  readonly phone: boolean;
  readonly email: boolean;
}

export function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

export function todayDateTimeLocal(): string {
  const now = new Date();
  const roundedMinutes = Math.ceil(now.getMinutes() / 30) * 30;
  now.setMinutes(roundedMinutes === 60 ? 0 : roundedMinutes);
  if (roundedMinutes === 60) now.setHours(now.getHours() + 1);
  now.setSeconds(0);
  now.setMilliseconds(0);
  return formatDateTimeLocal(now);
}

export function addMinutesToLocalDateTime(dateTime: string, minutes: number): string {
  const next = new Date(dateTime);
  next.setMinutes(next.getMinutes() + minutes);
  return formatDateTimeLocal(next);
}

export function tripDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function isNameValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && !/^[\d]+$/.test(trimmed);
}

export function isPhoneValid(phone: string): boolean {
  return /^[\d\s()+-]{6,20}$/.test(phone.trim());
}

export function isEmailValid(email: string): boolean {
  const trimmed = email.trim();
  return !trimmed || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export const pkgNames: Record<string, Record<string, string>> = {
  'umrah-ramadan': { ar: 'عمرة رمضان', fr: 'Omra Ramadan', en: 'Ramadan Umrah' },
  'hajj-premium': { ar: 'باقة الحج المتميزة', fr: 'Forfait Hajj Premium', en: 'Premium Hajj Package' },
  'umrah-economy': { ar: 'عمرة اقتصادية', fr: 'Omra Économique', en: 'Economy Umrah' },
  'vip-package': { ar: 'باقة VIP', fr: 'Forfait VIP', en: 'VIP Package' },
};

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      <span className="shrink-0 text-sm text-sand-500 dark:text-sand-400">{label}</span>
      <span className="min-w-0 break-words text-end text-sm font-semibold text-sand-900 dark:text-white">{value}</span>
    </div>
  );
}

export function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="gl-sunk min-w-0 p-4">
      <p className="text-xs text-sand-500 dark:text-sand-400">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-sand-900 dark:text-white">{value}</p>
    </div>
  );
}

/* Wraps rather than truncates: a full date range in Arabic is longer than a
   240px sidebar column, and `break-all` on the value used to cut it mid-word. */
export function SideRow({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
      <span className="shrink-0 text-xs text-sand-400 dark:text-sand-500">{label}:</span>
      <span className="min-w-0 break-words text-xs font-medium text-sand-700 dark:text-sand-300" dir="ltr">
        {value}
      </span>
    </div>
  );
}
