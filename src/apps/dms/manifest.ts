/**
 * Documents — the manifest.
 *
 * Installed at boot, long before any of this app's code is downloaded, so this
 * file may not run anything; it only shapes a literal the shell reads to build
 * Start, search, the taskbar and the jump list.
 *
 * The app is a document *management* system rather than a viewer, which is why
 * it lands in `productivity` next to Customers rather than in `accounting`: a
 * passport scan, a supplier contract and a visa approval are all filed here,
 * and only some of them are ever evidence for a journal entry.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const dmsManifest = defineApp({
  id: APP_IDS.dms,
  name: text('الوثائق', 'Documents', 'Documents'),
  description: text(
    'مكتبة الوثائق: التحميل، المراجعة، الصلاحية، الاستخراج وحزم الإثبات.',
    'Bibliothèque documentaire : dépôt, revue, échéances, extraction et dossiers de preuve.',
    'The document library: filing, review, expiry, extraction and evidence packages.',
  ),
  category: 'productivity',
  icon: 'files',

  /**
   * Six capabilities, and the two that look like one are deliberately two.
   *
   * `dms.write` covers everything that moves a document: uploading bytes,
   * moving it through review, linking it to a booking, sealing a package.
   * `ledger.read` is what every dataset in this app costs, and it is also what
   * `dms.document.recordAccess` costs — issuing a signed link writes an access
   * row, but an access row is a reading record, not a document change, so the
   * migration priced it as a read and this manifest does not pretend otherwise.
   *
   * `ledger.post` is NOT requested. A sealed evidence package is proof that a
   * set of documents existed in a known state; it posts nothing. The journal
   * entry that cites it is written in Journal, by someone holding that right.
   *
   * `fs.write` is for exporting the library and the expiry report to the VFS,
   * `clipboard` for copying a checksum or a document number out, `notify` for
   * telling someone their upload finished after they switched windows, and
   * `shell.launch` for opening the entity a document is linked to.
   *
   * `eventlog.read` is absent for the same reason it is absent from Customers:
   * `dms_document_events` is a business history — who submitted, who returned
   * it and why — and the app reads it through `dmsDocument360`, not through the
   * kernel's audit channel.
   */
  capabilities: ['ledger.read', 'dms.write', 'fs.write', 'clipboard', 'notify', 'shell.launch'],

  /**
   * Wider than Customers because the library grid carries a document number, a
   * title, a type, a status, a confidentiality, a version count and two dates
   * before the detail pane opens. The floor is 900 so the rails and the content
   * column still add up: 248 + 360 + 160 = 768, and `AppFrame` folds the aside
   * out of flow below that rather than crushing the grid.
   */
  defaultSize: { w: 1380, h: 820 },
  minSize: { w: 900, h: 540 },
  pinned: true,

  /**
   * English plurals first: the search ranker treats the keyword as the haystack
   * and the typed text as the needle, so `document` matches `documents` but not
   * the other way round.
   */
  keywords: [
    'documents',
    'document',
    'files',
    'library',
    'dms',
    'upload',
    'attachments',
    'scans',
    'passports',
    'visas',
    'contracts',
    'review',
    'approval',
    'expiry',
    'expiring',
    'extraction',
    'ocr',
    'evidence',
    'packages',
    'seal',
    'checksum',
    'وثائق',
    'مستندات',
    'مراجعة',
    'صلاحية',
    'إثبات',
    'documents',
    'pièces',
    'justificatifs',
    'revue',
    'échéance',
    'preuve',
  ],

  /** The four places somebody arrives already knowing where they are going. */
  jumpList: [
    { id: 'view:library', title: text('المكتبة', 'Bibliothèque', 'Library') },
    { id: 'view:review', title: text('قائمة المراجعة', 'File de revue', 'Review queue') },
    { id: 'view:expiry', title: text('الصلاحية', 'Échéances', 'Expiry') },
    { id: 'view:packages', title: text('حزم الإثبات', 'Dossiers de preuve', 'Evidence packages') },
  ],

  /**
   * Published to the palette. `upload` carries `Ctrl+U` rather than `Ctrl+N`:
   * a new document here always starts as bytes arriving, and there is nothing
   * to create without them.
   */
  commands: [
    { id: 'upload', title: text('تحميل وثيقة', 'Déposer un document', 'Upload document'), accelerator: 'Ctrl+U' },
    { id: 'search', title: text('بحث', 'Rechercher', 'Find document'), accelerator: 'Ctrl+F' },
    { id: 'refresh', title: text('تحديث', 'Actualiser', 'Refresh'), accelerator: 'F5' },
    { id: 'export', title: text('تصدير', 'Exporter', 'Export'), accelerator: 'Ctrl+E' },
    { id: 'sweep', title: text('فحص الصلاحية', 'Balayage des échéances', 'Run expiry sweep') },
    { id: 'package:new', title: text('حزمة جديدة', 'Nouveau dossier', 'New evidence package') },
  ],
});
