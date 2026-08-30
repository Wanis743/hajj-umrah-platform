/**
 * Manifest icon names → glyphs.
 *
 * A manifest is data and must not import React, so it names its icon as a string
 * (`'folder'`, `'calculator'`). Something has to resolve that name, and both
 * sides of the boundary need to: the shell paints Start tiles and taskbar
 * buttons from it, and an app that lists other apps — Settings' Apps page —
 * has to paint the same mark without importing the shell, which the boundary
 * forbids it. So the table lives in the SDK — the one place apps and shell
 * already share — rather than being duplicated on either side of it.
 *
 * Names are kebab-case and track the Lucide catalogue, which keeps the mapping
 * guessable when a new manifest is written. An unknown name resolves to a
 * generic window rather than throwing, so a bad icon name can never take a
 * desktop down with it.
 */
import {
  AlertTriangle,
  AppWindow,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Calculator,
  Calendar,
  ChartPie,
  CheckCircle2,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  Gauge,
  Grid2X2,
  HardDrive,
  Inbox,
  Info,
  Landmark,
  LayoutDashboard,
  Library,
  LineChart,
  ListTree,
  Lock,
  type LucideIcon,
  Monitor,
  Percent,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  Target,
  Wallet,
  Wifi,
  XCircle,
} from 'lucide-react';

/** Every icon name a manifest in this image may use. */
export const APP_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  'alert-triangle': AlertTriangle,
  'app-window': AppWindow,
  banknote: Banknote,
  'bar-chart': BarChart3,
  bell: Bell,
  'book-open': BookOpen,
  boxes: Boxes,
  calculator: Calculator,
  calendar: Calendar,
  'chart-pie': ChartPie,
  'check-circle': CheckCircle2,
  'clipboard-list': ClipboardList,
  database: Database,
  files: Files,
  'file-spreadsheet': FileSpreadsheet,
  'file-text': FileText,
  folder: Folder,
  gauge: Gauge,
  grid: Grid2X2,
  'hard-drive': HardDrive,
  inbox: Inbox,
  info: Info,
  landmark: Landmark,
  layout: LayoutDashboard,
  library: Library,
  'line-chart': LineChart,
  'list-tree': ListTree,
  lock: Lock,
  monitor: Monitor,
  percent: Percent,
  'scroll-text': ScrollText,
  search: Search,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  sliders: SlidersHorizontal,
  table: Table2,
  target: Target,
  wallet: Wallet,
  wifi: Wifi,
  'x-circle': XCircle,
};

/** Resolves a manifest icon name; unknown names get the generic window glyph. */
export function glyphFor(name: string): LucideIcon {
  return APP_GLYPHS[name] ?? AppWindow;
}
