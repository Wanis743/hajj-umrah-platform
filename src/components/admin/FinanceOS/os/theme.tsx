import type { LocalizedText } from './osTypes';

export interface WallpaperDef {
  id: string;
  label: LocalizedText;
  /** Swatch gradient used in the Settings preview chip. */
  swatch: string;
  /** Base desktop background colour. */
  base: string;
  /** Blurred light blobs: [color, positionClasses, driftClassName]. */
  blobs: [string, string, 'fos-blob-a' | 'fos-blob-b' | 'fos-blob-c'][];
}

/** Desktop wallpapers. All pure CSS — no assets, always offline-safe. */
export const WALLPAPERS: WallpaperDef[] = [
  {
    id: 'nebula',
    label: { ar: 'سديم', fr: 'Nébuleuse', en: 'Nebula' },
    swatch: 'linear-gradient(135deg,#312e81,#7c3aed 55%,#0ea5e9)',
    base: '#0a0c14',
    blobs: [
      ['rgba(99,102,241,0.35)', '-top-[15%] -left-[10%] w-[55%] h-[60%]', 'fos-blob-a'],
      ['rgba(14,165,233,0.18)', 'top-[35%] -right-[12%] w-[45%] h-[65%]', 'fos-blob-b'],
      ['rgba(168,85,247,0.16)', '-bottom-[20%] left-[20%] w-[60%] h-[55%]', 'fos-blob-c'],
    ],
  },
  {
    id: 'dunes',
    label: { ar: 'كثبان', fr: 'Dunes', en: 'Dunes' },
    swatch: 'linear-gradient(135deg,#78350f,#f59e0b 60%,#b45309)',
    base: '#100b06',
    blobs: [
      ['rgba(245,158,11,0.28)', '-top-[10%] right-[5%] w-[50%] h-[55%]', 'fos-blob-a'],
      ['rgba(180,83,9,0.25)', 'top-[40%] -left-[12%] w-[45%] h-[60%]', 'fos-blob-b'],
      ['rgba(251,191,36,0.12)', '-bottom-[18%] right-[25%] w-[55%] h-[50%]', 'fos-blob-c'],
    ],
  },
  {
    id: 'midnight',
    label: { ar: 'منتصف الليل', fr: 'Minuit', en: 'Midnight' },
    swatch: 'linear-gradient(135deg,#0f172a,#0369a1 60%,#0d9488)',
    base: '#060a12',
    blobs: [
      ['rgba(3,105,161,0.30)', '-top-[18%] left-[15%] w-[50%] h-[60%]', 'fos-blob-a'],
      ['rgba(13,148,136,0.20)', 'top-[30%] -right-[15%] w-[50%] h-[65%]', 'fos-blob-b'],
      ['rgba(30,58,138,0.30)', '-bottom-[22%] left-[10%] w-[60%] h-[60%]', 'fos-blob-c'],
    ],
  },
  {
    id: 'emerald',
    label: { ar: 'زمرد', fr: 'Émeraude', en: 'Emerald' },
    swatch: 'linear-gradient(135deg,#022c22,#059669 60%,#34d399)',
    base: '#050d0a',
    blobs: [
      ['rgba(5,150,105,0.30)', '-top-[15%] -left-[8%] w-[52%] h-[58%]', 'fos-blob-a'],
      ['rgba(52,211,153,0.16)', 'top-[38%] -right-[10%] w-[46%] h-[62%]', 'fos-blob-b'],
      ['rgba(6,95,70,0.35)', '-bottom-[20%] left-[25%] w-[58%] h-[55%]', 'fos-blob-c'],
    ],
  },
];

export interface AccentDef {
  id: string;
  label: LocalizedText;
  /** Hex used for swatches and inline accent styles. */
  hex: string;
  /** CSS var value applied to --brand-500 at the shell root. */
  brand: string;
}

export const ACCENTS: AccentDef[] = [
  { id: 'indigo', hex: '#6366f1', brand: '#6366f1', label: { ar: 'نيلي', fr: 'Indigo', en: 'Indigo' } },
  { id: 'blue', hex: '#3b82f6', brand: '#3b82f6', label: { ar: 'أزرق', fr: 'Bleu', en: 'Blue' } },
  { id: 'emerald', hex: '#10b981', brand: '#10b981', label: { ar: 'زمردي', fr: 'Émeraude', en: 'Emerald' } },
  { id: 'amber', hex: '#f59e0b', brand: '#f59e0b', label: { ar: 'كهرماني', fr: 'Ambre', en: 'Amber' } },
  { id: 'rose', hex: '#f43f5e', brand: '#f43f5e', label: { ar: 'وردي', fr: 'Rose', en: 'Rose' } },
];

export function wallpaper(id: string): WallpaperDef {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}

export function accent(id: string): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

export function nextWallpaperId(current: string): string {
  const idx = WALLPAPERS.findIndex((w) => w.id === current);
  return WALLPAPERS[(idx + 1) % WALLPAPERS.length].id;
}
