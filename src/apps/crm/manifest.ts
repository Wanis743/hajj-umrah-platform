/**
 * CRM — manifest.
 *
 * The commercial end of the business graph. A person enquires, somebody qualifies
 * them, a deal is opened, a quote is priced from the package catalogue, and the
 * moment the customer says yes a booking, an invoice, a payment and a journal
 * entry appear in the same transaction. That last sentence is the reason this app
 * exists inside the OS rather than beside it: the chain does not stop at "sale",
 * and everything after "sale" is already here.
 *
 * `ledger.read` covers all ten pipeline datasets and the package catalogue,
 * because the broker binds them to it rather than to a read capability of their
 * own. That is deliberate and worth stating: who the agency's customers are and
 * what was quoted to them is not a wider secret than the book those quotes end up
 * in, and a second read capability would only have produced installs that could
 * see an invoice but not the quote it came from.
 *
 * Two write capabilities, because there are two sizes of consequence. `crm.write`
 * carries twenty-nine of the thirty commands — naming a lead, dragging a stage,
 * editing a quote line — none of which commit anything, and none of which should
 * raise a dialog. `ledger.post` carries exactly one: `crm.quote.accept`, which
 * posts the booking, the payment and the journal entry. It is privileged, so the
 * kernel raises its own consent at the moment of the sale and this app asks
 * nothing first. Declaring the two apart is the whole point — a salesperson
 * renaming a lead should not be asked for the right to write to the book.
 *
 * `eventlog.read` is not requested. The pipeline keeps its own history in
 * `crm_stage_history`, which is a business record rather than an audit record: it
 * is what a person reads to understand a deal, not what a controller reads to
 * check one. The audit trail belongs to Inbox and Audit, and an app that needed
 * both would be two apps.
 *
 * No file association. A quote is not a document this app owns — the PDF a
 * customer receives is DMS's, and the CSV written here is the pipeline itself,
 * exported for the Monday meeting.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const crmManifest = defineApp({
  id: APP_IDS.crm,
  name: text('العلاقات التجارية', 'Relation client', 'Customers'),
  description: text(
    'العملاء المحتملون والعملاء والفرص وعروض الأسعار والمتابعات، حتى قبول العرض الذي يفتح الحجز والقيد',
    'Prospects, clients, opportunités, devis et relances — jusqu’à l’acceptation qui crée la réservation et l’écriture',
    'Leads, customers, opportunities, quotes and follow-ups — through to the acceptance that books the sale and posts the entry',
  ),
  category: 'productivity',
  icon: 'users',
  capabilities: [
    'ledger.read',
    'crm.write',
    'ledger.post',
    'fs.write',
    'clipboard',
    'notify',
    'shell.launch',
  ],
  // Wider than tall, and wider than most: this app's working shape is a list, a
  // detail pane and an activity column side by side, and the funnel board wants
  // six stage columns readable at once.
  defaultSize: { w: 1360, h: 800 },
  minSize: { w: 900, h: 520 },
  pinned: true,
  keywords: [
    // English first because the search ranker treats the keyword as the haystack:
    // plurals answer both the singular and the plural query, singulars answer only
    // themselves, so anything countable is written plural.
    'crm',
    'customers',
    'clients',
    'leads',
    'prospects',
    'opportunities',
    'pipeline',
    'funnel',
    'quotes',
    'quotations',
    'deals',
    'sales',
    'activities',
    'followups',
    'campaigns',
    'forecast',
    'contacts',
    'clientèle',
    'devis',
    'opportunités',
    'relances',
    'campagnes',
    'ventes',
    'prévisions',
    'عملاء',
    'محتملون',
    'فرص',
    'عروض',
    'أسعار',
    'متابعات',
    'حملات',
    'مبيعات',
    'تنبؤ',
  ],
  // The five surfaces, in the order the pipeline runs. A jump list is read as a
  // sentence about what the app is for, and "leads → customers → deals → quotes →
  // diary" is that sentence.
  jumpList: [
    { id: 'view:leads', title: text('العملاء المحتملون', 'Prospects', 'Leads') },
    { id: 'view:customers', title: text('العملاء', 'Clients', 'Customers') },
    { id: 'view:pipeline', title: text('مسار الفرص', 'Pipeline', 'Pipeline') },
    { id: 'view:quotes', title: text('عروض الأسعار', 'Devis', 'Quotes') },
    { id: 'view:followups', title: text('المتابعات', 'Relances', 'Follow-ups') },
  ],
  commands: [
    {
      id: 'new',
      title: text('جديد', 'Nouveau', 'New'),
      accelerator: 'Ctrl+N',
    },
    // The four acts that move a thing to its next state, and the four that are
    // worth a key. `Ctrl+Enter` is the affirmative act everywhere in the suite and
    // is resolved against whatever is selected: on a lead it converts, on a quote
    // it accepts. `Ctrl+Backspace` is the refusal, and on a quote it declines --
    // which is why the title carries an ellipsis. A decline without its reason is
    // refused by the server, so the key opens a dialog rather than doing the thing.
    {
      id: 'convert',
      title: text('تحويل إلى عميل', 'Convertir en client', 'Convert to customer'),
      accelerator: 'Ctrl+Enter',
    },
    {
      id: 'send',
      title: text('إرسال العرض', 'Envoyer le devis', 'Send quote'),
      accelerator: 'Ctrl+Shift+S',
    },
    {
      id: 'accept',
      title: text('قبول العرض…', 'Accepter le devis…', 'Accept quote…'),
      accelerator: 'Ctrl+Shift+Enter',
    },
    {
      id: 'decline',
      title: text('رفض العرض…', 'Refuser le devis…', 'Decline quote…'),
      accelerator: 'Ctrl+Backspace',
    },
    { id: 'stage', title: text('نقل المرحلة…', 'Changer d’étape…', 'Move stage…') },
    { id: 'log', title: text('تسجيل تواصل…', 'Journaliser un échange…', 'Log activity…') },
    {
      id: 'followup',
      title: text('متابعة جديدة…', 'Nouvelle relance…', 'New follow-up…'),
      accelerator: 'Ctrl+Shift+F',
    },
    { id: 'complete', title: text('إنجاز المتابعة', 'Terminer la relance', 'Complete follow-up') },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'find', title: text('بحث', 'Rechercher', 'Find'), accelerator: 'Ctrl+F' },
    { id: 'export', title: text('تصدير CSV', 'Exporter en CSV', 'Export as CSV'), accelerator: 'Ctrl+E' },
    // All seven surfaces, including the two the jump list leaves out. The palette
    // and the taskbar answer the same question from the keyboard and the mouse, so
    // a view reachable from one and not the other is a view found by accident.
    { id: 'view:leads', title: text('العملاء المحتملون', 'Prospects', 'Leads') },
    { id: 'view:customers', title: text('العملاء', 'Clients', 'Customers') },
    { id: 'view:pipeline', title: text('مسار الفرص', 'Pipeline', 'Pipeline') },
    { id: 'view:quotes', title: text('عروض الأسعار', 'Devis', 'Quotes') },
    { id: 'view:activities', title: text('سجل التواصل', 'Échanges', 'Activities') },
    { id: 'view:followups', title: text('المتابعات', 'Relances', 'Follow-ups') },
    { id: 'view:campaigns', title: text('الحملات', 'Campagnes', 'Campaigns') },
  ],
});
