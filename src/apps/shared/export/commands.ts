/**
 * The four formats as *commands*, so a format is reachable from every surface.
 *
 * A menu on the toolbar is not enough. The Finance OS routes jump lists, the
 * Start search box and the command palette through the same `commands` array in
 * an app's manifest, and a manifest is data loaded at boot for all nineteen apps
 * at once — so this file imports types and nothing else. Putting the labels in
 * `index.ts` would drag the CSV writer into the boot graph for the sake of four
 * strings.
 *
 * `export` keeps its id and its `Ctrl+E`: a treasurer who has pressed it for a
 * year still gets a CSV. The four explicit ids sit beside it, which is what the
 * palette and the jump list list.
 */
import type { Localized } from '@/platform/kernel/abi';
import { EXPORT_FORMATS, type ExportFormat } from './document';

// Re-exported so a toolbar or a manifest can name a format without reaching past
// this file into `document.ts` and pulling the writers' module graph with it.
export { EXPORT_FORMATS, type ExportFormat };

const label = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

/** How each format is named to a person, in the three languages of the shell. */
export const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, Localized>> = {
  csv: label('CSV', 'CSV', 'CSV'),
  xlsx: label('Excel', 'Excel', 'Excel'),
  docx: label('Word', 'Word', 'Word'),
  pdf: label('PDF', 'PDF', 'PDF'),
};

/** The full menu entry: the verb and the format, as a command title reads. */
export const EXPORT_COMMAND_TITLES: Readonly<Record<ExportFormat, Localized>> = {
  csv: label('تصدير CSV', 'Exporter en CSV', 'Export as CSV'),
  xlsx: label('تصدير Excel', 'Exporter en Excel', 'Export as Excel'),
  docx: label('تصدير Word', 'Exporter en Word', 'Export as Word'),
  pdf: label('تصدير PDF', 'Exporter en PDF', 'Export as PDF'),
};

/** Command id for a format, e.g. `export:xlsx`. */
export const exportCommandId = (format: ExportFormat): string => `export:${format}`;

export interface ExportCommand {
  readonly id: string;
  readonly title: Localized;
}

/**
 * Spread into a manifest's `commands` beside the app's own. The plain `export`
 * command is *not* included: each app already declares it with its accelerator,
 * and declaring it twice would show it twice in the palette.
 */
export const EXPORT_COMMANDS: readonly ExportCommand[] = EXPORT_FORMATS.map((format) => ({
  id: exportCommandId(format),
  title: EXPORT_COMMAND_TITLES[format],
}));

/**
 * The format a command id asks for, or `null` when the id is not an export.
 *
 * Bare `export` answers `csv` — the historical behaviour of `Ctrl+E`, kept so
 * the accelerator does not silently change what it produces.
 */
export function parseExportCommand(id: string): ExportFormat | null {
  if (id === 'export') return 'csv';
  if (!id.startsWith('export:')) return null;
  const format = id.slice('export:'.length);
  return EXPORT_FORMATS.find((known) => known === format) ?? null;
}
