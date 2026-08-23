import { useState } from 'react';
import { Clock, Tag, Check, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { type Pkg } from '@/data/packages';
import { usePublicPackages } from '@/hooks/usePublicPackages';
import { useReveal } from '@/hooks/useReveal';

export default function Packages() {
  const { t, lang } = useI18n();
  const { navigate } = useRouter();
  const ref = useReveal<HTMLDivElement>();
  const [active, setActive] = useState<Pkg | null>(null);
  const { packages } = usePublicPackages(lang);

  const pkgNames: Record<string, { ar: string; fr: string; en: string; dz: string }> = {
    'umrah-ramadan': { ar: 'عمرة رمضان', fr: 'Omra Ramadan', en: 'Ramadan Umrah', dz: 'عمرة رمضان' },
    'hajj-premium': { ar: 'باقة الحج المتميزة', fr: 'Forfait Hajj Premium', en: 'Premium Hajj Package', dz: 'باقة الحج المتميزة' },
    'umrah-economy': { ar: 'عمرة اقتصادية', fr: 'Omra Économique', en: 'Economy Umrah', dz: 'عمرة اقتصادية' },
    'vip-package': { ar: 'باقة VIP', fr: 'Forfait VIP', en: 'VIP Package', dz: 'باقة VIP' },
  };

  const pkgTaglines: Record<string, { ar: string; fr: string; en: string; dz: string }> = {
    'umrah-ramadan': {
      ar: 'أداء العمرة في أفضل ليالي السنة براحة وطمأنينة',
      fr: 'Accomplir l\'Omra durant les meilleures nuits de l\'année en toute sérénité',
      en: 'Perform Umrah during the best nights of the year with comfort and peace',
      dz: 'أداء العمرة في أحسن ليالي السنة براحة وطمأنينة',
    },
    'hajj-premium': {
      ar: 'رحلة حج متكاملة بإشراف ديني وخبرة سنوات',
      fr: 'Un voyage de Hajj complet avec encadrement religieux et des années d\'expérience',
      en: 'A complete Hajj journey with religious supervision and years of experience',
      dz: 'رحلة حج كاملة بإشراف ديني وخبرة سنين',
    },
    'umrah-economy': {
      ar: 'أداء العمرة بميزانية مناسبة دون التفريط في الراحة',
      fr: 'Accomplir l\'Omra avec un budget adapté sans sacrifier le confort',
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

  const includesMap: Record<string, { ar: string[]; fr: string[]; en: string[]; dz: string[] }> = {
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

  const durations: Record<string, { ar: string; fr: string; en: string; dz: string }> = {
    'umrah-ramadan': { ar: '١٠ أيام', fr: '10 jours', en: '10 days', dz: '١٠ أيام' },
    'hajj-premium': { ar: '١٥ يومًا', fr: '15 jours', en: '15 days', dz: '١٥ يوم' },
    'umrah-economy': { ar: '٧ أيام', fr: '7 jours', en: '7 days', dz: '٧ أيام' },
    'vip-package': { ar: '٨ أيام', fr: '8 jours', en: '8 days', dz: '٨ أيام' },
  };

  return (
    <section id="packages" className="bg-white py-20 transition-colors dark:bg-sand-900 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.packages.badge}</p>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 text-balance dark:text-white sm:text-3xl md:text-4xl">
            {t.packages.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-sand-700 dark:text-sand-300 sm:text-lg sm:leading-8">
            {t.packages.subtitle}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => {
            const name = pkgNames[p.id]?.[lang] ?? p.name;
            const tagline = pkgTaglines[p.id]?.[lang] ?? p.tagline;
            const duration = durations[p.id]?.[lang] ?? p.duration;
            return (
              <article
                key={p.id}
                className="group flex flex-col overflow-hidden rounded-lg border border-sand-200 bg-sand-50 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl dark:border-sand-800 dark:bg-sand-950"
              >
                <div className="relative h-44 overflow-hidden sm:h-48">
                  <img loading="lazy"
                    src={p.image}
                    alt={name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-sand-950/60 to-transparent" />
                  <span className="absolute right-3 top-3 rounded-full bg-oasis-600 px-3 py-1 text-xs font-semibold text-white">
                    {p.type}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-base font-bold text-sand-900 dark:text-white sm:text-lg">{name}</h3>
                  <p className="mt-2 text-sm leading-6 text-sand-600 dark:text-sand-400">{tagline}</p>
                  <div className="mt-4 flex items-center gap-2 text-sm text-sand-700 dark:text-sand-300">
                    <Clock className="h-4 w-4 text-oasis-500" />
                    {duration}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-sand-900 dark:text-white">
                    <Tag className="h-4 w-4 text-gold-500" />
                    {p.price}
                  </div>
                  <button
                    onClick={() => setActive(p)}
                    className="mt-5 w-full rounded-full border border-oasis-600 py-2.5 text-sm font-semibold text-oasis-700 transition-colors hover:bg-oasis-600 hover:text-white dark:text-oasis-400 dark:hover:bg-oasis-600 dark:hover:text-white"
                  >
                    {t.packages.details}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {active && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-sand-950/70 p-4 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-md dark:bg-sand-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setActive(null)}
              className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-sand-700 shadow hover:bg-sand-100 dark:bg-sand-800 dark:text-sand-200"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <img loading="lazy" src={active.image} alt={pkgNames[active.id]?.[lang] ?? active.name} className="h-48 w-full rounded-t-3xl object-cover sm:h-52" />
            <div className="p-6 sm:p-7">
              <span className="rounded-full bg-oasis-50 px-3 py-1 text-xs font-semibold text-oasis-700 dark:bg-oasis-900 dark:text-oasis-300">
                {active.type}
              </span>
              <h3 className="mt-3 font-serif text-xl font-bold text-sand-900 dark:text-white sm:text-2xl">
                {pkgNames[active.id]?.[lang] ?? active.name}
              </h3>
              <p className="mt-2 text-sand-600 dark:text-sand-400">{pkgTaglines[active.id]?.[lang] ?? active.tagline}</p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-sand-700 dark:text-sand-300">
                  <Clock className="h-4 w-4 text-oasis-500" /> {durations[active.id]?.[lang] ?? active.duration}
                </span>
                <span className="flex items-center gap-1.5 font-semibold text-sand-900 dark:text-white">
                  <Tag className="h-4 w-4 text-gold-500" /> {active.price}
                </span>
              </div>
              <h4 className="mt-6 font-semibold text-sand-900 dark:text-white">{t.packages.includes}</h4>
              <ul className="mt-3 space-y-2.5">
                {(includesMap[active.id]?.[lang] ?? active.includes).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-sand-700 dark:text-sand-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-oasis-600 dark:text-oasis-400" />
                    {item}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => {
                  setActive(null);
                  navigate('reserve');
                }}
                className="mt-7 block w-full rounded-full bg-oasis-600 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-oasis-700"
              >
                {t.packages.bookThis}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
