/**
 * The public header.
 *
 * Three things it now does that it did not before, all of them "control"
 * rather than decoration:
 *
 *   • It is legible on every route. The transparent state only makes sense
 *     over the hero photograph; on the reservation page it was white text on
 *     a cream background, which is to say invisible.
 *   • Its section links work from anywhere. `#packages` from the reservation
 *     page pointed at an element that was not mounted, so the click did
 *     nothing at all.
 *   • It marks where you are. A scroll-spy sets `aria-current` on the link
 *     whose section fills the middle of the viewport.
 *
 * The glass itself is two classes — `gl-nav` for the geometry and safe-area
 * inset, `gl-nav-glass` for the frosted state — so the scroll handler only
 * toggles one token instead of choosing between four colour combinations.
 */
import { type MouseEvent, useEffect, useState } from 'react';
import { Check, ChevronDown, Globe, Menu, Moon, Sun, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/router/RouterProvider';
import { languages, type Lang } from '@/i18n/translations';
import { agencyNames } from '@/lib/agencyName';
import { useActiveSection, useBodyScrollLock, useDismissOnEscape } from '@/hooks/useOverlay';

import logoSrc from '@/assets/agency-logo.png';

interface NavLink {
  readonly id: string;
  readonly label: string;
}

/** Section ids in document order — the scroll-spy watches exactly these. */
const SECTION_IDS = ['home', 'why', 'packages', 'testimonials', 'about', 'contact'] as const;

/* Tone helpers live outside the component so the header itself stays one
 * readable pass of markup rather than a nest of nested ternaries. `onImage`
 * is the only input: it means "the header is transparent over a photograph",
 * which is the one state where every colour inverts.
 */
const GHOST_TONE = (onImage: boolean): string =>
  onImage
    ? 'text-white hover:bg-white/15'
    : 'text-sand-800 hover:bg-sand-900/10 dark:text-sand-200 dark:hover:bg-white/10';

function linkClass(onImage: boolean, isActive: boolean): string {
  const base = 'relative flex min-h-[40px] items-center rounded-full px-3.5 text-sm font-medium transition-colors';
  if (isActive) {
    return `${base} ${onImage ? 'bg-white/20 text-white' : 'bg-oasis-500/15 text-oasis-800 dark:text-oasis-200'}`;
  }
  return `${base} ${
    onImage
      ? 'text-sand-50 hover:bg-white/15 hover:text-white'
      : 'text-sand-700 hover:bg-sand-900/[0.06] hover:text-oasis-700 dark:text-sand-300 dark:hover:bg-white/10 dark:hover:text-oasis-300'
  }`;
}

/* ------------------------------------------------------------------ *
 * Language menu
 * ------------------------------------------------------------------ */

function LanguageMenu({ onImage }: { readonly onImage: boolean }) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const current = languages.find((l) => l.code === lang)!;
  useDismissOnEscape(open, () => setOpen(false));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`gl-tap flex items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${GHOST_TONE(onImage)}`}
        aria-label="Language"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden xs:inline">{current.label}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <>
          {/* Click-away layer. Fixed rather than absolute so it covers the
              page, not just the button's containing block. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            className="gl-panel animate-pop absolute end-0 z-20 mt-2 w-44 overflow-hidden py-1.5"
            role="menu"
          >
            {languages.map((l) => (
              <li key={l.code} role="none">
                <button
                  role="menuitemradio"
                  aria-checked={lang === l.code}
                  onClick={() => {
                    setLang(l.code as Lang);
                    setOpen(false);
                  }}
                  className={`flex min-h-[44px] w-full items-center gap-2.5 px-4 text-sm transition-colors ${
                    lang === l.code
                      ? 'bg-oasis-500/15 font-semibold text-oasis-800 dark:text-oasis-200'
                      : 'text-sand-800 hover:bg-white/50 dark:text-sand-200 dark:hover:bg-white/10'
                  }`}
                >
                  <span aria-hidden="true">{l.flag}</span>
                  <span className="flex-1 text-start">{l.label}</span>
                  {lang === l.code && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mobile sheet
 * ------------------------------------------------------------------ */

interface SheetProps {
  readonly open: boolean;
  readonly links: readonly NavLink[];
  readonly active: string | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  onReserve: () => void;
}

function MobileSheet({ open, links, active, onLink, onReserve }: SheetProps) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div id="nav-sheet" className="px-3 lg:hidden">
      <nav className="gl-panel gl-sheet animate-pop mt-3 p-2.5" aria-label="Mobile">
        <ul className="flex flex-col gap-0.5">
          {links.map((l) => (
            <li key={l.id}>
              <a
                href={`#${l.id}`}
                onClick={(event) => onLink(event, l.id)}
                aria-current={active === l.id ? 'page' : undefined}
                className={`flex min-h-[46px] items-center rounded-xl px-3.5 text-[15px] font-medium transition-colors ${
                  active === l.id
                    ? 'bg-oasis-500/15 text-oasis-800 dark:text-oasis-200'
                    : 'text-sand-800 hover:bg-white/55 dark:text-sand-200 dark:hover:bg-white/10'
                }`}
              >
                {l.label}
              </a>
            </li>
          ))}
          <li className="pt-1.5">
            <button onClick={onReserve} className="gl-btn gl-btn-primary w-full">
              {t.nav.bookNow}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

export default function Navbar() {
  const { t, lang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { route, navigate } = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  const isDark = theme === 'dark';
  const onHome = route === 'home';
  /* Transparent only over the hero. Anywhere else the header must carry its
     own background or its text has nothing to sit on. */
  const onImage = onHome && !scrolled;
  const activeSection = useActiveSection(onHome ? SECTION_IDS : []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Rotating a phone to landscape can cross the `lg` breakpoint, which shows
  // the desktop nav and would otherwise leave the sheet open behind it.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (query.matches) setOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useBodyScrollLock(open);
  useDismissOnEscape(open, () => setOpen(false));

  const links: readonly NavLink[] = [
    { id: 'home', label: t.nav.home },
    { id: 'why', label: t.nav.why },
    { id: 'packages', label: t.nav.packages },
    { id: 'testimonials', label: t.nav.testimonials },
    { id: 'about', label: t.nav.about },
    { id: 'contact', label: t.nav.contact },
  ];

  /**
   * On the homepage the browser handles the anchor and `scroll-margin-top`
   * keeps the heading clear of this header. Off it, the target is not mounted,
   * so the route changes first and the scroll waits for the lazy page.
   */
  const onLink = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    setOpen(false);
    if (onHome) return;
    event.preventDefault();
    navigate('home');
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const { name: agencyDisplayName, sub: agencySub } = agencyNames(lang);

  const titleTone = onImage ? 'text-white drop-shadow' : 'text-sand-900 dark:text-white';
  const subTone = onImage ? 'text-gold-300 drop-shadow' : 'text-gold-600 dark:text-gold-400';

  return (
    <header
      className={`gl-nav fixed inset-x-0 top-0 z-50 ${scrolled || !onHome ? 'gl-nav-glass py-1.5' : 'py-2.5 sm:py-3'}`}
    >
      <nav className="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:px-6" aria-label="Main">
        <a
          href="#home"
          onClick={(event) => onLink(event, 'home')}
          className="flex min-w-0 shrink items-center gap-2.5"
        >
          <img
            src={logoSrc}
            alt={agencyDisplayName}
            className={`shrink-0 rounded-xl object-contain drop-shadow-md transition-all duration-300 ${
              scrolled || !onHome ? 'h-11 w-11 sm:h-12 sm:w-12' : 'h-12 w-12 sm:h-16 sm:w-16'
            }`}
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className={`truncate font-serif text-base font-bold sm:text-2xl ${titleTone}`}>
              {agencyDisplayName}
            </span>
            <span className={`truncate text-[10px] sm:text-xs ${subTone}`}>{agencySub}</span>
          </span>
        </a>

        <ul className="mx-auto hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <li key={l.id}>
              <a
                href={`#${l.id}`}
                onClick={(event) => onLink(event, l.id)}
                aria-current={activeSection === l.id ? 'page' : undefined}
                className={linkClass(onImage, activeSection === l.id)}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1 lg:ms-0">
          <LanguageMenu onImage={onImage} />

          <button
            onClick={toggleTheme}
            className={`gl-tap rounded-full transition-colors ${GHOST_TONE(onImage)}`}
            aria-label={isDark ? t.theme.light : t.theme.dark}
          >
            {isDark ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
          </button>

          <button
            onClick={() => navigate('reserve')}
            className={`gl-btn ms-1 hidden px-5 text-sm md:inline-flex ${onImage ? 'gl-btn-onimage' : 'gl-btn-primary'}`}
          >
            {t.nav.bookNow}
          </button>

          <button
            className={`gl-tap rounded-full transition-colors lg:hidden ${GHOST_TONE(onImage)}`}
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="nav-sheet"
          >
            {open ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <MobileSheet
        open={open}
        links={links}
        active={activeSection}
        onLink={onLink}
        onReserve={() => {
          setOpen(false);
          navigate('reserve');
        }}
      />
    </header>
  );
}
