/**
 * The packages band and its details dialog.
 *
 * Two structural changes behind the glass:
 *
 *   • The four translation tables were rebuilt on every render inside the
 *     component. They are constant data, so they now live at module scope —
 *     which also takes the component from 190 lines to something readable.
 *   • The dialog is a real dialog. It had no `role`, no `aria-modal`, no
 *     Escape, no body-scroll lock (the page scrolled behind it under your
 *     thumb) and no focus trap, and its close button was pinned to the
 *     physical left on a right-to-left site.
 */
import { useState } from 'react';
import { Check, Clock, Tag, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { type Pkg } from '@/data/packages';
import { usePublicPackages } from '@/hooks/usePublicPackages';
import { useReveal } from '@/hooks/useReveal';
import { useBodyScrollLock, useDismissOnEscape, useFocusTrap } from '@/hooks/useOverlay';
import type { Lang } from '@/i18n/translations';
import SectionHeading from './SectionHeading';

type Text = Record<string, Record<Lang, string>>;
type List = Record<string, Record<Lang, readonly string[]>>;

const NAMES: Text = {
  'umrah-ramadan': { ar: 'عمرة رمضان', fr: 'Omra Ramadan', en: 'Ramadan Umrah', dz: 'عمرة رمضان' },
  'hajj-premium': {
    ar: 'باقة الحج المتميزة',
    fr: 'Forfait Hajj Premium',
    en: 'Premium Hajj Package',
    dz: 'باقة الحج المتميزة',
  },
  'umrah-economy': { ar: 'عمرة اقتصادية', fr: 'Omra Économique', en: 'Economy Umrah', dz: 'عمرة اقتصادية' },
  'vip-package': { ar: 'باقة VIP', fr: 'Forfait VIP', en: 'VIP Package', dz: 'باقة VIP' },
};

const DURATIONS: Text = {
  'umrah-ramadan': { ar: '١٠ أيام', fr: '10 jours', en: '10 days', dz: '١٠ أيام' },
  'hajj-premium': { ar: '١٥ يومًا', fr: '15 jours', en: '15 days', dz: '١٥ يوم' },
  'umrah-economy': { ar: '٧ أيام', fr: '7 jours', en: '7 days', dz: '٧ أيام' },
  'vip-package': { ar: '٨ أيام', fr: '8 jours', en: '8 days', dz: '٨ أيام' },
};

const TAGLINES: Text = {
  'umrah-ramadan': {
    ar: 'أداء العمرة في أفضل ليالي السنة براحة وطمأنينة',
    fr: "Accomplir l'Omra durant les meilleures nuits de l'année en toute sérénité",
    en: 'Perform Umrah during the best nights of the year with comfort and peace',
    dz: 'أداء العمرة في أحسن ليالي السنة براحة وطمأنينة',
  },
  'hajj-premium': {
    ar: 'رحلة حج متكاملة بإشراف ديني وخبرة سنوات',
    fr: "Un voyage de Hajj complet avec encadrement religieux et des années d'expérience",
    en: 'A complete Hajj journey with religious supervision and years of experience',
    dz: 'رحلة حج كاملة بإشراف ديني وخبرة سنين',
  },
  'umrah-economy': {
    ar: 'أداء العمرة بميزانية مناسبة دون التفريط في الراحة',
    fr: "Accomplir l'Omra avec un budget adapté sans sacrifier le confort",
    en: 'Perform Umrah with a suitable budget without sacrificing comfort',
    dz: 'أداء العمرة بميزانية مناسبة من غير ما تفرط في الراحة',
  },
  'vip-package': {
    ar: 'تجربة فاخرة مع خدمات حصرية ونقل خاص طوال الرحلة',
    fr: 'Une expérience luxueuse avec services exclusifs et transport privé tout au long du voyage',
    en: 'A luxurious experience with exclusive services and private transport throughout',
    dz: 'تجربة فاخرة مع خدمات حصرية ونقل خاص طول الرحلة',
  },
};

const INCLUDES: List = {
  'umrah-ramadan': {
    ar: ['تأشيرة عمرة كاملة', 'إقامة ٤ ليالٍ في مكة (فندق ٤★)', 'إقامة ٤ ليالٍ في المدينة (فندق ٤★)', 'نقل خاص بين المدينتين', 'مرشد ديني مرافق', 'وجبتي إفطار وسحور'],
    fr: ['Visa Omra complet', '4 nuits à La Mecque (hôtel 4★)', '4 nuits à Médine (hôtel 4★)', 'Transport privé entre les deux villes', 'Guide religieux accompagnant', 'Petit-déjeuner et Sahur'],
    en: ['Full Umrah visa', '4 nights in Mecca (4★ hotel)', '4 nights in Medina (4★ hotel)', 'Private transport between cities', 'Accompanying religious guide', 'Breakfast and Sahur meals'],
    dz: ['تأشيرة عمرة كاملة', '٤ ليالي في مكة (فندق ٤★)', '٤ ليالي في المدينة (فندق ٤★)', 'نقل خاص بين المدينتين', 'مرشد ديني مرافق', 'وجبتي إفطار وسحور'],
  },
  'hajj-premium': {
    ar: ['تأشيرة حج مع جميع التصاريح', 'إقامة في مكة قرب الحرم (فندق ٥★)', 'مخيمات منى وعرفات بمستوى عالٍ', 'نقل حافلات مكيفة ومريحة', 'مرشد ديني وطباخ متخصص', 'وجبات كاملة طوال الرحلة'],
    fr: ['Visa Hajj avec toutes les autorisations', 'Hébergement à La Mecque près du Haram (hôtel 5★)', 'Tentes de Mina et Arafat haut de gamme', 'Transport en bus climatisé confortable', 'Guide religieux et cuisinier spécialisé', 'Repas complets tout au long du voyage'],
    en: ['Hajj visa with all permits', 'Accommodation in Mecca near Haram (5★ hotel)', 'High-quality Mina and Arafat tents', 'Air-conditioned comfortable bus transport', 'Religious guide and specialized cook', 'Full meals throughout the journey'],
    dz: ['تأشيرة حج مع كل التصاريح', 'إقامة في مكة قرب الحرم (فندق ٥★)', 'مخيمات منى وعرفات بمستوى عالي', 'نقل حافلات مكيفة ومريحة', 'مرشد ديني وطباخ مختص', 'وجبات كاملة طول الرحلة'],
  },
  'umrah-economy': {
    ar: ['تأشيرة عمرة', 'إقامة ٣ ليالٍ في مكة (فندق ٣★)', 'إقامة ٣ ليالٍ في المدينة (فندق ٣★)', 'نقل جماعي بين المدينتين', 'مرشد ديني', 'وجبة إفطار'],
    fr: ['Visa Omra', '3 nuits à La Mecque (hôtel 3★)', '3 nuits à Médine (hôtel 3★)', 'Transport collectif entre les villes', 'Guide religieux', 'Petit-déjeuner'],
    en: ['Umrah visa', '3 nights in Mecca (3★ hotel)', '3 nights in Medina (3★ hotel)', 'Group transport between cities', 'Religious guide', 'Breakfast'],
    dz: ['تأشيرة عمرة', '٣ ليالي في مكة (فندق ٣★)', '٣ ليالي في المدينة (فندق ٣★)', 'نقل جماعي بين المدينتين', 'مرشد ديني', 'وجبة إفطار'],
  },
  'vip-package': {
    ar: ['تأشيرة عمرة سريعة', 'إقامة فاخرة ٥★ قرب الحرمين', 'سيارة خاصة بسائق مخصص', 'مرشد ديني خاص', 'وجبات كاملة (بوفيه مفتوح)', 'جولات زيارات في مكة والمدينة'],
    fr: ['Visa Omra rapide', 'Hébergement luxueux 5★ près des deux Harams', 'Voiture privée avec chauffeur dédié', 'Guide religieux privé', 'Repas complets (buffet à volonté)', 'Visites guidées à La Mecque et Médine'],
    en: ['Express Umrah visa', 'Luxury 5★ accommodation near both Harams', 'Private car with dedicated driver', 'Private religious guide', 'Full meals (open buffet)', 'Sightseeing tours in Mecca and Medina'],
    dz: ['تأشيرة عمرة سريعة', 'إقامة فاخرة ٥★ قرب الحرمين', 'سيارة خاصة بسائق مخصص', 'مرشد ديني خاص', 'وجبات كاملة (بوفيه مفتوح)', 'جولات زيارات في مكة والمدينة'],
  },
};

/** The localised copy for one package, falling back to whatever the row carries. */
function copyFor(p: Pkg, lang: Lang) {
  return {
    name: NAMES[p.id]?.[lang] ?? p.name,
    tagline: TAGLINES[p.id]?.[lang] ?? p.tagline,
    duration: DURATIONS[p.id]?.[lang] ?? p.duration,
    includes: INCLUDES[p.id]?.[lang] ?? p.includes,
  };
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

interface CardProps {
  readonly pkg: Pkg;
  readonly index: number;
  onOpen: (pkg: Pkg) => void;
}

function PackageCard({ pkg, index, onOpen }: CardProps) {
  const { t, lang } = useI18n();
  const c = copyFor(pkg, lang);

  return (
    <article
      className={`gl-card gl-lift gl-sheen group reveal-item reveal-d${(index % 5) + 1} flex flex-col overflow-hidden`}
    >
      <div className="relative h-40 overflow-hidden xs:h-44 sm:h-48">
        <img
          loading="lazy"
          decoding="async"
          src={pkg.image}
          alt={c.name}
          className="h-full w-full object-cover transition-transform duration-[900ms] ease-glass group-hover:scale-[1.07]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-sand-950/65 via-sand-950/10 to-transparent" />
        <span className="gl-chip gl-chip-onimage absolute end-3 top-3 px-3 py-1 text-[11px] font-semibold">
          {pkg.type}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h3 className="font-serif text-base font-bold text-sand-900 text-balance dark:text-white sm:text-lg">
          {c.name}
        </h3>
        <p className="mt-2 text-sm leading-6 text-sand-600 dark:text-sand-400">{c.tagline}</p>

        {/* Duration and price share one wrapping row: at 320px they stack, and
            from `xs` up they sit side by side instead of eating two lines. */}
        <div className="gl-divide-t mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-4 text-sm">
          <span className="flex items-center gap-1.5 text-sand-700 dark:text-sand-300">
            <Clock className="h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
            {c.duration}
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-sand-900 dark:text-white">
            <Tag className="h-4 w-4 shrink-0 text-gold-500" aria-hidden="true" />
            {pkg.price}
          </span>
        </div>

        {/* `mt-auto` keeps the buttons on one line across a row of cards whose
            taglines wrap to different heights. */}
        <div className="mt-auto pt-5">
          <button onClick={() => onOpen(pkg)} className="gl-btn gl-btn-glass w-full text-sm">
            {t.packages.details}
          </button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Details dialog
 * ------------------------------------------------------------------ */

interface ModalProps {
  readonly pkg: Pkg;
  onClose: () => void;
  onBook: () => void;
}

function PackageModal({ pkg, onClose, onBook }: ModalProps) {
  const { t, lang } = useI18n();
  const c = copyFor(pkg, lang);
  const panel = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  useDismissOnEscape(true, onClose);

  return (
    <div
      className="gl-scrim z-[60] flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pkg-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="gl-panel gl-modal animate-pop relative w-full max-w-lg outline-none"
      >
        <button
          onClick={onClose}
          className="gl-tap absolute start-3 top-3 z-10 flex items-center justify-center rounded-full bg-sand-950/45 text-white backdrop-blur-sm transition-colors hover:bg-sand-950/65"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* The image is the top of the panel, so it takes the panel's own
            radius — it was `rounded-t-3xl` inside a `rounded-xl` box, which
            left two visible cream slivers at the corners. */}
        <img
          loading="lazy"
          decoding="async"
          src={pkg.image}
          alt={c.name}
          className="h-40 w-full rounded-t-[22px] object-cover xs:h-48 sm:h-56"
        />

        <div className="p-5 sm:p-7">
          <span className="gl-chip px-3 py-1 text-xs font-semibold text-oasis-700 dark:text-oasis-300">
            {pkg.type}
          </span>
          <h3
            id="pkg-dialog-title"
            className="mt-3 font-serif text-xl font-bold text-sand-900 text-balance dark:text-white sm:text-2xl"
          >
            {c.name}
          </h3>
          <p className="mt-2 text-sm text-sand-600 dark:text-sand-400 sm:text-base">{c.tagline}</p>

          <div className="gl-divide-t mt-4 flex flex-wrap gap-x-5 gap-y-2 pt-4 text-sm">
            <span className="flex items-center gap-1.5 text-sand-700 dark:text-sand-300">
              <Clock className="h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
              {c.duration}
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-sand-900 dark:text-white">
              <Tag className="h-4 w-4 shrink-0 text-gold-500" aria-hidden="true" />
              {pkg.price}
            </span>
          </div>

          <h4 className="mt-6 font-semibold text-sand-900 dark:text-white">{t.packages.includes}</h4>
          <ul className="mt-3 space-y-2.5">
            {c.includes.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-sand-700 dark:text-sand-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-oasis-600 dark:text-oasis-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <button onClick={onBook} className="gl-btn gl-btn-primary mt-7 w-full">
            {t.packages.bookThis}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Section
 * ------------------------------------------------------------------ */

export default function Packages() {
  const { t, lang } = useI18n();
  const { navigate } = useRouter();
  const ref = useReveal<HTMLDivElement>();
  const [active, setActive] = useState<Pkg | null>(null);
  const { packages } = usePublicPackages(lang);

  return (
    <section id="packages" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading badge={t.packages.badge} title={t.packages.title} subtitle={t.packages.subtitle} />

        <div className="mt-12 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {packages.map((p, index) => (
            <PackageCard key={p.id} pkg={p} index={index} onOpen={setActive} />
          ))}
        </div>
      </div>

      {active !== null && (
        <PackageModal
          pkg={active}
          onClose={() => setActive(null)}
          onBook={() => {
            setActive(null);
            navigate('reserve');
          }}
        />
      )}
    </section>
  );
}
