/**
 * Contact.
 *
 * The four cards were already a sane 1 → 2 → 4 grid; what they lacked was a
 * long-value escape hatch (a configured email overflowed its card rather than
 * wrapping) and any glass. The hours strip below them now shares the same
 * surface vocabulary instead of being a fifth, differently-shaped box.
 */
import type { ElementType } from 'react';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import { agencyConfig } from '@/config/agency';
import SectionHeading from './SectionHeading';

interface Item {
  readonly icon: ElementType;
  readonly label: string;
  readonly value: string;
  readonly href: string;
  /** Phone numbers and addresses render left-to-right even in Arabic. */
  readonly ltr: boolean;
}

export default function Contact() {
  const { t } = useI18n();
  const ref = useReveal<HTMLDivElement>();

  // Config-driven: a channel with no configured value is not rendered at all.
  const phone = agencyConfig.phone || agencyConfig.whatsapp || '';
  const email = agencyConfig.email || '';

  const items = [
    phone && { icon: Phone, label: t.contact.phone, value: phone, href: `tel:${phone.replace(/\s/g, '')}`, ltr: true },
    phone && {
      icon: MessageCircle,
      label: t.contact.whatsapp,
      value: phone,
      href: `https://wa.me/${phone.replace(/\D/g, '')}`,
      ltr: true,
    },
    email && { icon: Mail, label: t.contact.email, value: email, href: `mailto:${email}`, ltr: true },
    { icon: MapPin, label: t.contact.address, value: t.contact.addressValue, href: '#location', ltr: false },
  ].filter(Boolean) as Item[];

  return (
    <section id="contact" className="gl-stack overflow-hidden py-16 sm:py-24">
      <div className="gl-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div ref={ref} className="reveal relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading badge={t.contact.badge} title={t.contact.title} subtitle={t.contact.subtitle} />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
          {items.map((it, index) => (
            <a
              key={it.label}
              href={it.href}
              target={it.href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className={`gl-card gl-lift gl-sheen group reveal-item reveal-d${
                (index % 5) + 1
              } flex flex-col items-center p-6 text-center`}
            >
              <span className="gl-sunk flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-oasis-500/25 text-oasis-700 transition-colors duration-500 group-hover:border-oasis-500/50 dark:text-oasis-300">
                <it.icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <span className="mt-4 text-sm text-sand-500 dark:text-sand-400">{it.label}</span>
              <span
                className="mt-1 break-words font-semibold text-sand-900 dark:text-white"
                dir={it.ltr ? 'ltr' : undefined}
              >
                {it.value}
              </span>
            </a>
          ))}
        </div>

        <p className="gl-card reveal-item reveal-d5 mt-6 flex flex-col items-center justify-center gap-2 px-5 py-4 text-center sm:flex-row sm:gap-3">
          <Clock className="h-5 w-5 shrink-0 text-oasis-600 dark:text-oasis-400" aria-hidden="true" />
          <span className="text-sm text-sand-700 dark:text-sand-300">
            <span className="font-semibold">{t.contact.hours}:</span> {t.contact.hoursValue}
          </span>
        </p>
      </div>
    </section>
  );
}
