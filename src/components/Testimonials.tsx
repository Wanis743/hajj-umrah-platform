import { Star, Quote } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';

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
    <section id="testimonials" className="bg-sand-100 py-20 transition-colors dark:bg-sand-950 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex items-center justify-center gap-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="h-5 w-5 fill-gold-400 text-gold-400 sm:h-6 sm:w-6" />
            ))}
          </div>
          <p className="mt-4 font-semibold text-oasis-600 dark:text-oasis-400">{t.testimonials.badge}</p>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 text-balance dark:text-white sm:text-3xl md:text-4xl">
            {t.testimonials.title}
          </h2>
          <p className="mt-4 text-base text-sand-700 dark:text-sand-300 sm:text-lg">{t.testimonials.subtitle}</p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {reviews.map((r) => (
            <figure
              key={r.name}
              className="relative rounded-lg border border-sand-200 bg-white p-6 shadow-sm dark:border-sand-800 dark:bg-sand-900 sm:p-7"
            >
              <Quote className="h-8 w-8 text-oasis-200 dark:text-oasis-800" />
              <blockquote className="mt-3 text-sm leading-7 text-sand-700 dark:text-sand-300 sm:text-base sm:leading-8">
                "{r.text}"
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-sand-100 pt-4 dark:border-sand-800">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-oasis-100 font-bold text-oasis-700 dark:bg-oasis-900 dark:text-oasis-300">
                  {r.name.charAt(0)}
                </span>
                <div>
                  <p className="font-semibold text-sand-900 dark:text-white">{r.name}</p>
                  <p className="text-xs text-sand-500 dark:text-sand-400">{r.origin}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
