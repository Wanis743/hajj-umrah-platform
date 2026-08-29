/**
 * About the agency.
 *
 * Three control fixes: the photo had no intrinsic size (so the section jumped
 * when it loaded) and no `srcSet` (a 1100px file for a 375px column), the
 * years badge hung outside the container on physical `-left-6` — wrong edge in
 * Arabic, and off the viewport at 640px — and the stat grid went 2 → 4 at
 * `sm`, which is where the column is *narrowest* relative to its content.
 */
import { Award, Globe2, Heart, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import SectionHeading from './SectionHeading';

const PHOTO = 'https://images.pexels.com/photos/31565684/pexels-photo-31565684.jpeg?auto=compress&cs=tinysrgb';

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
    <section id="about" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="reveal-item reveal-d1 relative">
            <img
              src={`${PHOTO}&w=1100`}
              srcSet={`${PHOTO}&w=640 640w, ${PHOTO}&w=900 900w, ${PHOTO}&w=1300 1300w`}
              sizes="(min-width: 1024px) 46vw, 92vw"
              alt=""
              width={1300}
              height={975}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full rounded-3xl object-cover shadow-glass-lg"
            />
            {/* Inside the frame rather than hanging off it: a negative offset
                on the leading edge put this under the viewport edge at 640px
                and on the wrong side of the photo in Arabic. */}
            <p className="gl-tile absolute bottom-4 start-4 px-4 py-3 text-white sm:bottom-5 sm:start-5 sm:px-5 sm:py-4">
              <span className="block font-serif text-2xl font-bold sm:text-3xl">عدة</span>
              <span className="block text-xs text-sand-100 sm:text-sm">{t.about.yearsExp}</span>
            </p>
          </div>

          <div className="reveal-item reveal-d2">
            <SectionHeading badge={t.about.badge} title={t.about.title} align="start" />
            <p className="mt-5 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base sm:leading-8">
              {t.about.p1}
            </p>
            <p className="mt-4 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base sm:leading-8">
              {t.about.p2}
            </p>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="gl-card gl-lift-sm p-4 text-center sm:p-5">
                  <s.icon
                    className="mx-auto h-6 w-6 text-oasis-600 dark:text-oasis-400 sm:h-7 sm:w-7"
                    aria-hidden="true"
                  />
                  <p className="mt-2 font-serif text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">
                    {s.value}
                  </p>
                  <p className="mt-0.5 text-[11px] text-sand-600 dark:text-sand-400 sm:text-xs">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
