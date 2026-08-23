import { Award, Users, Globe2, Heart } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';

export default function About() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  const stats = [
    { icon: Users, value: 'آلاف', label: t.about.pilgrims },
    { icon: Award, value: 'عدة', label: t.about.experience },
    { icon: Globe2, value: 'تقييم ممتاز', label: t.about.rating },
    { icon: Heart, value: 'نسبة عالية', label: t.about.satisfaction },
  ];

  return (
    <section id="about" className="bg-white py-20 transition-colors dark:bg-sand-900 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          <div className="relative">
            <img
              src="https://images.pexels.com/photos/31565684/pexels-photo-31565684.jpeg?auto=compress&cs=tinysrgb&w=1100"
              alt=""
              className="rounded-xl object-cover shadow-lg"
            />
            <div className="absolute -bottom-6 -left-6 hidden rounded-lg bg-oasis-600 p-6 text-white shadow-xl sm:block">
              <p className="font-serif text-3xl font-bold">عدة</p>
              <p className="text-sm text-oasis-100">{t.about.yearsExp}</p>
            </div>
          </div>

          <div>
            <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.about.badge}</p>
            <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 dark:text-white sm:text-3xl md:text-4xl">
              {t.about.title}
            </h2>
            <p className="mt-5 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base sm:leading-8">
              {t.about.p1}
            </p>
            <p className="mt-4 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base sm:leading-8">
              {t.about.p2}
            </p>

            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg border border-sand-200 bg-sand-50 p-4 text-center dark:border-sand-800 dark:bg-sand-950 sm:p-5"
                >
                  <s.icon className="mx-auto h-6 w-6 text-oasis-600 dark:text-oasis-400 sm:h-7 sm:w-7" />
                  <p className="mt-2 font-serif text-xl font-bold text-sand-900 dark:text-white sm:text-2xl">{s.value}</p>
                  <p className="text-[11px] text-sand-600 dark:text-sand-400 sm:text-xs">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
