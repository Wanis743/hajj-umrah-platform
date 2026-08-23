import { useState, useEffect } from 'react';
import { Plane, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { useReveal } from '@/hooks/useReveal';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

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
    <section id="countdown" className="relative overflow-hidden bg-sand-900 py-20 text-white sm:py-24">
      <div className="absolute inset-0">
        <img
          src="https://images.pexels.com/photos/7631853/pexels-photo-7631853.jpeg?auto=compress&cs=tinysrgb&w=1920"
          alt=""
          className="h-full w-full object-cover opacity-15"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-sand-950/90 to-sand-950/95" />
      </div>

      <div ref={ref} className="reveal relative z-10 mx-auto max-w-4xl px-4 text-center sm:px-6">
        <div className="flex items-center justify-center gap-2">
          <Plane className="h-5 w-5 text-oasis-400" />
          <p className="font-semibold text-oasis-400">{t.countdown.badge}</p>
        </div>
        <h2 className="mt-3 font-serif text-2xl font-bold text-balance sm:text-3xl md:text-4xl">
          {t.countdown.title}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-sand-200 sm:text-base sm:leading-8">
          {t.countdown.subtitle}
        </p>

        {loading ? (
          <div className="mt-12 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-oasis-400" />
          </div>
        ) : !targetDate ? (
          <p className="mt-12 text-lg text-sand-300">{t.countdown.noDate}</p>
        ) : (
          <div className="mt-12 grid grid-cols-4 gap-2 sm:gap-6">
            {units.map((u) => (
              <div
                key={u.label}
                className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-2.5 backdrop-blur-sm sm:p-7"
              >
                <p className="font-serif text-xl font-bold tabular-nums text-white sm:text-5xl md:text-6xl">
                  {String(u.value).padStart(2, '0')}
                </p>
                <p className="mt-1.5 text-[10px] text-sand-300 sm:mt-2 sm:text-sm">{u.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
