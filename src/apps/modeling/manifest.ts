/**
 * Modeling — the manifest.
 *
 * Two things live in this window, and the capability list is where the difference
 * is declared. The forecast reads the book and writes nothing to it: there is no
 * `ledger.post`, there never will be, and inventing a forecast table by posting
 * entries "for the plan" is how a set of books stops being a set of books. The
 * workbench edits *models* — documents with their own tables, their own versions
 * and their own certificates — and those it does persist.
 *
 * So `model.write` and `model.publish` are here, and they are two capabilities
 * rather than one on purpose. `model.write` covers everything a draft absorbs:
 * assumptions, rows, scenarios, overrides, and recording what the engine measured.
 * `model.publish` is privileged, which means it asks for consent, because it is the
 * act that freezes a version and stamps the hash other screens will quote. A tool
 * that could publish a number under the same permission it uses to type one would
 * be teaching people that the two are the same act.
 *
 * The forecast side keeps its own exits: output leaves as a file (`fs.write`) or as
 * text (`clipboard`), and the number that survives the session is the one somebody
 * chose to save.
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
    'يبني توقّعًا شهريًا من الحركة المرحَّلة، ويحرّر نماذج بصيغ ومحرّكات وسيناريوهات مع شهادة تحقّق',
    'Construit une projection mensuelle à partir du réalisé et édite des modèles à formules, moteurs et scénarios, avec certificat',
    'Builds a monthly projection from posted activity, and edits formula models with drivers, scenarios and a certificate',
  ),
  category: 'planning',
  icon: 'line-chart',
  capabilities: [
    'ledger.read',
    'model.write',
    'model.publish',
    'fs.write',
    'clipboard',
    'notify',
    'shell.launch',
  ],
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
    'formula',
    'assumption',
    'sensitivity',
    'certificate',
    'workbench',
    'modélisation',
    'prévision',
    'scénario',
    'croissance',
    'tendance',
    'formule',
    'hypothèse',
    'sensibilité',
    'certificat',
    'نماذج',
    'توقّع',
    'سيناريو',
    'نمو',
    'اتجاه',
    'صيغة',
    'افتراض',
    'حساسية',
    'شهادة',
  ],
  jumpList: [
    { id: 'view:forecast', title: text('التوقّع', 'Projection', 'Forecast') },
    { id: 'view:timeline', title: text('الأشهر', 'Mois', 'Months') },
    { id: 'view:compare', title: text('مقارنة بالموازنة', 'Comparer au budget', 'Against the budget') },
    { id: 'view:workbench', title: text('ورشة النموذج', 'Atelier du modèle', 'Workbench') },
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
    // Deliberately without accelerators. Certifying and publishing are the two
    // commands whose result other people quote, and a keystroke away from a
    // typo is the wrong distance for either of them.
    { id: 'certify', title: text('إصدار شهادة', 'Certifier le modèle', 'Certify the model') },
    { id: 'publish', title: text('نشر نسخة', 'Publier une version', 'Publish a version') },
    { id: 'view:forecast', title: text('التوقّع', 'Projection', 'Forecast'), accelerator: 'Ctrl+1' },
    { id: 'view:timeline', title: text('الأشهر', 'Mois', 'Months'), accelerator: 'Ctrl+2' },
    { id: 'view:compare', title: text('مقارنة بالموازنة', 'Comparer au budget', 'Against the budget'), accelerator: 'Ctrl+3' },
    { id: 'view:workbench', title: text('ورشة النموذج', 'Atelier du modèle', 'Workbench'), accelerator: 'Ctrl+4' },
  ],
});
