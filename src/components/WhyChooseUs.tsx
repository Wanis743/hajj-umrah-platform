/**
 * Why choose us.
 *
 * Three cards, and the change worth naming is the breakpoint: `md:grid-cols-3`
 * dropped from one column straight to three at 768px, so a portrait tablet
 * showed three ~230px columns with a seven-word heading wrapping four times.
 * It now goes 1 → 2 → 3, which is what the width actually affords.
 */
import { HeartHandshake, ShieldCheck, Sparkles } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import SectionHeading from './SectionHeading';

export default function WhyChooseUs() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  const features = [
    { icon: Sparkles, title: t.why.f1Title, desc: t.why.f1Desc },
    { icon: ShieldCheck, title: t.why.f2Title, desc: t.why.f2Desc },
    { icon: HeartHandshake, title: t.why.f3Title, desc: t.why.f3Desc },
  ];

  return (
    <section id="why" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div ref={ref} className="reveal relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading badge={t.why.badge} title={t.why.title} subtitle={t.why.subtitle} />

        <div className="mt-12 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {features.map((f, index) => (
            <div
              key={f.title}
              className={`gl-card gl-lift gl-sheen group reveal-item reveal-d${index + 1} flex flex-col p-6 sm:p-7 ${
                // A three-up grid leaves the last card alone on its own row at
                // the two-column width; centring it beats a ragged gap.
                index === 2 ? 'sm:col-span-2 lg:col-span-1' : ''
              }`}
            >
              <span className="gl-sunk flex h-14 w-14 items-center justify-center rounded-2xl border border-oasis-500/25 text-oasis-700 transition-all duration-500 group-hover:scale-105 group-hover:border-oasis-500/50 dark:text-oasis-300">
                <f.icon className="h-7 w-7" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">
                {f.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
