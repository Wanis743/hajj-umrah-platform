/**
 * The five-step journey.
 *
 * The mobile layout was broken, not merely tight: the rail and the numbered
 * node were pinned to the centre of the column (`ltr:left-1/2 rtl:right-1/2`)
 * while each card started 64px from the leading edge and stretched to the far
 * one — so on every phone the cards ran straight over the rail and the icons.
 * Below `sm` the rail is now a start-edge spine with the nodes on it and the
 * cards clear of it; from `sm` up it goes back to the centred, alternating
 * layout, which is the width where that reads.
 */
import { ClipboardCheck, FileText, Home, Moon, Plane } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import SectionHeading from './SectionHeading';

const ICONS = [ClipboardCheck, FileText, Plane, Moon, Home];

export default function JourneyTimeline() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="journey" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-5xl px-4 sm:px-6">
        <SectionHeading badge={t.timeline.badge} title={t.timeline.title} subtitle={t.timeline.subtitle} />

        <div className="relative mt-12 sm:mt-16">
          {/* The spine. Fading at both ends so it reads as a path rather than
              a border that someone forgot to finish. */}
          <div
            className="absolute inset-y-0 start-[22px] w-px bg-gradient-to-b from-transparent via-oasis-500/45 to-transparent sm:start-1/2"
            aria-hidden="true"
          />

          <ol className="space-y-8 sm:space-y-12">
            {t.timeline.steps.map((step, i) => {
              const Icon = ICONS[i] ?? ClipboardCheck;
              const isEven = i % 2 === 0;
              return (
                <li
                  key={i}
                  className={`reveal-item reveal-d${(i % 5) + 1} relative flex items-center gap-6 ${
                    isEven ? 'sm:flex-row' : 'sm:flex-row-reverse'
                  }`}
                >
                  <span className="absolute start-0 top-1.5 z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-oasis-500 to-oasis-700 text-white shadow-glow-oasis ring-4 ring-white/70 dark:ring-sand-900/70 sm:static sm:top-auto sm:h-12 sm:w-12">
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                  </span>

                  <div className={`ms-16 min-w-0 flex-1 sm:ms-0 ${isEven ? 'sm:text-end' : 'sm:text-start'}`}>
                    <div className="gl-card gl-lift-sm p-5 sm:p-6">
                      <span className="font-serif text-sm font-bold text-oasis-600 dark:text-oasis-400">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="mt-1 text-lg font-bold text-sand-900 text-balance dark:text-white">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-sand-600 dark:text-sand-400">{step.desc}</p>
                    </div>
                  </div>

                  {/* Balances the alternating desktop layout; on a phone the
                      card already owns the full width. */}
                  <div className="hidden flex-1 sm:block" aria-hidden="true" />
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
