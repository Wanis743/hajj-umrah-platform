/**
 * Content-type glyphs.
 *
 * The shell has its own copy for the desktop and the taskbar; apps cannot import
 * it across the boundary, and duplicating a nine-entry lookup is cheaper than
 * widening the ABI to carry icon names for files. Lucide is a third-party
 * package, so it is fair game on either side.
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
import type { VfsContentType, VfsStat } from '@/platform/sdk';

export function iconForFile(contentType: VfsContentType, kind: VfsStat['kind']): LucideIcon {
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

/** Human label for the Type column, in the shell's active language. */
export function typeLabel(
  contentType: VfsContentType,
  kind: VfsStat['kind'],
  tr: (ar: string, fr: string, en: string) => string,
): string {
  if (kind === 'directory') return tr('مجلد', 'Dossier', 'File folder');
  switch (contentType) {
    case 'text/plain':
      return tr('مستند نصي', 'Document texte', 'Text document');
    case 'text/markdown':
      return tr('مستند Markdown', 'Document Markdown', 'Markdown document');
    case 'text/csv':
      return tr('قيم مفصولة بفواصل', 'Valeurs séparées par virgules', 'CSV file');
    case 'application/json':
      return tr('مستند JSON', 'Document JSON', 'JSON document');
    case 'application/vnd.financeos.sheet':
      return tr('جدول بيانات', 'Feuille de calcul', 'Sheets workbook');
    case 'application/vnd.financeos.journal':
      return tr('دفعة قيود', 'Lot d’écritures', 'Journal batch');
    case 'application/vnd.financeos.report':
      return tr('تقرير محفوظ', 'Rapport enregistré', 'Saved report');
    case 'application/vnd.financeos.shortcut':
      return tr('اختصار', 'Raccourci', 'Shortcut');
    default:
      return tr('ملف', 'Fichier', 'File');
  }
}

/** Content type for a new file, inferred from its extension. */
export function contentTypeForName(name: string): VfsContentType {
  const dot = name.lastIndexOf('.');
  switch (dot <= 0 ? '' : name.slice(dot).toLowerCase()) {
    case '.md':
      return 'text/markdown';
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    case '.fxsheet':
      return 'application/vnd.financeos.sheet';
    case '.fxjournal':
      return 'application/vnd.financeos.journal';
    case '.fxreport':
      return 'application/vnd.financeos.report';
    case '.lnk':
      return 'application/vnd.financeos.shortcut';
    default:
      return 'text/plain';
  }
}
