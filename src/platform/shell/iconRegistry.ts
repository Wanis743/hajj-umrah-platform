/**
 * Icon registry.
 *
 * App manifests name their icon as a string (`'folder'`, `'calculator'`) because
 * a manifest is data and must not import React. The name → glyph table itself
 * lives in the SDK (`ui/glyphs`), because an app that lists other apps resolves
 * exactly the same names and cannot import the shell; this module re-exports it
 * under the name the shell has always used, and adds the file-type lookup, which
 * is shell business only.
 *
 * These are plain lookups, kept apart from {@link AppIcon} in `icons.tsx` so
 * that module exports components only and Fast Refresh can replace it.
 */
import {
  AppWindow,
  BookOpen,
  Database,
  FileSpreadsheet,
  FileText,
  Folder,
  type LucideIcon,
  ScrollText,
} from 'lucide-react';

/** Resolves a manifest icon name; unknown names get the generic window glyph. */
export { glyphFor as iconFor } from '../sdk/ui/glyphs';

/** File-type glyphs used by the desktop and Open/Save dialogs. */
export function iconForContentType(contentType: string, kind: 'file' | 'directory'): LucideIcon {
  if (kind === 'directory') return Folder;
  switch (contentType) {
    case 'text/csv':
    case 'application/vnd.financeos.sheet':
      return FileSpreadsheet;
    case 'application/json':
      return Database;
    case 'application/vnd.financeos.journal':
      return BookOpen;
    case 'application/vnd.financeos.report':
      return ScrollText;
    case 'application/vnd.financeos.shortcut':
      return AppWindow;
    default:
      return FileText;
  }
}
