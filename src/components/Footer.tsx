/**
 * The footer.
 *
 * Its section links were quietly broken off the homepage: `#why` from the
 * reservation page changed the route (so the page did swap) but the browser had
 * already looked for `#why` before `HomePage` mounted, so you always landed at
 * the top of the site instead of at the section you clicked. Same fix as the
 * header — route first, scroll once the lazy page is mounted.
 *
 * Layout went `md:grid-cols-4`, i.e. one column up to 768px and four after, so
 * a portrait tablet got four ~170px columns of contact details. It is now
 * 1 → 2 → 4 with the brand block spanning the full width until `lg`.
 */
import { type MouseEvent } from 'react';
import { Facebook, Instagram, Mail, MapPin, Phone, Send } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { agencyConfig } from '@/config/agency';
import { agencyNames } from '@/lib/agencyName';
import logoSrc from '@/assets/agency-logo.png';

const SOCIALS = [
  { icon: Facebook, href: import.meta.env.VITE_SOCIAL_FACEBOOK || '', label: 'Facebook' },
  { icon: Instagram, href: import.meta.env.VITE_SOCIAL_INSTAGRAM || '', label: 'Instagram' },
  { icon: Send, href: import.meta.env.VITE_SOCIAL_TELEGRAM || '', label: 'Telegram' },
].filter((s) => Boolean(s.href));

export default function Footer() {
  const { t, lang } = useI18n();
  const { route, navigate } = useRouter();
  const { name: agencyName, sub: agencySub } = agencyNames(lang);

  const links = [
    { id: 'why', label: t.nav.why },
    { id: 'packages', label: t.nav.packages },
    { id: 'testimonials', label: t.nav.testimonials },
    { id: 'about', label: t.nav.about },
    { id: 'contact', label: t.nav.contact },
  ];

  const onLink = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (route === 'home') return;
    event.preventDefault();
    navigate('home');
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const phone = agencyConfig.phone || agencyConfig.whatsapp || '';
  const email = agencyConfig.email || '';
  const hasDetails = Boolean(phone) || Boolean(email) || Boolean(agencyConfig.address);

  return (
    <footer className="gl-stack overflow-hidden bg-sand-950 text-sand-100">
      {/* A single warm glow instead of a flat slab — the footer is the one band
          with no photograph behind it, so it has to make its own light. */}
      <div
        className="absolute inset-0 -z-10 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(63,138,91,0.22),transparent_72%)]"
        aria-hidden="true"
      />
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14">
        <div className="grid gap-9 sm:grid-cols-2 sm:gap-10 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <div className="flex items-center gap-3">
              <img
                loading="lazy"
                decoding="async"
                src={logoSrc}
                alt={agencyName}
                className="h-12 w-12 shrink-0 rounded-xl object-contain drop-shadow-md"
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-serif text-lg font-bold text-white sm:text-xl">{agencyName}</span>
                <span className="truncate text-xs font-semibold text-gold-400">{agencySub}</span>
              </span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-7 text-sand-400">{t.footer.about}</p>
            {SOCIALS.length > 0 && (
              <ul className="mt-5 flex flex-wrap gap-2">
                {SOCIALS.map(({ icon: Icon, href, label }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="gl-tap flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sand-300 backdrop-blur-sm transition-colors hover:border-oasis-500/50 hover:bg-oasis-600 hover:text-white"
                      aria-label={label}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="font-semibold text-white">{t.footer.quickLinks}</h4>
            <ul className="mt-4 space-y-1 text-sm text-sand-400">
              {links.map((l) => (
                <li key={l.id}>
                  <a
                    href={`#${l.id}`}
                    onClick={(event) => onLink(event, l.id)}
                    className="-mx-2 flex min-h-[40px] items-center rounded-lg px-2 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-white">{t.footer.contactUs}</h4>
            <ul className="mt-4 space-y-3 text-sm text-sand-400">
              {Boolean(phone) && (
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
                  <span dir="ltr" className="min-w-0">
                    {phone}
                  </span>
                </li>
              )}
              {Boolean(email) && (
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
                  <span className="min-w-0 break-all">{email}</span>
                </li>
              )}
              {Boolean(agencyConfig.address) && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-oasis-500" aria-hidden="true" />
                  <span className="min-w-0">{agencyConfig.address}</span>
                </li>
              )}
              {!hasDetails && <li className="italic text-sand-600">{t.contact.addressValue}</li>}
            </ul>
          </div>
        </div>

        {/* Pays back the home-indicator inset on iOS, where the last line of a
            footer otherwise sits under the gesture bar. */}
        <div
          className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-sand-500"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          © {new Date().getFullYear()} {t.footer.rights}
        </div>
      </div>
    </footer>
  );
}
