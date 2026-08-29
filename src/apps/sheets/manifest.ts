/**
 * Sheets — the manifest.
 *
 * The capabilities are the whole design brief of the app, so they are worth
 * reading as one:
 *
 *   • `fs.read` / `fs.write` — a workbook is a file. `.csv` is the interchange
 *     format the rest of the world speaks and `.fxsheet` is the one that keeps
 *     formulas, formats and column widths, because CSV cannot. Both are plain
 *     text through `fs.readText`, so nothing here needs a binary path.
 *   • `clipboard` — a grid without copy and paste is a table. Unprivileged, which
 *     means the kernel raises no consent for it and the app must not pretend it
 *     does anything more than move text.
 *   • `notify` — long recalculations and failed writes need to say so.
 *
 * There is deliberately no `ledger.read`. Pulling account balances into a cell
 * would make a spreadsheet that silently changes under you, and a workbook whose
 * numbers move between two openings is worse than one that makes you paste.
 */
import { APP_IDS } from '@/platform/sdk';
import { defineApp, text } from '../shared/manifest';

export const sheetsManifest = defineApp({
  id: APP_IDS.sheets,
  name: text('الجداول', 'Feuilles', 'Sheets'),
  description: text(
    'جدول حسابات بصيغ ونطاقات وتنسيقات أرقام، يفتح CSV ويحفظه',
    'Tableur avec formules, plages et formats numériques, lit et écrit le CSV',
    'A spreadsheet with formulas, ranges and number formats that reads and writes CSV',
  ),
  category: 'productivity',
  icon: 'file-spreadsheet',
  capabilities: ['fs.read', 'fs.write', 'clipboard', 'notify'],
  defaultSize: { w: 1180, h: 760 },
  minSize: { w: 640, h: 460 },
  keywords: [
    'sheets',
    'spreadsheet',
    'csv',
    'formula',
    'sum',
    'grid',
    'workbook',
    'tableur',
    'feuille',
    'calcul',
    'formule',
    'جدول',
    'جداول',
    'صيغة',
    'حسابات',
  ],
  fileAssociations: [
    { contentType: 'text/csv', extensions: ['.csv'] },
    { contentType: 'application/vnd.financeos.sheet', extensions: ['.fxsheet'] },
  ],
  jumpList: [
    { id: 'new', title: text('مصنّف جديد', 'Nouveau classeur', 'New workbook') },
    { id: 'open', title: text('فتح…', 'Ouvrir…', 'Open…') },
  ],
  commands: [
    { id: 'new', title: text('مصنّف جديد', 'Nouveau classeur', 'New workbook'), accelerator: 'Ctrl+N' },
    { id: 'open', title: text('فتح…', 'Ouvrir…', 'Open…'), accelerator: 'Ctrl+O' },
    { id: 'save', title: text('حفظ', 'Enregistrer', 'Save'), accelerator: 'Ctrl+S' },
    { id: 'saveAs', title: text('حفظ باسم…', 'Enregistrer sous…', 'Save as…') },
    { id: 'undo', title: text('تراجع', 'Annuler', 'Undo'), accelerator: 'Ctrl+Z' },
    { id: 'redo', title: text('إعادة', 'Rétablir', 'Redo'), accelerator: 'Ctrl+Y' },
    { id: 'sum', title: text('جمع تلقائي', 'Somme automatique', 'AutoSum'), accelerator: 'Alt+=' },
    { id: 'recalc', title: text('إعادة حساب', 'Recalculer', 'Recalculate'), accelerator: 'F9' },
  ],
});
