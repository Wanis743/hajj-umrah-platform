/**
 * The FAQ accordion.
 *
 * Two real defects, not just styling: the trigger was a bare `<button>` with
 * no `aria-expanded` / `aria-controls`, so a screen reader announced a row of
 * identical unlabelled buttons and never reported open state; and the
 * collapsed panel kept its answer at `opacity-0` inside a `grid-rows-[0fr]`
 * row, which leaves the text focusable and findable by find-in-page while
 * invisible. `visibility` — rather than `hidden` — is what fixes the second
 * without losing the collapse animation: it interpolates as a discrete step
 * that stays `visible` until the transition ends.
 */
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import SectionHeading from './SectionHeading';

export default function FAQ() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading badge={t.faq.badge} title={t.faq.title} subtitle={t.faq.subtitle} />

        <div className="mt-10 space-y-3 sm:mt-12">
          {t.faq.items.map((item, i) => {
            const isOpen = open === i;
            const panelId = `${baseId}-panel-${i}`;
            const buttonId = `${baseId}-button-${i}`;
            return (
              <div key={i} className={`gl-card reveal-item reveal-d${(i % 5) + 1} overflow-hidden`}>
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex min-h-[56px] w-full items-center justify-between gap-4 p-5 text-start text-[15px] font-semibold text-sand-900 transition-colors hover:text-oasis-700 dark:text-white dark:hover:text-oasis-300"
                  >
                    <span className="min-w-0 text-balance">{item.q}</span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-oasis-500 transition-transform duration-300 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                </h3>

                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className={`grid transition-all duration-300 ease-glass ${
                    isOpen ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm leading-7 text-sand-600 dark:text-sand-400">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
