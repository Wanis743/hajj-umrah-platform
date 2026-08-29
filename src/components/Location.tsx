/**
 * Where the agency is.
 *
 * The map half was `min-h-[280px]` and the copy half was auto-height, so on a
 * phone the map got 280px of a ~640px column and read as a stripe, while on a
 * wide desktop the copy stretched the row and the map inherited whatever height
 * the text happened to need. It is now an explicit `aspect-[4/3]` below the
 * breakpoint and a full-height cell above it, so both halves are deliberate.
 */
import { MapPin, Navigation } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import SectionHeading from './SectionHeading';

const MAP_EMBED =
  'https://www.openstreetmap.org/export/embed.html?bbox=4.2%2C35.2%2C4.3%2C35.3&layer=mapnik&marker=35.2507%2C4.2533';
const MAP_LINK = 'https://www.openstreetmap.org/?mlat=35.2507&mlon=4.2533#map=14/35.2507/4.2533';

export default function Location() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="location" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading badge={t.location.badge} title={t.location.title} subtitle={t.location.subtitle} />

        <div className="gl-panel reveal-item reveal-d1 mt-12 overflow-hidden">
          <div className="grid md:grid-cols-2">
            <div className="relative aspect-[4/3] bg-oasis-100 dark:bg-oasis-950 sm:aspect-[16/9] md:aspect-auto md:min-h-[340px]">
              <iframe
                title="Bou Saâda Map"
                src={MAP_EMBED}
                className="absolute inset-0 h-full w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>

            <div className="flex flex-col justify-center p-6 sm:p-9 md:p-10">
              <span className="gl-sunk flex h-14 w-14 items-center justify-center rounded-2xl border border-oasis-500/25 text-oasis-700 dark:text-oasis-300">
                <MapPin className="h-7 w-7" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-sand-900 text-balance dark:text-white sm:text-xl">
                {t.location.address}
              </h3>
              <p className="mt-2 text-sm text-sand-700 dark:text-sand-300 sm:text-base">{t.contact.addressValue}</p>
              <a
                href={MAP_LINK}
                target="_blank"
                rel="noreferrer"
                className="gl-btn gl-btn-primary mt-6 w-full text-sm sm:w-fit"
              >
                <Navigation className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t.location.getDirections}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
