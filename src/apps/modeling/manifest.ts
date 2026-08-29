/**
 * Modeling — the manifest.
 *
 * A forecast is an argument about the future built out of the past, so the only
 * data capability here is `ledger.read`. There is no `ledger.post`: this window
 * writes nothing to the book, and it could not if it wanted to — the schema has
 * no forecast table, and inventing one by posting entries "for the plan" is how
 * a set of books stops being a set of books.
 *
 * That absence is the design, not a gap. Drivers live in the window, the output
 * leaves as a file (`fs.write`) or as text (`clipboard`), and the number that
 * survives the session is the one somebody chose to save. A planning tool that
 * quietly persisted its assumptions into the ledger would be the same tool with
 * a worse audit trail.
 *
 * `shell.launch` is here for one reason: every projected line is an account, and
 * "why is this line like that" is a question the general ledger answers.
 */
import { APP_IDS } from '@/platform/sdk';
import { defineApp, text } from '../shared/manifest';

export const modelingManifest = defineApp({
  id: APP_IDS.modeling,
  name: text('النماذج المالية', 'Modélisation', 'Modeling'),
  description: text(
    'يبني توقّعًا شهريًا من الحركة المرحَّلة: محرّكات، تجاوزات لكل حساب، ومقارنة بالموازنة',
    'Construit une projection mensuelle à partir du réalisé : moteurs, dérogations par compte et comparaison au budget',
    'Builds a monthly projection from posted activity: drivers, per-account overrides and a comparison against the budget',
  ),
  category: 'planning',
  icon: 'line-chart',
  capabilities: ['ledger.read', 'fs.write', 'clipboard', 'notify', 'shell.launch'],
  defaultSize: { w: 1400, h: 880 },
  minSize: { w: 980, h: 600 },
  keywords: [
    'modeling',
    'model',
    'forecast',
    'projection',
    'scenario',
    'driver',
    'growth',
    'trend',
    'planning',
    'modélisation',
    'prévision',
    'scénario',
    'croissance',
    'tendance',
    'نماذج',
    'توقّع',
    'سيناريو',
    'نمو',
    'اتجاه',
  ],
  jumpList: [
    { id: 'view:forecast', title: text('التوقّع', 'Projection', 'Forecast') },
    { id: 'view:timeline', title: text('الأشهر', 'Mois', 'Months') },
    { id: 'view:compare', title: text('مقارنة بالموازنة', 'Comparer au budget', 'Against the budget') },
  ],
  commands: [
    { id: 'override', title: text('تجاوز المبلغ', 'Déroger au montant', 'Override the amount'), accelerator: 'Ctrl+Enter' },
    { id: 'release', title: text('إلغاء التجاوز', 'Lever la dérogation', 'Release the override'), accelerator: 'Ctrl+Backspace' },
    { id: 'ledger', title: text('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export CSV'), accelerator: 'Ctrl+E' },
    { id: 'copy', title: text('نسخ الملخّص', 'Copier le résumé', 'Copy summary'), accelerator: 'Ctrl+Shift+C' },
    { id: 'reset', title: text('إعادة ضبط السيناريو', 'Réinitialiser le scénario', 'Reset the scenario') },
    { id: 'view:forecast', title: text('التوقّع', 'Projection', 'Forecast'), accelerator: 'Ctrl+1' },
    { id: 'view:timeline', title: text('الأشهر', 'Mois', 'Months'), accelerator: 'Ctrl+2' },
    { id: 'view:compare', title: text('مقارنة بالموازنة', 'Comparer au budget', 'Against the budget'), accelerator: 'Ctrl+3' },
  ],
});
