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
  /** Tailwind gradient classes for the app tile — shared muted treatment. */
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

/** Height of the translucent menu bar pinned to the top edge. */
export const MENUBAR_INSET = 30;
/** Space reserved along the bottom edge for the floating Dock. */
export const DOCK_INSET = 88;

/** Application version — keep in sync with the root package.json. */
export const APP_VERSION = '1.1.0';
