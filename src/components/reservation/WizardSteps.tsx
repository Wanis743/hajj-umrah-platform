/**
 * The four panels of the reservation wizard.
 *
 * They were all inline in `ReservationPage.tsx` — which is how that file
 * reached 370 lines and a cyclomatic complexity of 33. Splitting them out
 * costs a little prop plumbing and buys panels you can read one at a time.
 * The chrome around them (progress, nav, sidebar, success) is in
 * `./WizardChrome`.
 *
 * Every surface is glass now: `gl-card` for the choices, `gl-field` for the
 * inputs — which also fixes the iOS focus-zoom, since `.gl-field` pins
 * `font-size: 16px` below `sm` — and `gl-sunk` for recessed notes.
 */
import { useId } from 'react';
import { AlertCircle, Calendar, Check, Minus, Plus, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import type { Pkg } from '@/data/packages';
import {
  type FieldErrors,
  type ReservationData,
  SummaryRow,
  pkgNames,
} from './reservationHelpers';

const FIELD = 'gl-field px-4 py-3';
/* ------------------------------------------------------------------ *
 * Step 1 — package
 * ------------------------------------------------------------------ */

interface PackageStepProps {
  readonly packages: readonly Pkg[];
  readonly selectedId: string;
  onSelect: (id: string, name: string) => void;
}

export function PackageStep({ packages, selectedId, onSelect }: PackageStepProps) {
  const { t, lang } = useI18n();

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">
        {t.reserve.selectPackage}
      </h2>
      <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.selectPackageDesc}</p>

      <div className="mt-6 grid gap-3 sm:gap-4">
        {packages.map((p) => {
          const name = pkgNames[p.id]?.[lang] ?? p.name;
          const selected = selectedId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id, name)}
              aria-pressed={selected}
              className={`gl-card gl-lift-sm group flex w-full items-start gap-3 p-3 text-start transition-all sm:gap-4 sm:p-4 ${
                selected ? 'ring-2 ring-oasis-500 ring-offset-2 ring-offset-transparent' : ''
              }`}
            >
              {/* 64px on a 320px screen leaves room for the price line; the
                  old flat 80px thumbnail pushed it to a third row. */}
              <img
                loading="lazy"
                decoding="async"
                src={p.image}
                alt=""
                className="h-16 w-16 shrink-0 rounded-xl object-cover shadow-glass xs:h-20 xs:w-20"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-sand-900 dark:text-white">{name}</span>
                  {selected && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oasis-600 text-white">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs text-sand-500 dark:text-sand-400">
                  {p.type} · {p.duration}
                </span>
                <span className="mt-1.5 block text-sm font-bold text-oasis-600 dark:text-oasis-400">{p.price}</span>
                <span className="mt-2 line-clamp-2 block text-xs leading-5 text-sand-500 dark:text-sand-400">
                  {p.tagline}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2 — dates and travellers
 * ------------------------------------------------------------------ */

interface DatesStepProps {
  readonly data: ReservationData;
  readonly minStart: string;
  readonly minEnd: string;
  readonly duration: number;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onTravelers: (value: number) => void;
}

export function DatesStep({ data, minStart, minEnd, duration, onStart, onEnd, onTravelers }: DatesStepProps) {
  const { t } = useI18n();
  const id = useId();
  const startId = `${id}-start`;
  const endId = `${id}-end`;
  const travelersId = `${id}-travelers`;
  const datesBroken = new Date(data.endDateTime) <= new Date(data.startDateTime);

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">{t.reserve.dates}</h2>
      <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.datesDesc}</p>

      <div className="gl-sunk mt-4 flex items-start gap-2.5 p-4 text-sm text-sand-700 dark:text-sand-300">
        <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="leading-6">{t.reserve.dateInfo}</p>
          <p className="mt-1 text-xs text-sand-500 dark:text-sand-400">{t.reserve.noLoginNeeded}</p>
        </div>
      </div>

      {/* Two columns from `sm` up. A single stacked column left a 640px tablet
          with two half-empty rows and pushed the traveller stepper below the
          fold. */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={startId} className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">
            {t.reserve.startDate} *
          </label>
          <input
            id={startId}
            type="datetime-local"
            min={minStart}
            value={data.startDateTime}
            onChange={(event) => onStart(event.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={endId} className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">
            {t.reserve.endDate} *
          </label>
          <input
            id={endId}
            type="datetime-local"
            min={minEnd}
            value={data.endDateTime}
            onChange={(event) => onEnd(event.target.value)}
            aria-invalid={datesBroken}
            className={FIELD}
          />
        </div>
      </div>

      {duration > 0 && !datesBroken && (
        <p className="gl-chip mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm text-oasis-700 dark:text-oasis-300">
          <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t.reserve.tripDuration}:{' '}
          <strong className="font-semibold">
            {duration} {t.reserve.days}
          </strong>
        </p>
      )}

      <div className="mt-6">
        <label htmlFor={travelersId} className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">
          {t.reserve.travelers} *
        </label>
        {/* The two buttons are for thumbs; a `type="number"` input is already a
            spinbutton, so they are hidden from assistive tech rather than
            announced twice with invented labels. */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onTravelers(Math.max(1, data.travelers - 1))}
            className="gl-btn gl-btn-glass h-12 w-12 shrink-0 !px-0"
            tabIndex={-1}
            aria-hidden="true"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            id={travelersId}
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={data.travelers}
            onChange={(event) => onTravelers(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
            className={`${FIELD} max-w-[96px] text-center text-lg font-bold tabular-nums`}
          />
          <button
            type="button"
            onClick={() => onTravelers(Math.min(20, data.travelers + 1))}
            className="gl-btn gl-btn-glass h-12 w-12 shrink-0 !px-0"
            tabIndex={-1}
            aria-hidden="true"
          >
            <Plus className="h-4 w-4" />
          </button>
          <Users className="h-5 w-5 shrink-0 text-sand-400 dark:text-sand-500" aria-hidden="true" />
        </div>
      </div>

      {datesBroken && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-red-300/60 bg-red-50/80 px-4 py-3 text-sm text-red-600 backdrop-blur-sm dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t.reserve.datesError}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 3 — contact details
 * ------------------------------------------------------------------ */

interface DetailsStepProps {
  readonly data: ReservationData;
  readonly errors: FieldErrors;
  onChange: (patch: Partial<ReservationData>) => void;
}

export function DetailsStep({ data, errors, onChange }: DetailsStepProps) {
  const { t } = useI18n();
  const id = useId();
  const ids = {
    name: `${id}-name`,
    phone: `${id}-phone`,
    email: `${id}-email`,
    notes: `${id}-notes`,
  };
  const err = 'mt-2 text-sm text-red-600 dark:text-red-400';
  const labelCls = 'mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300';

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">{t.reserve.details}</h2>
      <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.detailsDesc}</p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.name} className={labelCls}>
            {t.reserve.fullName} *
          </label>
          <input
            id={ids.name}
            value={data.name}
            autoComplete="name"
            onChange={(event) => onChange({ name: event.target.value })}
            aria-invalid={errors.name}
            aria-describedby={errors.name ? `${ids.name}-err` : undefined}
            className={FIELD}
          />
          {errors.name && (
            <p id={`${ids.name}-err`} className={err}>
              {t.reserve.invalidName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={ids.phone} className={labelCls}>
            {t.contact.phone} *
          </label>
          <input
            id={ids.phone}
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+213..."
            value={data.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
            aria-invalid={errors.phone}
            aria-describedby={errors.phone ? `${ids.phone}-err` : undefined}
            className={FIELD}
          />
          {errors.phone && (
            <p id={`${ids.phone}-err`} className={err}>
              {t.reserve.invalidPhone}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={ids.email} className={labelCls}>
            {t.contact.email}
          </label>
          <input
            id={ids.email}
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="email"
            value={data.email}
            onChange={(event) => onChange({ email: event.target.value })}
            aria-invalid={errors.email}
            aria-describedby={errors.email ? `${ids.email}-err` : undefined}
            className={FIELD}
          />
          {errors.email && (
            <p id={`${ids.email}-err`} className={err}>
              {t.reserve.invalidEmail}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={ids.notes} className={labelCls}>
            {t.reserve.notes}
          </label>
          <textarea
            id={ids.notes}
            rows={3}
            value={data.notes}
            placeholder={t.reserve.notesPlaceholder}
            onChange={(event) => onChange({ notes: event.target.value })}
            className={`${FIELD} resize-none`}
          />
        </div>

        {/* Spam trap. Positioned off-canvas rather than `hidden` so a bot that
            checks computed visibility still fills it in. */}
        <input
          name="website"
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          value={data.honeypot}
          onChange={(event) => onChange({ honeypot: event.target.value })}
          className="pointer-events-none absolute h-px w-px opacity-0 start-[-9999px]"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 4 — review
 * ------------------------------------------------------------------ */

interface ReviewStepProps {
  readonly data: ReservationData;
  readonly duration: number;
  readonly errorMsg: string;
}

export function ReviewStep({ data, duration, errorMsg }: ReviewStepProps) {
  const { t } = useI18n();
  const [startDate, startTime] = data.startDateTime.split('T');
  const [endDate, endTime] = data.endDateTime.split('T');

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">{t.reserve.review}</h2>
      <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.reviewDesc}</p>

      <div className="mt-6 divide-y divide-[color:var(--gl-line-strong)]">
        <SummaryRow label={t.reserve.package} value={data.packageName} />
        <SummaryRow label={t.reserve.startDate} value={`${startDate} ${startTime}`} />
        <SummaryRow label={t.reserve.endDate} value={`${endDate} ${endTime}`} />
        <SummaryRow label={t.reserve.travelers} value={String(data.travelers)} />
        {duration > 0 && <SummaryRow label={t.reserve.tripDuration} value={`${duration} ${t.reserve.days}`} />}
        <SummaryRow label={t.reserve.fullName} value={data.name} />
        <SummaryRow label={t.contact.phone} value={data.phone} />
        {Boolean(data.email) && <SummaryRow label={t.contact.email} value={data.email} />}
        {Boolean(data.notes) && <SummaryRow label={t.reserve.notes} value={data.notes} />}
      </div>

      {Boolean(errorMsg) && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-red-300/60 bg-red-50/80 px-4 py-3 text-sm text-red-600 backdrop-blur-sm dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-400"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {errorMsg}
        </p>
      )}
    </div>
  );
}

