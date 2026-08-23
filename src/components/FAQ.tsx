import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';

export default function FAQ() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-sand-50 py-20 transition-colors dark:bg-sand-950 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <HelpCircle className="h-5 w-5 text-oasis-600 dark:text-oasis-400" />
            <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.faq.badge}</p>
          </div>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 text-balance dark:text-white sm:text-3xl md:text-4xl">
            {t.faq.title}
          </h2>
          <p className="mt-4 text-base text-sand-700 dark:text-sand-300 sm:text-lg">
            {t.faq.subtitle}
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {t.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className="overflow-hidden rounded-lg border border-sand-200 bg-white shadow-sm dark:border-sand-800 dark:bg-sand-900"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-start"
                >
                  <span className="font-semibold text-sand-900 dark:text-white">{item.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-oasis-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
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
