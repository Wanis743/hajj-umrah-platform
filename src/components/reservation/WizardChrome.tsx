/**
 * Everything around the four step panels: the page intro, the progress
 * header, the Back/Next row, the sticky summary and the success screen.
 * The panels themselves are in `./WizardSteps`.
 */
import { type ElementType } from 'react';
import {
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Home,
  Loader2,
  MapPin,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { agencyConfig } from '@/config/agency';
import type { Pkg } from '@/data/packages';
import { type ReservationData, SideRow, SummaryCard } from './reservationHelpers';

/* ------------------------------------------------------------------ *
 * Page intro
 * ------------------------------------------------------------------ */

/** Agency chip, page title, one line of copy. */
export function WizardIntro() {
  const { t } = useI18n();
  return (
    <div className="text-center">
      <span className="gl-chip inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-oasis-700 dark:text-oasis-300">
        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {agencyConfig.name || 'BouSalem Agency'}
      </span>
      <h1 className="mt-4 font-serif text-2xl font-bold text-sand-900 text-balance dark:text-white sm:text-4xl">
        {t.reserve.title}
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-sand-600 dark:text-sand-400 sm:text-base">
        {t.reserve.subtitle}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Progress header
 * ------------------------------------------------------------------ */

export interface StepMeta {
  readonly num: number;
  readonly label: string;
  readonly icon: ElementType;
}

interface ProgressProps {
  readonly step: number;
  readonly steps: readonly StepMeta[];
}

/**
 * The bar, the percentage and the four nodes.
 *
 * The last node is `shrink-0` while the others are `flex-1`: with every item
 * flexible the trailing node kept a connector-sized gap after it, so the row
 * of circles drifted away from the right edge as the viewport grew.
 */
export function StepProgress({ step, steps }: ProgressProps) {
  const { t } = useI18n();
  const total = steps.length;
  const pct = Math.round((step / total) * 100);

  return (
    <>
      <div className="mx-auto mt-8 max-w-3xl">
        <div className="mb-2 flex justify-between text-xs font-medium text-sand-500 dark:text-sand-400">
          <span>{t.reserve.stepOf.replace('{n}', String(step)).replace('{total}', String(total))}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div
          className="gl-sunk h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-oasis-500 to-oasis-600 shadow-glow-oasis transition-[width] duration-500 ease-glass"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ol className="mx-auto mt-6 flex max-w-3xl items-start justify-between gap-1">
        {steps.map((s, i) => {
          const done = step > s.num;
          const current = step === s.num;
          return (
            <li
              key={s.num}
              className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : 'shrink-0'}`}
              aria-current={current ? 'step' : undefined}
            >
              <div className="flex w-14 shrink-0 flex-col items-center gap-1.5 sm:w-20">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-glass sm:h-11 sm:w-11 ${
                    done || current
                      ? 'bg-gradient-to-br from-oasis-500 to-oasis-700 text-white shadow-glow-oasis'
                      : 'gl-sunk text-sand-400 dark:text-sand-500'
                  } ${current ? 'ring-4 ring-oasis-500/25' : ''}`}
                >
                  {done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <s.icon className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                <span
                  className={`hidden text-center text-[10px] font-medium leading-tight sm:block ${
                    step >= s.num ? 'text-sand-900 dark:text-white' : 'text-sand-400 dark:text-sand-500'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span
                  className={`mx-1 mt-5 h-0.5 flex-1 rounded-full transition-colors duration-500 ${
                    done ? 'bg-oasis-500' : 'bg-sand-300/70 dark:bg-sand-700/70'
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Sidebar summary
 * ------------------------------------------------------------------ */

interface SidebarProps {
  readonly pkg: Pkg | undefined;
  readonly data: ReservationData;
  readonly duration: number;
}

/**
 * Sticky from `lg` up, and capped at the viewport height with its own
 * scroller — an unbounded sticky column with a long date range and a name in
 * it ran past the bottom of the screen with no way to reach the rest.
 */
export function SummarySidebar({ pkg, data, duration }: SidebarProps) {
  const { t } = useI18n();
  const [startDate, startTime] = data.startDateTime.split('T');
  const [endDate, endTime] = data.endDateTime.split('T');

  return (
    <aside className="lg:col-span-2">
      <div className="gl-card p-5 sm:p-6 lg:sticky lg:top-24 lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto">
        <h2 className="font-bold text-sand-900 dark:text-white">{t.reserve.bookingSummary}</h2>
        {pkg ? (
          <>
            <img
              loading="lazy"
              decoding="async"
              src={pkg.image}
              alt=""
              className="mt-4 h-32 w-full rounded-2xl object-cover shadow-glass sm:h-36"
            />
            <p className="mt-4 font-semibold text-sand-900 dark:text-white">{data.packageName}</p>
            <p className="text-sm font-bold text-oasis-600 dark:text-oasis-400">{pkg.price}</p>
            {Boolean(startDate) && (
              <div className="gl-divide-t mt-4 space-y-2.5 pt-4">
                <SideRow
                  icon={Calendar}
                  label={t.reserve.dates}
                  value={`${startDate} ${startTime} → ${endDate} ${endTime}`}
                />
                {duration > 0 && (
                  <SideRow icon={Calendar} label={t.reserve.tripDuration} value={`${duration} ${t.reserve.days}`} />
                )}
                <SideRow icon={Users} label={t.reserve.travelers} value={String(data.travelers)} />
                {Boolean(data.name) && <SideRow icon={User} label={t.reserve.fullName} value={data.name} />}
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-sand-500 dark:text-sand-400">{t.reserve.selectPackageFirst}</p>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * Wizard navigation
 * ------------------------------------------------------------------ */

interface NavProps {
  readonly step: number;
  readonly total: number;
  readonly loading: boolean;
  readonly canNext: boolean;
  onBack: () => void;
  onHome: () => void;
  onNext: () => void;
  onConfirm: () => void;
}

/**
 * Back / Next. Each button takes half the row below `xs` so neither overflows
 * a 320px card, and both are `.gl-btn` — 44px tall, which the old 38px pills
 * were not. The chevrons follow the writing direction.
 */
export function WizardNav({ step, total, loading, canNext, onBack, onHome, onNext, onConfirm }: NavProps) {
  const { t, dir } = useI18n();
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const wide = 'gl-btn flex-1 text-sm xs:flex-none';

  return (
    <div className="gl-divide-t mt-8 flex flex-wrap items-center justify-between gap-3 pt-6">
      {step > 1 ? (
        <button onClick={onBack} className={`${wide} gl-btn-glass`}>
          <Back className="h-4 w-4" aria-hidden="true" />
          {t.reserve.back}
        </button>
      ) : (
        <button onClick={onHome} className={`${wide} gl-btn-glass`}>
          <Home className="h-4 w-4" aria-hidden="true" />
          {t.reserve.backToHome}
        </button>
      )}

      {step < total ? (
        <button onClick={onNext} disabled={!canNext} className={`${wide} gl-btn-primary`}>
          {t.reserve.next}
          <Next className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button onClick={onConfirm} disabled={loading} className={`${wide} gl-btn-primary`}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t.reserve.confirming}
            </>
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              {t.reserve.confirm}
            </>
          )}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Success screen
 * ------------------------------------------------------------------ */

interface SuccessProps {
  readonly data: ReservationData;
  readonly reference: string;
  readonly copied: boolean;
  onCopy: () => void;
  onReset: () => void;
  onHome: () => void;
}

export function SuccessView({ data, reference, copied, onCopy, onReset, onHome }: SuccessProps) {
  const { t } = useI18n();
  const [startDate, startTime] = data.startDateTime.split('T');
  const [endDate, endTime] = data.endDateTime.split('T');

  return (
    <div className="relative mx-auto max-w-2xl px-4 sm:px-6">
      <div className="gl-panel animate-pop overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-oasis-600 to-oasis-800 px-5 py-9 text-center text-white sm:px-8 sm:py-11">
          <span
            className="absolute inset-0 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,255,255,0.28),transparent_70%)]"
            aria-hidden="true"
          />
          <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-white/20 backdrop-blur-sm sm:h-20 sm:w-20">
            <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10" aria-hidden="true" />
          </span>
          <h1 className="relative mt-5 font-serif text-xl font-bold text-balance sm:text-3xl">{t.reserve.success}</h1>
          <p className="relative mx-auto mt-2 max-w-md text-sm leading-6 text-oasis-100">{t.reserve.successMsg}</p>
        </div>

        <div className="p-5 sm:p-8">
          <div className="gl-sunk border-2 border-dashed border-oasis-400/50 p-5 text-center sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-sand-500 dark:text-sand-400">
              {t.reserve.reference}
            </p>
            {/* `text-2xl` at 320px with a 14-character reference overflowed the
                card; it now scales with the viewport instead. */}
            <p className="mt-2 break-all font-mono text-xl font-bold tracking-wider text-oasis-600 dark:text-oasis-400 xs:text-2xl sm:text-3xl">
              {reference}
            </p>
            <button
              onClick={onCopy}
              className="gl-tap mx-auto mt-2 gap-1.5 text-xs font-medium text-oasis-700 hover:underline dark:text-oasis-400"
            >
              {copied ? (
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? t.reserve.copied : t.reserve.copyReference}
            </button>
          </div>

          <div className="mt-6 grid gap-3 xs:grid-cols-2">
            <SummaryCard label={t.reserve.package} value={data.packageName} />
            <SummaryCard label={t.reserve.travelers} value={String(data.travelers)} />
            <SummaryCard label={t.reserve.startDate} value={`${startDate} ${startTime}`} />
            <SummaryCard label={t.reserve.endDate} value={`${endDate} ${endTime}`} />
            <SummaryCard label={t.reserve.fullName} value={data.name} />
            <SummaryCard label={t.contact.phone} value={data.phone} />
          </div>

          <p className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50/80 px-4 py-3 text-sm text-amber-700 backdrop-blur-sm dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t.reserve.statusPending}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button onClick={onReset} className="gl-btn gl-btn-glass text-sm">
              {t.reserve.newReservation}
            </button>
            <button onClick={onHome} className="gl-btn gl-btn-primary text-sm">
              <Home className="h-4 w-4" aria-hidden="true" />
              {t.reserve.backToHome}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
