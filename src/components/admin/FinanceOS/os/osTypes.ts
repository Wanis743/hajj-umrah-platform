import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Geometry of a window in desktop coordinates (px, origin top-left). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OSWindow extends Rect {
  id: string;
  appId: string;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Geometry to restore after un-maximizing. */
  restore?: Rect;
}

export type AppCategory = 'accounting' | 'planning' | 'insight' | 'operations' | 'system';

/** Tri-lingual label used across the shell (Arabic / French / English). */
export interface LocalizedText {
  ar: string;
  fr: string;
  en: string;
}

export interface AppDef {
  id: string;
  title: LocalizedText;
  desc: LocalizedText;
  icon: LucideIcon;
  /** Tailwind gradient classes used for the app tile, e.g. "from-indigo-500 to-blue-600". */
  tile: string;
  category: AppCategory;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  component: ComponentType;
  /** Show an icon on the desktop. */
  showOnDesktop: boolean;
  /** Keep a launcher in the taskbar even when closed. */
  pinned: boolean;
}

export interface OSPrefs {
  wallpaper: string;
  accent: string;
  widgets: boolean;
}

export const DEFAULT_PREFS: OSPrefs = {
  wallpaper: 'nebula',
  accent: 'indigo',
  widgets: true,
};

export interface OSNotification {
  id: string;
  kind: 'info' | 'warning' | 'success' | 'error';
  title: string;
  body: string;
  time: number;
  /** Optional target app — clicking the item opens it. */
  appId?: string;
}

/** Live signals derived from the ledger; the tray badge and widgets use these. */
export interface OSSignals {
  loading: boolean;
  draftJournals: number;
  unmatchedBankLines: number;
  openPeriodLabel: string | null;
}

/** Height reserved at the bottom edge for the floating taskbar. */
export const TASKBAR_INSET = 96;

/** Shell version shown in Settings → About and the boot screen. */
export const OS_VERSION = '26.08.2';
export const OS_CODENAME = 'Meridian';
