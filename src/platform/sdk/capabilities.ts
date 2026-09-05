/**
 * Human names for capabilities.
 *
 * The manifest asks for `'ledger.post'`; a consent prompt and Settings'
 * installed-app list both have to show that to a person.
 * The table lives in the SDK because both the shell and ordinary apps need it,
 * and because it is pure data — no kernel access, nothing to gate.
 */
import { CAPABILITIES, type Capability, type Localized } from '../kernel/abi';

const LABELS: Readonly<Record<Capability, Localized>> = {
  'fs.read': { ar: 'قراءة الملفات', fr: 'Lire les fichiers', en: 'Read files' },
  'fs.write': { ar: 'كتابة الملفات', fr: 'Modifier les fichiers', en: 'Write files' },
  'registry.read': { ar: 'قراءة الإعدادات', fr: 'Lire les réglages', en: 'Read settings' },
  'registry.write': { ar: 'تعديل إعدادات النظام', fr: 'Modifier les réglages système', en: 'Change system settings' },
  'ledger.read': { ar: 'قراءة الدفاتر', fr: 'Consulter les comptes', en: 'Read accounting data' },
  'ledger.post': { ar: 'ترحيل القيود', fr: 'Comptabiliser des écritures', en: 'Post journal entries' },
  'ledger.close': { ar: 'إغلاق الفترات', fr: 'Clôturer des périodes', en: 'Close accounting periods' },
  'process.enumerate': { ar: 'عرض العمليات', fr: 'Lister les processus', en: 'List running processes' },
  'process.terminate': { ar: 'إنهاء العمليات', fr: 'Arrêter des processus', en: 'End processes' },
  'service.control': { ar: 'التحكم في الخدمات', fr: 'Contrôler les services', en: 'Control services' },
  'eventlog.read': { ar: 'قراءة سجل الأحداث', fr: 'Lire le journal', en: 'Read the event log' },
  'eventlog.write': { ar: 'الكتابة في السجل', fr: 'Écrire dans le journal', en: 'Write to the event log' },
  notify: { ar: 'إرسال الإشعارات', fr: 'Envoyer des notifications', en: 'Send notifications' },
  clipboard: { ar: 'استخدام الحافظة', fr: 'Utiliser le presse-papiers', en: 'Use the clipboard' },
  'window.manage': { ar: 'إدارة النوافذ', fr: 'Gérer les fenêtres', en: 'Manage windows' },
  'shell.launch': { ar: 'تشغيل التطبيقات', fr: 'Lancer des applications', en: 'Launch apps' },
  'settings.write': { ar: 'حفظ إعدادات التطبيق', fr: 'Enregistrer ses réglages', en: 'Save its own settings' },
  power: { ar: 'إيقاف النظام', fr: 'Arrêter le système', en: 'Shut down or sign out' },
  'net.query': { ar: 'الاتصال بالخدمة', fr: 'Interroger le service', en: 'Query the service' },
  // Worded so a person can tell the two apart at the moment of consent: one edits
  // a working document, the other publishes a number other people will quote.
  'model.write': {
    ar: 'إعداد النماذج المالية',
    fr: 'Modifier les modèles financiers',
    en: 'Edit financial models',
  },
  'model.publish': {
    ar: 'نشر نسخة من النموذج',
    fr: 'Publier une version de modèle',
    en: 'Publish a model version',
  },
  // Says "hand work to someone else" rather than "write handoffs", because the
  // thing being consented to is not a row appearing in a table — it is a colleague
  // in another department acquiring an obligation with this app's name on it.
  'spine.handoff': {
    ar: 'تحويل العمل بين الأقسام',
    fr: 'Transmettre du travail entre services',
    en: 'Hand work to another department',
  },
  // Says "customers and quotes" rather than "write CRM data", because the noun a
  // person recognises is the one they are being asked about. It stops short of the
  // word "sale": accepting a quote is the act that books one, and that act costs
  // `ledger.post` and is labelled above.
  'crm.write': {
    ar: 'إدارة العملاء وعروض الأسعار',
    fr: 'Gérer les clients et les devis',
    en: 'Manage customers and quotes',
  },
  // Says "file and approve documents" rather than "write DMS data", and the verb
  // "approve" is there on purpose: twenty-four of the twenty-six commands behind
  // this capability are filing and tagging, but the review verbs are here too, and
  // an approval is the strongest thing it buys. What it does NOT buy is money
  // moving — approving a scanned invoice under this capability records that the
  // photocopy is legible; posting it costs `ledger.post`.
  'dms.write': {
    ar: 'حفظ الوثائق والموافقة عليها',
    fr: 'Classer et approuver des documents',
    en: 'File and approve documents',
  },
};

const isCapability = (value: string): value is Capability =>
  (CAPABILITIES as readonly string[]).includes(value);

/** Falls back to the raw identifier, so an unknown capability still shows. */
export function capabilityLabel(capability: string): Localized {
  if (isCapability(capability)) return LABELS[capability];
  return { ar: capability, fr: capability, en: capability };
}

export { LABELS as CAPABILITY_LABELS };
