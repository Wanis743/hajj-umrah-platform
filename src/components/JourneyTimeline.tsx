import { ClipboardCheck, FileText, Plane, Moon, Home } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';

export default function JourneyTimeline() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  const icons = [ClipboardCheck, FileText, Plane, Moon, Home];

  return (
    <section id="journey" className="bg-white py-20 transition-colors dark:bg-sand-900 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.timeline.badge}</p>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 text-balance dark:text-white sm:text-3xl md:text-4xl">
            {t.timeline.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-sand-700 dark:text-sand-300 sm:text-lg sm:leading-8">
            {t.timeline.subtitle}
          </p>
        </div>

        <div className="relative mt-16">
          {/* Vertical line */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-oasis-200 ltr:left-1/2 rtl:right-1/2 dark:bg-oasis-900 sm:-translate-x-1/2" />

          <div className="space-y-12">
            {t.timeline.steps.map((step, i) => {
              const Icon = icons[i] ?? ClipboardCheck;
              const isEven = i % 2 === 0;
              return (
                <div key={i} className={`relative flex items-center gap-6 ${isEven ? 'sm:flex-row' : 'sm:flex-row-reverse'}`}>
                  {/* Icon node */}
                  <div className="absolute z-10 flex h-12 w-12 items-center justify-center rounded-full bg-oasis-600 text-white shadow-lg ltr:left-1/2 rtl:right-1/2 -translate-x-1/2 sm:static sm:translate-x-0">
                    <Icon className="h-6 w-6" />
                  </div>

                  {/* Content card */}
                  <div className={`ms-16 flex-1 sm:ms-0 ${isEven ? 'sm:text-end' : 'sm:text-start'}`}>
                    <div className="rounded-lg border border-sand-200 bg-sand-50 p-5 shadow-sm transition-all hover:shadow-md dark:border-sand-800 dark:bg-sand-950 sm:p-6">
                      <span className="font-serif text-sm font-bold text-oasis-600 dark:text-oasis-400">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="mt-1 text-lg font-bold text-sand-900 dark:text-white">{step.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-sand-600 dark:text-sand-400">{step.desc}</p>
                    </div>
                  </div>

                  {/* Spacer for desktop alternating layout */}
                  <div className="hidden flex-1 sm:block" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
