import { useState, useMemo, useEffect } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Calendar, Users, User, FileText, CheckCircle2,
  Loader2, AlertCircle, Home, MapPin, Sparkles, Copy, CheckCheck,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { usePublicPackages } from '@/hooks/usePublicPackages';
import { submitPublicReservation, newIdempotencyKey } from '@/lib/publicReservation';
import { agencyConfig } from '@/config/agency';
import {
  todayDateTimeLocal, addMinutesToLocalDateTime, tripDays,
  isNameValid, isPhoneValid, isEmailValid, pkgNames,
  SummaryRow, SummaryCard, SideRow,
} from './reservation/reservationHelpers';

interface ReservationData {
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

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function ReservationPage() {
  const { t, lang, dir } = useI18n();
  const { navigate } = useRouter();
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [reference, setReference] = useState('');
  const [copied, setCopied] = useState(false);
  const initialStart = todayDateTimeLocal();
  const [data, setData] = useState<ReservationData>({
    packageId: '', packageName: '',
    startDateTime: initialStart,
    endDateTime: addMinutesToLocalDateTime(initialStart, 1),
    travelers: 1, name: '', phone: '', email: '', notes: '', honeypot: '',
  });

  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const BackIcon = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const { packages, dbBacked } = usePublicPackages(lang);
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const selectedPkg = packages.find((p) => p.id === data.packageId);
  const minStartDateTime = todayDateTimeLocal();
  const minEndDateTime = addMinutesToLocalDateTime(data.startDateTime, 1);

  useEffect(() => {
    if (new Date(data.endDateTime) < new Date(minEndDateTime)) {
      setData((prev) => ({ ...prev, endDateTime: minEndDateTime }));
    }
  }, [data.startDateTime, minEndDateTime]);

  const duration = useMemo(
    () => tripDays(data.startDateTime.slice(0, 10), data.endDateTime.slice(0, 10)),
    [data.startDateTime, data.endDateTime],
  );
  const [startDateStr, startTime] = data.startDateTime.split('T');
  const [endDateStr, endTime] = data.endDateTime.split('T');
  const nameInvalid  = step === 3 && data.name.trim().length > 0  && !isNameValid(data.name);
  const phoneInvalid = step === 3 && data.phone.trim().length > 0 && !isPhoneValid(data.phone);
  const emailInvalid = step === 3 && data.email.trim().length > 0 && !isEmailValid(data.email);

  const steps = [
    { num: 1, label: t.reserve.step1, icon: FileText },
    { num: 2, label: t.reserve.step2, icon: Calendar },
    { num: 3, label: t.reserve.step3, icon: User },
    { num: 4, label: t.reserve.step4, icon: Check },
  ];

  const update = (patch: Partial<ReservationData>) => setData((d) => ({ ...d, ...patch }));

  const canNext = (): boolean => {
    if (step === 1) return !!data.packageId;
    if (step === 2) {
      if (!data.startDateTime || !data.endDateTime || data.travelers < 1 || data.travelers > 20) return false;
      if (new Date(data.startDateTime) < new Date(minStartDateTime)) return false;
      return new Date(data.endDateTime) > new Date(data.startDateTime);
    }
    if (step === 3) return isNameValid(data.name) && isPhoneValid(data.phone) && isEmailValid(data.email);
    return true;
  };

  const handleConfirm = async () => {
    setStatus('loading');
    setErrorMsg('');
    if (!dbBacked) { setStatus('error'); setErrorMsg(t.reserve.spamError); return; }
    if (data.honeypot.trim()) { setStatus('error'); setErrorMsg(t.reserve.spamError); return; }
    if (new Date(data.startDateTime) < new Date(minStartDateTime)) { setStatus('error'); setErrorMsg(t.reserve.invalidDatePast); return; }
    if (new Date(data.endDateTime) <= new Date(data.startDateTime)) { setStatus('error'); setErrorMsg(t.reserve.invalidEndDate); return; }
    if (data.travelers < 1 || data.travelers > 20) { setStatus('error'); setErrorMsg(t.reserve.invalidTravelers); return; }
    if (!isNameValid(data.name))  { setStatus('error'); setErrorMsg(t.reserve.invalidName);  return; }
    if (!isPhoneValid(data.phone)){ setStatus('error'); setErrorMsg(t.reserve.invalidPhone); return; }
    if (!isEmailValid(data.email)){ setStatus('error'); setErrorMsg(t.reserve.invalidEmail); return; }
    try {
      const result = await submitPublicReservation(
        { packageId: data.packageId, startDate: data.startDateTime.split('T')[0], endDate: data.endDateTime.split('T')[0], travelers: data.travelers, name: data.name.trim(), phone: data.phone.trim(), email: data.email.trim(), notes: data.notes.trim(), honeypot: data.honeypot },
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
    setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setStatus('idle'); setStep(1);
    setData({ packageId: '', packageName: '', startDateTime: initialStart, endDateTime: addMinutesToLocalDateTime(initialStart, 1), travelers: 1, name: '', phone: '', email: '', notes: '', honeypot: '' });
  };

  const inputCls = 'w-full rounded-xl border border-sand-200 bg-white px-4 py-3.5 text-sand-900 placeholder:text-sand-400 transition-all focus:border-oasis-500 focus:outline-none focus:ring-4 focus:ring-oasis-500/10 dark:border-sand-700 dark:bg-sand-950 dark:text-sand-100 dark:placeholder:text-sand-500';

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sand-50 to-oasis-50/30 pt-24 pb-16 dark:from-sand-950 dark:to-sand-950">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="overflow-hidden rounded-xl border border-oasis-200/60 bg-white shadow-md dark:border-oasis-800/40 dark:bg-sand-900">
            <div className="bg-gradient-to-br from-oasis-600 to-oasis-700 px-6 py-10 text-center text-white sm:px-8">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h2 className="mt-5 font-serif text-2xl font-bold sm:text-3xl">{t.reserve.success}</h2>
              <p className="mt-2 text-sm text-oasis-100">{t.reserve.successMsg}</p>
            </div>
            <div className="p-8 sm:p-10">
              <div className="rounded-lg border-2 border-dashed border-oasis-200 bg-oasis-50/50 p-6 text-center dark:border-oasis-800 dark:bg-oasis-900/20">
                <p className="text-xs font-semibold uppercase tracking-wider text-sand-500">{t.reserve.reference}</p>
                <p className="mt-2 break-all font-mono text-2xl font-bold tracking-wider text-oasis-600 dark:text-oasis-400 sm:text-3xl">{reference}</p>
                <button onClick={copyReference} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-oasis-600 hover:underline dark:text-oasis-400">
                  {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t.reserve.copied : t.reserve.copyReference}
                </button>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <SummaryCard label={t.reserve.package}    value={data.packageName}                 />
                <SummaryCard label={t.reserve.travelers}  value={String(data.travelers)}            />
                <SummaryCard label={t.reserve.startDate}  value={`${startDateStr} ${startTime}`}   />
                <SummaryCard label={t.reserve.endDate}    value={`${endDateStr} ${endTime}`}        />
                <SummaryCard label={t.reserve.fullName}   value={data.name}                         />
                <SummaryCard label={t.contact.phone}      value={data.phone}                        />
              </div>
              <div className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                <Sparkles className="h-4 w-4" />{t.reserve.statusPending}
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button onClick={resetForm} className="rounded-xl border-2 border-oasis-600 px-6 py-3 text-sm font-semibold text-oasis-700 transition-colors hover:bg-oasis-600 hover:text-white dark:text-oasis-400">
                  {t.reserve.newReservation}
                </button>
                <button onClick={() => navigate('home')} className="flex items-center justify-center gap-2 rounded-xl bg-oasis-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-oasis-700">
                  <Home className="h-4 w-4" />{t.reserve.backToHome}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sand-50 to-white pt-24 pb-16 dark:from-sand-950 dark:to-sand-950">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-oasis-50 px-3 py-1 text-xs font-semibold text-oasis-700 dark:bg-oasis-900/40 dark:text-oasis-300">
            <MapPin className="h-3.5 w-3.5" />{agencyConfig.name || 'BouSalem Agency'}
          </span>
          <h1 className="mt-4 font-serif text-3xl font-bold text-sand-900 dark:text-white sm:text-4xl">{t.reserve.title}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-sand-600 dark:text-sand-400 sm:text-base">{t.reserve.subtitle}</p>
        </div>

        <div className="mx-auto mt-8 max-w-3xl">
          <div className="mb-2 flex justify-between text-xs font-medium text-sand-500">
            <span>{t.reserve.stepOf.replace('{n}', String(step)).replace('{total}', '4')}</span>
            <span>{Math.round((step / 4) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sand-200 dark:bg-sand-800">
            <div className="h-full rounded-full bg-gradient-to-r from-oasis-500 to-oasis-600 transition-all duration-500" style={{ width: `${(step / 4) * 100}%` }} />
          </div>
        </div>

        <div className="mx-auto mt-6 flex max-w-3xl items-center justify-between gap-1">
          {steps.map((s, i) => (
            <div key={s.num} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm transition-all sm:h-11 sm:w-11 ${step > s.num ? 'bg-oasis-600 text-white shadow-md shadow-oasis-600/30' : step === s.num ? 'bg-oasis-600 text-white ring-4 ring-oasis-600/20' : 'bg-sand-200 text-sand-400 dark:bg-sand-800'}`}>
                  {step > s.num ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </div>
                <span className={`hidden text-[10px] font-medium sm:block ${step >= s.num ? 'text-sand-900 dark:text-white' : 'text-sand-400'}`}>{s.label}</span>
              </div>
              {i < steps.length - 1 && <div className={`mx-1 h-0.5 flex-1 rounded-full ${step > s.num ? 'bg-oasis-500' : 'bg-sand-200 dark:bg-sand-800'}`} />}
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="rounded-xl border border-sand-200 bg-white p-6 shadow-lg dark:border-sand-800 dark:bg-sand-900 sm:p-8">
              {/* Step 1: Package */}
              {step === 1 && (
                <div className="animate-fade-in">
                  <h2 className="text-xl font-bold text-sand-900 dark:text-white">{t.reserve.selectPackage}</h2>
                  <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.selectPackageDesc}</p>
                  <div className="mt-6 grid gap-4">
                    {packages.map((p) => {
                      const name = pkgNames[p.id]?.[lang] ?? p.name;
                      const selected = data.packageId === p.id;
                      return (
                        <button key={p.id} onClick={() => update({ packageId: p.id, packageName: name })} className={`group flex items-start gap-4 rounded-lg border-2 p-4 text-start transition-all ${selected ? 'border-oasis-500 bg-oasis-50 shadow-md shadow-oasis-500/10 dark:border-oasis-500 dark:bg-oasis-900/30' : 'border-sand-100 hover:border-oasis-200 hover:shadow-sm dark:border-sand-800 dark:hover:border-oasis-800'}`}>
                          <img loading="lazy" src={p.image} alt={name} className="h-20 w-20 shrink-0 rounded-xl object-cover shadow-sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-sand-900 dark:text-white">{name}</p>
                              {selected && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oasis-600 text-white"><Check className="h-3.5 w-3.5" /></span>}
                            </div>
                            <p className="mt-1 text-xs text-sand-500">{p.type} · {p.duration}</p>
                            <p className="mt-1.5 text-sm font-bold text-oasis-600 dark:text-oasis-400">{p.price}</p>
                            <p className="mt-2 line-clamp-2 text-xs text-sand-500 dark:text-sand-400">{p.tagline}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 2: Dates */}
              {step === 2 && (
                <div className="animate-fade-in">
                  <h2 className="text-xl font-bold text-sand-900 dark:text-white">{t.reserve.dates}</h2>
                  <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.datesDesc}</p>
                  <div className="mt-4 rounded-lg border border-sand-200 bg-sand-50 p-4 text-sm text-sand-700 dark:border-sand-800 dark:bg-sand-950 dark:text-sand-300">
                    <div className="flex items-start gap-2">
                      <Calendar className="mt-1 h-4 w-4 text-oasis-500" />
                      <div><p>{t.reserve.dateInfo}</p><p className="mt-1 text-xs text-sand-500">{t.reserve.noLoginNeeded}</p></div>
                    </div>
                  </div>
                  <div className="mt-6 space-y-6">
                    <div>
                      <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.reserve.startDate} *</span>
                      <input type="datetime-local" min={minStartDateTime} value={data.startDateTime} onChange={(e) => setData((prev) => { const nextStart = e.target.value; const nextEnd = new Date(nextStart) >= new Date(prev.endDateTime) ? addMinutesToLocalDateTime(nextStart, 1) : prev.endDateTime; return { ...prev, startDateTime: nextStart, endDateTime: nextEnd }; })} className={inputCls} />
                    </div>
                    <div>
                      <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.reserve.endDate} *</span>
                      <input type="datetime-local" min={minEndDateTime} value={data.endDateTime} onChange={(e) => update({ endDateTime: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                  {duration > 0 && <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-oasis-50 px-4 py-2 text-sm text-oasis-700 dark:bg-oasis-900/30 dark:text-oasis-300"><Calendar className="h-4 w-4" />{t.reserve.tripDuration}: <strong>{duration} {t.reserve.days}</strong></div>}
                  <label className="mt-6 block">
                    <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.reserve.travelers} *</span>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => update({ travelers: Math.max(1, data.travelers - 1) })} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-sand-200 text-lg font-bold text-sand-700 transition-colors hover:bg-sand-100 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800">−</button>
                      <input type="number" min="1" max="20" value={data.travelers} onChange={(e) => update({ travelers: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} className={`${inputCls} max-w-[100px] text-center text-lg font-bold`} />
                      <button type="button" onClick={() => update({ travelers: Math.min(20, data.travelers + 1) })} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-sand-200 text-lg font-bold text-sand-700 transition-colors hover:bg-sand-100 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800">+</button>
                      <Users className="h-5 w-5 text-sand-400" />
                    </div>
                  </label>
                  {new Date(data.endDateTime) <= new Date(data.startDateTime) && <p className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"><AlertCircle className="h-4 w-4" /> {t.reserve.datesError}</p>}
                </div>
              )}

              {/* Step 3: Contact details */}
              {step === 3 && (
                <div className="animate-fade-in">
                  <h2 className="text-xl font-bold text-sand-900 dark:text-white">{t.reserve.details}</h2>
                  <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.detailsDesc}</p>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.reserve.fullName} *</span>
                      <input value={data.name} onChange={(e) => update({ name: e.target.value })} className={inputCls} aria-invalid={nameInvalid} />
                      {nameInvalid && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.reserve.invalidName}</p>}
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.contact.phone} *</span>
                      <input value={data.phone} onChange={(e) => update({ phone: e.target.value })} type="tel" dir="ltr" placeholder="+213..." className={inputCls} aria-invalid={phoneInvalid} />
                      {phoneInvalid && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.reserve.invalidPhone}</p>}
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.contact.email}</span>
                      <input value={data.email} onChange={(e) => update({ email: e.target.value })} type="email" dir="ltr" className={inputCls} aria-invalid={emailInvalid} />
                      {emailInvalid && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.reserve.invalidEmail}</p>}
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-sand-700 dark:text-sand-300">{t.reserve.notes}</span>
                      <textarea value={data.notes} onChange={(e) => update({ notes: e.target.value })} rows={3} placeholder={t.reserve.notesPlaceholder} className={`${inputCls} resize-none`} />
                    </label>
                    <input name="website" autoComplete="off" value={data.honeypot} onChange={(e) => update({ honeypot: e.target.value })} className="pointer-events-none absolute left-[-9999px] h-px w-px opacity-0" tabIndex={-1} aria-hidden="true" />
                  </div>
                </div>
              )}

              {/* Step 4: Review */}
              {step === 4 && (
                <div className="animate-fade-in">
                  <h2 className="text-xl font-bold text-sand-900 dark:text-white">{t.reserve.review}</h2>
                  <p className="mt-2 text-sm text-sand-600 dark:text-sand-400">{t.reserve.reviewDesc}</p>
                  <div className="mt-6 space-y-0 divide-y divide-sand-100 dark:divide-sand-800">
                    <SummaryRow label={t.reserve.package}      value={data.packageName}               />
                    <SummaryRow label={t.reserve.startDate}    value={`${startDateStr} ${startTime}`} />
                    <SummaryRow label={t.reserve.endDate}      value={`${endDateStr} ${endTime}`}     />
                    <SummaryRow label={t.reserve.travelers}    value={String(data.travelers)}          />
                    {duration > 0 && <SummaryRow label={t.reserve.tripDuration} value={`${duration} ${t.reserve.days}`} />}
                    <SummaryRow label={t.reserve.fullName}     value={data.name}                      />
                    <SummaryRow label={t.contact.phone}        value={data.phone}                     />
                    {data.email && <SummaryRow label={t.contact.email} value={data.email}             />}
                    {data.notes && <SummaryRow label={t.reserve.notes} value={data.notes}             />}
                  </div>
                  {status === 'error' && (
                    <div className="mt-5 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      <AlertCircle className="h-5 w-5 shrink-0" /> {errorMsg}
                    </div>
                  )}
                </div>
              )}

              {/* Nav */}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 pt-6 dark:border-sand-800">
                {step > 1
                  ? <button onClick={() => setStep((s) => s - 1)} className="flex items-center gap-1.5 rounded-xl border border-sand-200 px-5 py-2.5 text-sm font-semibold text-sand-700 transition-colors hover:bg-sand-50 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800"><BackIcon className="h-4 w-4" /> {t.reserve.back}</button>
                  : <button onClick={() => navigate('home')} className="flex items-center gap-1.5 rounded-xl border border-sand-200 px-5 py-2.5 text-sm font-semibold text-sand-700 transition-colors hover:bg-sand-50 dark:border-sand-700 dark:text-sand-300"><Home className="h-4 w-4" /> {t.reserve.backToHome}</button>
                }
                {step < 4
                  ? <button onClick={() => canNext() && setStep((s) => s + 1)} disabled={!canNext()} className="flex items-center gap-1.5 rounded-xl bg-oasis-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-oasis-700 disabled:cursor-not-allowed disabled:opacity-40">{t.reserve.next} <NextIcon className="h-4 w-4" /></button>
                  : <button onClick={handleConfirm} disabled={status === 'loading'} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-oasis-600 to-oasis-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-oasis-600/20 transition-all hover:shadow-oasis-600/30 disabled:opacity-60">{status === 'loading' ? <><Loader2 className="h-4 w-4 animate-spin" /> {t.reserve.confirming}</> : <><Check className="h-4 w-4" /> {t.reserve.confirm}</>}</button>
                }
              </div>
            </div>
          </div>

          {/* Sidebar summary */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-sand-200 bg-white p-6 shadow-lg dark:border-sand-800 dark:bg-sand-900 lg:sticky lg:top-28">
              <h3 className="font-bold text-sand-900 dark:text-white">{t.reserve.bookingSummary}</h3>
              {selectedPkg ? (
                <>
                  <img loading="lazy" src={selectedPkg.image} alt="" className="mt-4 h-36 w-full rounded-lg object-cover" />
                  <p className="mt-4 font-semibold text-sand-900 dark:text-white">{data.packageName}</p>
                  <p className="text-sm font-bold text-oasis-600 dark:text-oasis-400">{selectedPkg.price}</p>
                  {startDateStr && (
                    <div className="mt-4 space-y-2 border-t border-sand-100 pt-4 text-sm dark:border-sand-800">
                      <SideRow icon={Calendar} label={t.reserve.dates}        value={`${startDateStr} ${startTime} → ${endDateStr} ${endTime}`} />
                      {duration > 0 && <SideRow icon={Calendar} label={t.reserve.tripDuration} value={`${duration} ${t.reserve.days}`} />}
                      <SideRow icon={Users}    label={t.reserve.travelers}    value={String(data.travelers)} />
                      {data.name && <SideRow icon={User} label={t.reserve.fullName} value={data.name} />}
                    </div>
                  )}
                </>
              ) : <p className="mt-4 text-sm text-sand-400">{t.reserve.selectPackageFirst}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
