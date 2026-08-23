import { useEffect, useState } from 'react';
import { Menu, X, Moon, Sun, Globe, ChevronDown } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/router/RouterProvider';
import { languages, type Lang } from '@/i18n/translations';
import { agencyConfig } from '@/config/agency';

import logoSrc from '@/assets/agency-logo.png';

export default function Navbar() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { navigate } = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#home', label: t.nav.home },
    { href: '#why', label: t.nav.why },
    { href: '#packages', label: t.nav.packages },
    { href: '#testimonials', label: t.nav.testimonials },
    { href: '#about', label: t.nav.about },
    { href: '#contact', label: t.nav.contact },
  ];

  const isDark = theme === 'dark';
  const currentLang = languages.find((l) => l.code === lang)!;

  // Agency name from config — no hardcoded identity
  const agencyDisplayName = agencyConfig.name || (
    lang === 'ar' || lang === 'dz' ? 'وكالة بوسالم'
    : lang === 'fr' ? 'Agence BouSalem'
    : 'BouSalem Agency'
  );
  const agencySub = lang === 'ar' || lang === 'dz' ? 'لخدمات الحج والعمرة'
    : lang === 'fr' ? 'BouSalem'
    : 'BouSalem';

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? isDark
            ? 'glass-dark shadow-lg py-2'
            : 'glass-light shadow-md py-2'
          : 'bg-transparent py-4'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="#home" className="flex items-center gap-3">
          <img
            src={logoSrc}
            alt={agencyDisplayName}
            className="h-14 w-14 object-contain drop-shadow-md rounded-xl sm:h-16 sm:w-16"
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span
              className={`font-serif text-xl font-bold sm:text-2xl ${
                scrolled ? (isDark ? 'text-white' : 'text-sand-900') : 'text-white'
              }`}
            >
              {agencyDisplayName}
            </span>
            <span
              className={`text-[11px] sm:text-xs ${
                scrolled ? (isDark ? 'text-gold-400' : 'text-gold-600') : 'text-gold-300'
              }`}
            >
              {agencySub}
            </span>
          </span>
        </a>

        <ul className="hidden items-center gap-6 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className={`text-sm font-medium transition-colors ${
                  scrolled
                    ? isDark
                      ? 'text-sand-200 hover:text-oasis-400'
                      : 'text-sand-800 hover:text-oasis-700'
                    : 'text-sand-50 hover:text-white'
                }`}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          {/* Language switcher */}
          <div className="relative">
            <button
              onClick={() => setLangOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                scrolled
                  ? isDark
                    ? 'text-sand-200 hover:bg-sand-800'
                    : 'text-sand-800 hover:bg-sand-100'
                  : 'text-white hover:bg-white/10'
              }`}
              aria-label="Language"
            >
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline">{currentLang.label}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {langOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                <ul className="absolute end-0 z-20 mt-2 w-40 overflow-hidden rounded-xl border border-sand-200 bg-white py-1 shadow-xl dark:border-sand-800 dark:bg-sand-900">
                  {languages.map((l) => (
                    <li key={l.code}>
                      <button
                        onClick={() => {
                          setLang(l.code as Lang);
                          setLangOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors ${
                          lang === l.code
                            ? 'bg-oasis-50 font-semibold text-oasis-700 dark:bg-oasis-900 dark:text-oasis-300'
                            : 'text-sand-700 hover:bg-sand-100 dark:text-sand-300 dark:hover:bg-sand-800'
                        }`}
                      >
                        <span>{l.flag}</span>
                        {l.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              scrolled
                ? isDark
                  ? 'text-sand-200 hover:bg-sand-800'
                  : 'text-sand-800 hover:bg-sand-100'
                : 'text-white hover:bg-white/10'
            }`}
            aria-label={isDark ? t.theme.light : t.theme.dark}
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          <button
            onClick={() => navigate('reserve')}
            className={`hidden rounded-full px-5 py-2 text-sm font-semibold transition-all md:inline-block ${
              scrolled
                ? 'bg-oasis-600 text-sand-50 hover:bg-oasis-700'
                : 'bg-white text-oasis-700 hover:bg-sand-100'
            }`}
          >
            {t.nav.bookNow}
          </button>

          <button
            className={`lg:hidden ${
              scrolled ? (isDark ? 'text-sand-200' : 'text-sand-900') : 'text-white'
            }`}
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="lg:hidden">
          <div className="mx-4 mt-3 rounded-lg border border-sand-200 bg-white p-4 shadow-xl dark:border-sand-800 dark:bg-sand-900">
            <ul className="flex flex-col gap-1">
              {links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-sm font-medium text-sand-800 hover:bg-sand-100 dark:text-sand-200 dark:hover:bg-sand-800"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate('reserve');
                  }}
                  className="mt-1 block w-full rounded-lg bg-oasis-600 px-3 py-2.5 text-center text-sm font-semibold text-sand-50"
                >
                  {t.nav.bookNow}
                </button>
              </li>
            </ul>
          </div>
        </div>
      )}
    </header>
  );
}
