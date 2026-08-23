import type { Translation } from './types';
import { ar } from './ar';
import { dz } from './dz';
import { fr } from './fr';
import { en } from './en';

export type { Translation };
export type Lang = 'ar' | 'fr' | 'en' | 'dz';

export const languages: { code: Lang; label: string; flag: string; dir: 'rtl' | 'ltr' }[] = [
  { code: 'ar', label: 'العربية', flag: '🇩🇿', dir: 'rtl' },
  { code: 'dz', label: 'الدارجة', flag: '🇩🇿', dir: 'rtl' },
  { code: 'fr', label: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'en', label: 'English', flag: '🇬🇧', dir: 'ltr' },
];

export const translations: Record<Lang, Translation> = { ar, dz, fr, en };
