import { MapPin, Navigation } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';

export default function Location() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="location" className="bg-sand-50 py-20 transition-colors dark:bg-sand-950 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.location.badge}</p>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 dark:text-white sm:text-3xl md:text-4xl">
            {t.location.title}
          </h2>
          <p className="mt-4 text-base leading-7 text-sand-700 dark:text-sand-300 sm:text-lg sm:leading-8">
            {t.location.subtitle}
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-xl border border-sand-200 bg-white shadow-lg dark:border-sand-800 dark:bg-sand-900">
          <div className="grid md:grid-cols-2">
            <div className="relative min-h-[280px] bg-oasis-100 dark:bg-oasis-900">
              <iframe
                title="Bou Saâda Map"
                src="https://www.openstreetmap.org/export/embed.html?bbox=4.2%2C35.2%2C4.3%2C35.3&layer=mapnik&marker=35.2507%2C4.2533"
                className="absolute inset-0 h-full w-full"
                loading="lazy"
              />
            </div>
            <div className="flex flex-col justify-center p-8 sm:p-10">
              <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-oasis-50 text-oasis-600 dark:bg-oasis-900 dark:text-oasis-400">
                <MapPin className="h-7 w-7" />
              </span>
              <h3 className="mt-5 text-xl font-bold text-sand-900 dark:text-white">{t.location.address}</h3>
              <p className="mt-2 text-sand-700 dark:text-sand-300">{t.contact.addressValue}</p>
              <a
                href="https://www.openstreetmap.org/?mlat=35.2507&mlon=4.2533#map=14/35.2507/4.2533"
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-oasis-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-oasis-700"
              >
                <Navigation className="h-4 w-4" />
                {t.location.getDirections}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
