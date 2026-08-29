import { Quote, Star } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import SectionHeading from './SectionHeading';

const reviewsByLang = {
  ar: [
    { name: 'أحمد بن سعيد', origin: 'الجزائر العاصمة', text: 'رحلة منظمة من البداية حتى النهاية. المرشد كان متعاونًا والفنادق قريبة من الحرم. أدّيت عمرة بطمأنينة تامة بفضل وكالة بوسالم.' },
    { name: 'فاطمة الزهراء', origin: 'وهران', text: 'تعاملت مع وكالات كثيرة لكن بوسالم مختلفة. اهتمامهم بكل تفصيل ومرافقتهم لنا خطوة بخطوة جعل الرحلة روحانية لا تُنسى.' },
    { name: 'محمد العربي', origin: 'قسنطينة', text: 'باقة الحج المتميزة فاقت توقعاتي. المخيمات في منى وعرفات كانت مريحة والوجبات ممتازة. شكرًا لكل طاقم بوسالم.' },
  ],
  dz: [
    { name: 'أحمد بن سعيد', origin: 'الجزائر العاصمة', text: 'رحلة منظمة من البداية حتى النهاية. المرشد كان متعاون والفنادق قريبة من الحرم. أدّيت عمرة بطمأنينة كاملة بفضل وكالة بوسالم.' },
    { name: 'فاطمة الزهراء', origin: 'وهران', text: 'تعاملت مع وكالات بزاف ولكن بوسالم مختلفة. اهتمامهم بكل تفصيل ومرافقتهم لنا خطوة بخطوة خلّو الرحلة روحانية ما تتنساش.' },
    { name: 'محمد العربي', origin: 'قسنطينة', text: 'باقة الحج المتميزة فاقت توقعاتي. المخيمات في منى وعرفات كانت مريحة والوجبات ممتازة. شكرًا لكل طاقم بوسالم.' },
  ],
  fr: [
    { name: 'Ahmed Ben Saïd', origin: 'Alger', text: 'Un voyage organisé du début à la fin. Le guide était coopératif et les hôtels proches du Haram. J\'ai accompli l\'Omra en toute sérénité grâce à l\'agence BouSalem.' },
    { name: 'Fatima Zahra', origin: 'Oran', text: 'J\'ai traité avec de nombreuses agences mais BouSalem est différente. Leur attention à chaque détail et leur accompagnement étape par étape ont rendu le voyage inoubliable.' },
    { name: 'Mohamed El Arabi', origin: 'Constantine', text: 'Le forfait Hajj Premium a dépassé mes attentes. Les tentes à Mina et Arafat étaient confortables et les repas excellents. Merci à toute l\'équipe de BouSalem.' },
  ],
  en: [
    { name: 'Ahmed Ben Said', origin: 'Algiers', text: 'A well-organized journey from start to finish. The guide was helpful and the hotels were close to the Haram. I performed Umrah in complete peace thanks to BouSalem Agency.' },
    { name: 'Fatima Zahra', origin: 'Oran', text: 'I\'ve dealt with many agencies but BouSalem is different. Their attention to every detail and step-by-step accompaniment made the journey spiritually unforgettable.' },
    { name: 'Mohamed El Arabi', origin: 'Constantine', text: 'The Premium Hajj package exceeded my expectations. The tents at Mina and Arafat were comfortable and the meals were excellent. Thanks to the entire BouSalem team.' },
  ],
};

export default function Testimonials() {
  const { t, lang } = useI18n();
  const ref = useReveal<HTMLDivElement>();
  const reviews = reviewsByLang[lang] ?? reviewsByLang.ar;

  return (
    <section id="testimonials" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-5 flex items-center justify-center gap-1" role="img" aria-label="5/5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-5 w-5 fill-gold-400 text-gold-400 sm:h-6 sm:w-6" aria-hidden="true" />
          ))}
        </div>

        <SectionHeading
          badge={t.testimonials.badge}
          title={t.testimonials.title}
          subtitle={t.testimonials.subtitle}
        />

        {/* 1 → 2 → 3. It was `md:grid-cols-3`, which put three ~230px columns
            on a portrait tablet and wrapped every quotation to nine lines. */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {reviews.map((r, index) => (
            <figure
              key={r.name}
              className={`gl-card gl-lift-sm reveal-item reveal-d${index + 1} flex flex-col p-6 sm:p-7 ${
                index === 2 ? 'sm:col-span-2 lg:col-span-1' : ''
              }`}
            >
              <Quote className="h-8 w-8 shrink-0 text-oasis-400/70 dark:text-oasis-300/50" aria-hidden="true" />
              <blockquote className="mt-3 flex-1 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base sm:leading-8">
                {r.text}
              </blockquote>
              <figcaption className="gl-divide-t mt-5 flex items-center gap-3 pt-4">
                <span
                  className="gl-sunk flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold text-oasis-700 dark:text-oasis-300"
                  aria-hidden="true"
                >
                  {r.name.charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-sand-900 dark:text-white">{r.name}</span>
                  <span className="block truncate text-xs text-sand-500 dark:text-sand-400">{r.origin}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
