import { Phone, Mail, MapPin, Clock, MessageCircle } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import { agencyConfig } from '@/config/agency';

export default function Contact() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  // Use config values; only render item if value is configured (non-empty)
  const phone = agencyConfig.phone || agencyConfig.whatsapp || '';
  const email = agencyConfig.email || '';

  const items = [
    phone && { icon: Phone, label: t.contact.phone, value: phone, href: `tel:${phone.replace(/\s/g, '')}`, ltr: true },
    phone && { icon: MessageCircle, label: t.contact.whatsapp, value: phone, href: `https://wa.me/${phone.replace(/\D/g, '')}`, ltr: true },
    email && { icon: Mail, label: t.contact.email, value: email, href: `mailto:${email}`, ltr: true },
    { icon: MapPin, label: t.contact.address, value: t.contact.addressValue, href: '#location', ltr: false },
  ].filter(Boolean) as Array<{ icon: React.ElementType; label: string; value: string; href: string; ltr: boolean }>;

  return (
    <section id="contact" className="bg-sand-50 py-20 transition-colors dark:bg-sand-950 sm:py-24">
      <div ref={ref} className="reveal mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-semibold text-oasis-600 dark:text-oasis-400">{t.contact.badge}</p>
          <h2 className="mt-3 font-serif text-2xl font-bold text-sand-900 dark:text-white sm:text-3xl md:text-4xl">
            {t.contact.title}
          </h2>
          <p className="mt-4 text-base leading-7 text-sand-700 dark:text-sand-300 sm:text-lg sm:leading-8">
            {t.contact.subtitle}
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <a
              key={it.label}
              href={it.href}
              target={it.href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="group rounded-lg border border-sand-200 bg-white p-6 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg dark:border-sand-800 dark:bg-sand-900"
            >
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-oasis-50 text-oasis-600 transition-colors group-hover:bg-oasis-600 group-hover:text-white dark:bg-oasis-900 dark:text-oasis-400">
                <it.icon className="h-6 w-6" />
              </span>
              <p className="mt-4 text-sm text-sand-500 dark:text-sand-400">{it.label}</p>
              <p className="mt-1 font-semibold text-sand-900 dark:text-white" dir={it.ltr ? 'ltr' : undefined}>
                {it.value}
              </p>
            </a>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-2 rounded-lg border border-sand-200 bg-white p-5 text-center shadow-sm dark:border-sand-800 dark:bg-sand-900 sm:flex-row sm:gap-3">
          <Clock className="h-5 w-5 text-oasis-600 dark:text-oasis-400" />
          <span className="text-sm text-sand-700 dark:text-sand-300">
            <span className="font-semibold">{t.contact.hours}:</span> {t.contact.hoursValue}
          </span>
        </div>
      </div>
    </section>
  );
}
