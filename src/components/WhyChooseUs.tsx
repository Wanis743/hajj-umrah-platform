import { Sparkles, ShieldCheck, HeartHandshake } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';

export default function WhyChooseUs() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  const features = [
    { icon: Sparkles, title: t.why.f1Title, desc: t.why.f1Desc },
    { icon: ShieldCheck, title: t.why.f2Title, desc: t.why.f2Desc },
    { icon: HeartHandshake, title: t.why.f3Title, desc: t.why.f3Desc },
  ];

  return (
    <section id="why" className="bg-sand-50 py-20 transition-colors dark:bg-sand-950 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.why.badge}</p>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 text-balance dark:text-white sm:text-3xl md:text-4xl">
            {t.why.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-sand-700 dark:text-sand-300 sm:text-lg sm:leading-8">
            {t.why.subtitle}
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-lg border border-sand-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg dark:border-sand-800 dark:bg-sand-900 sm:p-8"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-oasis-50 text-oasis-600 transition-colors group-hover:bg-oasis-600 group-hover:text-white dark:bg-oasis-900 dark:text-oasis-400">
                <f.icon className="h-7 w-7" />
              </span>
              <h3 className="mt-6 text-lg font-bold text-sand-900 dark:text-white sm:text-xl">{f.title}</h3>
              <p className="mt-3 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
