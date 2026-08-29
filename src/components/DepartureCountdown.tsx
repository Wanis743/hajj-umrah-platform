/**
 * The next-departure countdown.
 *
 * The numerals were the worst responsive break on the site: four columns at
 * `grid-cols-4 gap-2` with `text-xl sm:text-5xl md:text-6xl` meant a 320px
 * phone showed four ~70px tiles holding 20px digits, then the type quadrupled
 * in one step at 640px. It is now two columns until `xs`, four after, with one
 * `text-fluid-num` clamp doing the scaling continuously.
 */
import { useEffect, useState } from 'react';
import { Loader2, Plane } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { useReveal } from '@/hooks/useReveal';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const PHOTO = 'https://images.pexels.com/photos/7631853/pexels-photo-7631853.jpeg?auto=compress&cs=tinysrgb';

function calcTimeLeft(target: string): TimeLeft {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

export default function DepartureCountdown() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase
          .from('settings')
          .select('next_departure_date')
          .eq('id', 1)
          .maybeSingle();
        if (data?.next_departure_date) setTargetDate(data.next_departure_date);
      } catch {
        /* non-fatal: show static countdown */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!targetDate) return;
    setTimeLeft(calcTimeLeft(targetDate));
    const timer = setInterval(() => setTimeLeft(calcTimeLeft(targetDate)), 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  const units = [
    { label: t.countdown.days, value: timeLeft.days },
    { label: t.countdown.hours, value: timeLeft.hours },
    { label: t.countdown.minutes, value: timeLeft.minutes },
    { label: t.countdown.seconds, value: timeLeft.seconds },
  ];

  return (
    <section id="countdown" className="gl-stack overflow-hidden bg-sand-900 py-16 text-white sm:py-24">
      <div className="absolute inset-0 -z-10">
        <img
          src={`${PHOTO}&w=1600`}
          srcSet={`${PHOTO}&w=640 640w, ${PHOTO}&w=1024 1024w, ${PHOTO}&w=1600 1600w`}
          sizes="100vw"
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-sand-950/90 to-sand-950/95" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(63,138,91,0.28),transparent_70%)]" />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-4xl px-4 text-center sm:px-6">
        <p className="gl-chip gl-chip-onimage inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold sm:text-sm">
          <Plane className="h-4 w-4 shrink-0 text-oasis-300" aria-hidden="true" />
          {t.countdown.badge}
        </p>
        <h2 className="mt-4 font-serif text-fluid-title font-bold text-balance">{t.countdown.title}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-fluid-lead text-sand-200 text-balance">{t.countdown.subtitle}</p>

        {loading ? (
          <div className="mt-12 flex items-center justify-center" role="status" aria-label={t.countdown.badge}>
            <Loader2 className="h-8 w-8 animate-spin text-oasis-400" aria-hidden="true" />
          </div>
        ) : targetDate === null ? (
          <p className="mt-12 text-lg text-sand-300">{t.countdown.noDate}</p>
        ) : (
          /* `aria-live` is deliberately off: a value that changes every second
             would make a screen reader talk over everything else on the page. */
          <ul
            className="mt-10 grid grid-cols-2 gap-3 xs:grid-cols-4 sm:mt-12 sm:gap-5"
            role="timer"
            aria-live="off"
          >
            {units.map((u) => (
              <li key={u.label} className="gl-tile gl-lift-sm min-w-0 px-2 py-4 sm:px-4 sm:py-7">
                <p className="font-serif text-fluid-num font-bold tabular-nums text-white">
                  {String(u.value).padStart(2, '0')}
                </p>
                <p className="mt-1.5 text-[11px] text-sand-300 sm:mt-2.5 sm:text-sm">{u.label}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
