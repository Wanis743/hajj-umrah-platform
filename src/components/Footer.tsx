import { Phone, Mail, MapPin, Facebook, Instagram, Send } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { agencyConfig } from '@/config/agency';
import logoSrc from '@/assets/agency-logo.png';

export default function Footer() {
  const { t, lang } = useI18n();

  // Agency name from config — falls back to i18n-neutral label
  const agencyName = agencyConfig.name || (
    lang === 'ar' || lang === 'dz' ? 'وكالة بوسالم'
    : lang === 'fr' ? 'Agence BouSalem'
    : 'BouSalem Agency'
  );
  const agencySub = lang === 'ar' || lang === 'dz' ? 'لخدمات الحج والعمرة'
    : lang === 'fr' ? 'BouSalem'
    : 'BouSalem';

  const links = [
    { href: '#why', label: t.nav.why },
    { href: '#packages', label: t.nav.packages },
    { href: '#testimonials', label: t.nav.testimonials },
    { href: '#about', label: t.nav.about },
    { href: '#contact', label: t.nav.contact },
  ];

  // Social links — only render if configured
  const socialLinks = [
    { icon: Facebook, href: import.meta.env.VITE_SOCIAL_FACEBOOK || '', label: 'Facebook' },
    { icon: Instagram, href: import.meta.env.VITE_SOCIAL_INSTAGRAM || '', label: 'Instagram' },
    { icon: Send, href: import.meta.env.VITE_SOCIAL_TELEGRAM || '', label: 'Telegram' },
  ].filter((s) => Boolean(s.href));

  const phone = agencyConfig.phone || agencyConfig.whatsapp || '';
  const email = agencyConfig.email || '';

  return (
    <footer className="bg-sand-950 text-sand-100">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3">
              <img loading="lazy"
                src={logoSrc}
                alt={agencyName}
                className="h-12 w-12 object-contain drop-shadow-md rounded-xl"
              />
              <div className="flex flex-col leading-tight">
                <span className="font-serif text-xl font-bold text-white">{agencyName}</span>
                <span className="text-xs text-gold-400 font-semibold">{agencySub}</span>
              </div>
            </div>
            <p className="mt-4 max-w-md text-sm leading-7 text-sand-400">{t.footer.about}</p>
            {socialLinks.length > 0 && (
              <div className="mt-5 flex gap-3">
                {socialLinks.map(({ icon: Icon, href, label }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-sand-900 text-sand-300 transition-colors hover:bg-oasis-600 hover:text-sand-50"
                    aria-label={label}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="font-semibold text-white">{t.footer.quickLinks}</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-sand-400">
              {links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="transition-colors hover:text-white">{l.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-white">{t.footer.contactUs}</h4>
            <ul className="mt-4 space-y-3 text-sm text-sand-400">
              {phone && (
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-oasis-500" />
                  <span dir="ltr" className="min-w-0">{phone}</span>
                </li>
              )}
              {email && (
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-oasis-500" />
                  <span className="min-w-0 break-all">{email}</span>
                </li>
              )}
              {agencyConfig.address && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-oasis-500" />
                  <span className="min-w-0">{agencyConfig.address}</span>
                </li>
              )}
              {!phone && !email && !agencyConfig.address && (
                <li className="italic text-sand-600">{t.contact.addressValue}</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-sand-900 pt-6 text-center text-xs text-sand-500">
          © {new Date().getFullYear()} {t.footer.rights}
        </div>
      </div>
    </footer>
  );
}
