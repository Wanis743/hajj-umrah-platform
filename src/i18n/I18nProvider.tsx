/* eslint-disable react-refresh/only-export-components -- provider module intentionally
   exports its context hook alongside the provider component. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, languages, type Lang, type Translation } from './translations';

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translation;
  dir: 'rtl' | 'ltr';
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'agency-erp-lang';

function getInitialLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
  if (stored && languages.some((l) => l.code === stored)) return stored;
  return 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const dir = languages.find((l) => l.code === lang)!.dir;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = (l: Lang) => setLangState(l);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: translations[lang], dir }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
