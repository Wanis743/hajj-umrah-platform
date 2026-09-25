/**
 * The Export control, once, for the fourteen apps that offer it.
 *
 * Every one of them used to render a plain button that produced a CSV, and the
 * button said so — "Export to CSV (Ctrl+E)". Four formats later that label is a
 * menu, and the menu belongs in one file rather than in fourteen toolbars that
 * would drift apart by the second app.
 *
 * A split button, not a menu button: the left half still fires CSV directly, so
 * a treasurer who has pressed Export every Thursday for a year gets the same
 * file from the same click with no menu in the way. `Ctrl+E` is the same promise
 * kept at the keyboard, which is why `parseExportCommand` answers `csv` for the
 * bare id.
 *
 * It emits a *command id*, not a format. The toolbar, the jump list and the
 * command palette then all reach the export through the app's single `perform`
 * path, and the accelerator cannot drift from the button.
 */
import { FileDown, FileSpreadsheet, FileText, FileType, Table, type LucideIcon } from 'lucide-react';
import {
  type ButtonVariant,
  type ControlSize,
  type MenuEntry,
  SplitButton,
  useLocale,
} from '@/platform/sdk';
import {
  EXPORT_COMMAND_TITLES,
  exportCommandId,
  EXPORT_FORMATS,
  type ExportFormat,
} from './export/commands';

/** A glyph per format, so the menu is readable at a glance and not four words. */
const FORMAT_ICON: Readonly<Record<ExportFormat, LucideIcon>> = {
  csv: Table,
  xlsx: FileSpreadsheet,
  docx: FileText,
  pdf: FileType,
};

/**
 * What the left half does, and what the bare `export` command has always done.
 *
 * CSV, because it is the format that opens in everything and the one every one
 * of these buttons produced before the other three existed.
 */
export const DEFAULT_EXPORT_FORMAT: ExportFormat = 'csv';

export interface ExportButtonProps {
  /** Called with `export:xlsx` and friends — the app's own command path. */
  readonly onCommand: (id: string) => void;
  /** True while a file is being written, whichever format it is. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly variant?: ButtonVariant;
  readonly size?: ControlSize;
  readonly block?: boolean;
  /** Overrides the label, for panels that say "Export the table" instead. */
  readonly label?: string;
  /** Overrides the main half's tooltip, which is usually about the file's contents. */
  readonly title?: string;
}

export function ExportButton({
  onCommand,
  busy,
  disabled,
  variant,
  size,
  block,
  label,
  title,
}: ExportButtonProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = EXPORT_FORMATS.map((format) => ({
    id: exportCommandId(format),
    label: t(EXPORT_COMMAND_TITLES[format]),
    icon: FORMAT_ICON[format],
    // Only the default one has an accelerator, because only the default one is
    // what `Ctrl+E` produces.
    accelerator: format === DEFAULT_EXPORT_FORMAT ? 'Ctrl+E' : undefined,
  }));

  return (
    <SplitButton
      icon={FileDown}
      variant={variant}
      size={size}
      block={block}
      busy={busy}
      disabled={disabled}
      title={title ?? tr('تصدير (Ctrl+E)', 'Exporter (Ctrl+E)', 'Export (Ctrl+E)')}
      menuLabel={tr('اختيار الصيغة', 'Choisir le format', 'Choose the format')}
      minWidth={220}
      onClick={() => onCommand(exportCommandId(DEFAULT_EXPORT_FORMAT))}
      entries={entries}
      onSelect={onCommand}
    >
      {label ?? tr('تصدير', 'Exporter', 'Export')}
    </SplitButton>
  );
}
