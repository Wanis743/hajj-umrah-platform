/**
 * The reservation wizard's shell: state, validation, submission and the
 * navigation between the four panels, which live in
 * `./reservation/ReservationSteps` so each one can be read on its own.
 *
 * Beyond the glass, two control fixes:
 *
 *   • Advancing a step now moves focus to the new panel and scrolls it into
 *     view. On a phone, pressing "Next" at the bottom of step 2 left you
 *     staring at the traveller stepper with no sign anything had changed.
 *   • The two nav buttons fill the row and wrap at 320px instead of
 *     overflowing it, and both are 44px tall.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Check, FileText, User } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { usePublicPackages } from '@/hooks/usePublicPackages';
import { newIdempotencyKey, submitPublicReservation } from '@/lib/publicReservation';
import {
  addMinutesToLocalDateTime,
  isEmailValid,
  isNameValid,
  isPhoneValid,
  todayDateTimeLocal,
  tripDays,
  type ReservationData,
  type ReservationStatus,
} from './reservation/reservationHelpers';
import { DatesStep, DetailsStep, PackageStep, ReviewStep } from './reservation/WizardSteps';
import {
  StepProgress,
  SuccessView,
  SummarySidebar,
  WizardIntro,
  WizardNav,
  type StepMeta,
} from './reservation/WizardChrome';

const TOTAL_STEPS = 4;

function blankData(start: string): ReservationData {
  return {
    packageId: '',
    packageName: '',
    startDateTime: start,
    endDateTime: addMinutesToLocalDateTime(start, 1),
    travelers: 1,
    name: '',
    phone: '',
    email: '',
    notes: '',
    honeypot: '',
  };
}

/** Everything that has to be true before the "Next" button unlocks. */
function stepComplete(step: number, data: ReservationData, minStart: string): boolean {
  if (step === 1) return Boolean(data.packageId);
  if (step === 2) {
    if (!data.startDateTime || !data.endDateTime) return false;
    if (data.travelers < 1 || data.travelers > 20) return false;
    if (new Date(data.startDateTime) < new Date(minStart)) return false;
    return new Date(data.endDateTime) > new Date(data.startDateTime);
  }
  if (step === 3) return isNameValid(data.name) && isPhoneValid(data.phone) && isEmailValid(data.email);
  return true;
}

/** The first failing rule at submit time, or an empty string when all pass. */
function submitError(data: ReservationData, minStart: string, t: ReturnType<typeof useI18n>['t']): string {
  if (data.honeypot.trim()) return t.reserve.spamError;
  if (new Date(data.startDateTime) < new Date(minStart)) return t.reserve.invalidDatePast;
  if (new Date(data.endDateTime) <= new Date(data.startDateTime)) return t.reserve.invalidEndDate;
  if (data.travelers < 1 || data.travelers > 20) return t.reserve.invalidTravelers;
  if (!isNameValid(data.name)) return t.reserve.invalidName;
  if (!isPhoneValid(data.phone)) return t.reserve.invalidPhone;
  if (!isEmailValid(data.email)) return t.reserve.invalidEmail;
  return '';
}

export default function ReservationPage() {
  const { t, lang } = useI18n();
  const { navigate } = useRouter();
  const { packages, dbBacked } = usePublicPackages(lang);

  const [initialStart] = useState(() => todayDateTimeLocal());
  const [data, setData] = useState<ReservationData>(() => blankData(initialStart));
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<ReservationStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [reference, setReference] = useState('');
  const [copied, setCopied] = useState(false);
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const panel = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  const minStartDateTime = todayDateTimeLocal();
  const minEndDateTime = addMinutesToLocalDateTime(data.startDateTime, 1);
  const selectedPkg = packages.find((p) => p.id === data.packageId);
  const duration = useMemo(
    () => tripDays(data.startDateTime.slice(0, 10), data.endDateTime.slice(0, 10)),
    [data.startDateTime, data.endDateTime],
  );
  const errors = {
    name: step === 3 && data.name.trim().length > 0 && !isNameValid(data.name),
    phone: step === 3 && data.phone.trim().length > 0 && !isPhoneValid(data.phone),
    email: step === 3 && data.email.trim().length > 0 && !isEmailValid(data.email),
  };

  useEffect(() => {
    if (new Date(data.endDateTime) < new Date(minEndDateTime)) {
      setData((prev) => ({ ...prev, endDateTime: minEndDateTime }));
    }
  }, [data.endDateTime, minEndDateTime]);

  // Skips the first render so landing on the page does not yank the viewport
  // past the title.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const update = (patch: Partial<ReservationData>) => setData((d) => ({ ...d, ...patch }));

  /** Moving the departure forward past the return drags the return with it. */
  const onStart = (value: string) =>
    setData((prev) => ({
      ...prev,
      startDateTime: value,
      endDateTime:
        new Date(value) >= new Date(prev.endDateTime) ? addMinutesToLocalDateTime(value, 1) : prev.endDateTime,
    }));

  const canNext = stepComplete(step, data, minStartDateTime);

  const handleConfirm = async () => {
    setStatus('loading');
    const problem = dbBacked ? submitError(data, minStartDateTime, t) : t.reserve.spamError;
    if (problem) {
      setStatus('error');
      setErrorMsg(problem);
      return;
    }
    setErrorMsg('');
    try {
      const result = await submitPublicReservation(
        {
          packageId: data.packageId,
          startDate: data.startDateTime.split('T')[0],
          endDate: data.endDateTime.split('T')[0],
          travelers: data.travelers,
          name: data.name.trim(),
          phone: data.phone.trim(),
          email: data.email.trim(),
          notes: data.notes.trim(),
          honeypot: data.honeypot,
        },
        idempotencyKey,
      );
      setReference(result.reference);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    }
  };

  const copyReference = async () => {
    await navigator.clipboard.writeText(reference);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setStatus('idle');
    setStep(1);
    setErrorMsg('');
    setData(blankData(initialStart));
  };

  const steps: readonly StepMeta[] = [
    { num: 1, label: t.reserve.step1, icon: FileText },
    { num: 2, label: t.reserve.step2, icon: Calendar },
    { num: 3, label: t.reserve.step3, icon: User },
    { num: 4, label: t.reserve.step4, icon: Check },
  ];

  if (status === 'success') {
    return (
      <main className="gl-screen-h gl-stack overflow-hidden pt-24 pb-16 sm:pt-28">
        <div className="gl-aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <SuccessView
          data={data}
          reference={reference}
          copied={copied}
          onCopy={copyReference}
          onReset={resetForm}
          onHome={() => navigate('home')}
        />
      </main>
    );
  }

  return (
    <main className="gl-screen-h gl-stack overflow-hidden pt-24 pb-16 sm:pt-28">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <WizardIntro />

        <StepProgress step={step} steps={steps} />

        {/* 3/2 from `lg`. Below that the sidebar sits under the form, where a
            summary of what you have just typed belongs anyway. */}
        <div className="mt-10 grid gap-6 sm:gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div
              ref={panel}
              tabIndex={-1}
              className="gl-card scroll-mt-24 p-5 outline-none sm:p-7"
              aria-label={steps[step - 1]?.label}
            >
              {step === 1 && (
                <PackageStep
                  packages={packages}
                  selectedId={data.packageId}
                  onSelect={(packageId, packageName) => update({ packageId, packageName })}
                />
              )}
              {step === 2 && (
                <DatesStep
                  data={data}
                  minStart={minStartDateTime}
                  minEnd={minEndDateTime}
                  duration={duration}
                  onStart={onStart}
                  onEnd={(endDateTime) => update({ endDateTime })}
                  onTravelers={(travelers) => update({ travelers })}
                />
              )}
              {step === 3 && <DetailsStep data={data} errors={errors} onChange={update} />}
              {step === 4 && (
                <ReviewStep data={data} duration={duration} errorMsg={status === 'error' ? errorMsg : ''} />
              )}

              <WizardNav
                step={step}
                total={TOTAL_STEPS}
                loading={status === 'loading'}
                canNext={canNext}
                onBack={() => setStep((s) => s - 1)}
                onHome={() => navigate('home')}
                onNext={() => canNext && setStep((s) => s + 1)}
                onConfirm={handleConfirm}
              />
            </div>
          </div>

          <SummarySidebar pkg={selectedPkg} data={data} duration={duration} />
        </div>
      </div>
    </main>
  );
}
