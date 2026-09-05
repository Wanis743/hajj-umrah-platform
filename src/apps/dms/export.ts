/**
 * Six tabs, six rectangles.
 *
 * `dmsCsv` writes the tab a person is looking at to a file and `dmsClipboard` writes the
 * same rectangle to the clipboard as tab-separated columns, so the file and the paste can
 * never disagree about what a review queue's columns are. One set of column lists, two
 * consumers — the split `../crm/export.ts` makes for the same reason.
 *
 * Cells are raw, in the sense `../shared/csv.ts` means it: `PENDING_REVIEW` rather than
 * `En attente`, `2026-09-12` rather than `12 sept. 2026`, `0.8433` rather than `84 %`. A
 * CSV is opened by a spreadsheet, and a file that arrives pre-formatted cannot be
 * un-formatted. Headers are the exception — they are read by a person and never parsed, so
 * they are translated.
 *
 * Every document table leads with the row's id, which is the least interesting column and
 * the only indispensable one: a document number is assigned by a trigger once a first
 * version finalizes, so a draft has none, and the id is what somebody pastes back when the
 * question is *which row was this*. The two report tables are keyed by what they are about
 * — a field key, a package — because a report has no records of its own to point at.
 *
 * A file is not a screen. `sealChecksum` goes out whole rather than through `shortHash`,
 * and `daysRemaining` travels with the date it is derived from rather than being left to
 * the spreadsheet, so a cell recomputed in Excel cannot become a second opinion about
 * whether a passport has already expired.
 */
import { csvDocument } from '../shared/csv';
import type { DmsModel } from './model';
import type {
  DmsDashboard,
  DmsDocument,
  DmsExpiryDocument,
  DmsPackage,
  DmsQualityField,
  DmsQueueRow,
  DmsView,
} from './types';

/** The runtime's positional translator, narrowed to what a pure module needs. */
export type Translate = (ar: string, fr: string, en: string) => string;

/** A header row and the rows beneath it, all cells already strings. */
interface DmsTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

/** A nullable stamp, date or id column, verbatim from the database. */
const at = (value: string | null): string => value ?? '';

const int = (value: number): string => String(value);

/**
 * A count the server may have no answer for. Blank rather than `0`, because `0` is a
 * measurement and a blank is the absence of one — a size nobody has recorded is not a
 * file of no bytes.
 */
const count = (value: number | null): string => (value === null ? '' : String(value));

/** Two decimals, dot separator: hours waited, a percentage the server already scaled. */
const dec = (value: number | null): string => (value === null ? '' : value.toFixed(2));

/**
 * A 0–1 confidence at four decimals — the engine's own precision rather than the whole
 * percent the screen rounds it to. Whoever opens this column is checking a threshold.
 */
const ratio = (value: number | null): string => (value === null ? '' : value.toFixed(4));

/**
 * `TRUE` / `FALSE`, the one boolean spelling a spreadsheet reads back as a boolean rather
 * than as text. Null is blank, and on `sealMatches` that distinction is the point: a
 * package nobody has sealed has no seal to fail, which is not a broken one.
 */
const flag = (value: boolean | null): string => {
  if (value === null) return '';
  return value ? 'TRUE' : 'FALSE';
};

/** A list column, joined the way the tag editor both shows it and reads it back. */
const list = (values: readonly string[]): string => values.join(', ');

/* ------------------------------------------------------------------ *
 * The dashboard, long
 * ------------------------------------------------------------------ */

/**
 * Four columns — section, item, measure, value — and one row per number on the tab.
 *
 * The other five tabs are grids and export as themselves. The dashboard is four panels
 * whose grains disagree: eight totals, a count per review status, two counts per document
 * type, a count per confidentiality level and three counts per day. Widened into a single
 * rectangle they would be mostly empty cells; in long form every number the screen shows
 * survives the trip, and a pivot table puts any one of the four panels back together.
 *
 * A dashboard that has not answered yet exports its header and no rows — the same thing
 * the grids do when a filter matches nothing. Refusing to write the file would turn an
 * empty tab into a failure rather than an empty tab.
 */
function dashboardTable(report: DmsDashboard | null, tr: Translate): DmsTable {
  const header = [
    tr('القسم', 'Section', 'Section'),
    tr('البند', 'Poste', 'Item'),
    tr('القياس', 'Mesure', 'Measure'),
    tr('القيمة', 'Valeur', 'Value'),
  ];
  if (report === null) return { header, rows: [] };

  const rows: (readonly string[])[] = [];
  const push = (section: string, item: string, measure: string, value: string): void => {
    rows.push([section, item, measure, value]);
  };
  const documents = tr('المستندات', 'Documents', 'Documents');
  const approved = tr('معتمد', 'Approuvés', 'Approved');

  const t = report.totals;
  const totals = tr('الإجماليات', 'Totaux', 'Totals');
  const measures: readonly (readonly [string, number])[] = [
    [documents, t.documents],
    [approved, t.approved],
    [tr('بانتظار المراجعة', 'En attente de revue', 'Awaiting review'), t.awaitingReview],
    [tr('قرب الانتهاء', 'Bientôt expirés', 'Expiring soon'), t.expiringSoon],
    [tr('منتهي', 'Expirés', 'Expired'), t.expired],
    [tr('مؤرشف', 'Archivés', 'Archived'), t.archived],
    [tr('الإصدارات', 'Versions', 'Versions'), t.versions],
    [tr('أُنشئ في النافذة', 'Créés dans la fenêtre', 'Created in window'), t.createdInWindow],
  ];
  measures.forEach(([measure, value]) => push(totals, '', measure, int(value)));

  const byStatus = tr('حسب حالة المراجعة', 'Par statut de revue', 'By review status');
  report.byStatus.forEach((entry) => push(byStatus, entry.status, documents, int(entry.count)));

  const byType = tr('حسب النوع', 'Par type', 'By type');
  report.byType.forEach((entry) => {
    push(byType, entry.documentType, documents, int(entry.count));
    push(byType, entry.documentType, approved, int(entry.approved));
  });

  const byLevel = tr('حسب السرية', 'Par confidentialité', 'By confidentiality');
  report.byConfidentiality.forEach((entry) =>
    push(byLevel, entry.confidentiality, documents, int(entry.count)),
  );

  const activity = tr('النشاط', 'Activité', 'Activity');
  report.activity.forEach((day) => {
    push(activity, day.day, tr('تحميلات', 'Téléversements', 'Uploads'), int(day.uploads));
    push(activity, day.day, tr('اعتمادات', 'Approbations', 'Approvals'), int(day.approvals));
    push(activity, day.day, tr('إرجاعات', 'Retours', 'Returns'), int(day.returns));
  });

  return { header, rows };
}

/* ------------------------------------------------------------------ *
 * The library
 * ------------------------------------------------------------------ */

/**
 * The page as the grid holds it, narrowed by whatever is in the search box.
 *
 * `status` and `reviewStatus` are both columns and neither is redundant: the first is the
 * row's lifecycle and the second is where it sits in the approval chain, and a document
 * can be APPROVED and archived at once. Actor columns go out as uuids — this app joins to
 * no name table, and an id somebody can search for beats a blank that claims nobody.
 */
function documentTable(rows: readonly DmsDocument[], tr: Translate): DmsTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('الرقم', 'Numéro', 'Number'),
      tr('العنوان', 'Titre', 'Title'),
      tr('النوع', 'Type', 'Type'),
      tr('حالة المراجعة', 'Statut de revue', 'Review status'),
      tr('السرية', 'Confidentialité', 'Confidentiality'),
      tr('الحالة', 'État', 'Lifecycle'),
      tr('الوسوم', 'Étiquettes', 'Tags'),
      tr('الإصدارات', 'Versions', 'Versions'),
      tr('تاريخ الإصدار', 'Émis le', 'Issued on'),
      tr('تاريخ الانتهاء', 'Expire le', 'Expires on'),
      tr('الأيام المتبقية', 'Jours restants', 'Days remaining'),
      tr('مهلة التنبيه', 'Préavis (jours)', 'Notice days'),
      tr('تاريخ الإرسال', 'Soumis le', 'Submitted at'),
      tr('المراجع', 'Réviseur', 'Reviewer'),
      tr('تاريخ المراجعة', 'Revu le', 'Reviewed at'),
      tr('تاريخ الاعتماد', 'Approuvé le', 'Approved at'),
      tr('سبب الرفض', 'Motif du refus', 'Rejection reason'),
      tr('ملاحظات المراجعة', 'Notes de revue', 'Review notes'),
      tr('تاريخ الأرشفة', 'Archivé le', 'Archived at'),
      tr('تاريخ الإنشاء', 'Créé le', 'Created at'),
      tr('آخر تحديث', 'Mis à jour le', 'Updated at'),
      tr('الوصف', 'Description', 'Description'),
    ],
    rows: rows.map((doc) => [
      doc.id,
      at(doc.documentNumber),
      doc.title,
      doc.documentType,
      doc.reviewStatus,
      doc.confidentiality,
      doc.status,
      list(doc.tags),
      int(doc.versionCount),
      at(doc.issuedOn),
      at(doc.expiresOn),
      count(doc.daysRemaining),
      int(doc.expiryNoticeDays),
      at(doc.submittedAt),
      at(doc.reviewerId),
      at(doc.reviewedAt),
      at(doc.approvedAt),
      doc.rejectionReason,
      doc.reviewNotes,
      at(doc.archivedAt),
      at(doc.createdAt),
      at(doc.updatedAt),
      doc.description,
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The review queue
 * ------------------------------------------------------------------ */

/**
 * What is waiting on a human, and how long it has been waiting.
 *
 * `waitingHours` is the queue's own float out of `EXTRACT(EPOCH …)/3600`, exported as hours
 * rather than as the localized `3 h` the grid prints: a spreadsheet asked to sort `3 h`
 * sorts it as text. `hasVerifiedBytes` is the one column somebody triaging this file has to
 * see — it is FALSE when a version row exists whose upload never finalized, and approving
 * a document whose bytes never arrived approves nothing.
 */
function queueTable(rows: readonly DmsQueueRow[], tr: Translate): DmsTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('الرقم', 'Numéro', 'Number'),
      tr('العنوان', 'Titre', 'Title'),
      tr('النوع', 'Type', 'Type'),
      tr('حالة المراجعة', 'Statut de revue', 'Review status'),
      tr('السرية', 'Confidentialité', 'Confidentiality'),
      tr('تاريخ الإرسال', 'Soumis le', 'Submitted at'),
      tr('أرسله', 'Soumis par', 'Submitted by'),
      tr('المراجع', 'Réviseur', 'Reviewer'),
      tr('بدأت المراجعة', 'Revue commencée', 'Review started'),
      tr('ساعات الانتظار', 'Heures d’attente', 'Waiting hours'),
      tr('الإصدارات', 'Versions', 'Versions'),
      tr('تاريخ الانتهاء', 'Expire le', 'Expires on'),
      tr('بايتات مؤكدة', 'Octets vérifiés', 'Verified bytes'),
      tr('نوع الملف', 'Type MIME', 'MIME type'),
      tr('الحجم بالبايت', 'Taille (octets)', 'Size bytes'),
    ],
    rows: rows.map((row) => [
      row.id,
      at(row.documentNumber),
      row.title,
      row.documentType,
      row.reviewStatus,
      row.confidentiality,
      at(row.submittedAt),
      at(row.submittedBy),
      at(row.reviewerId),
      at(row.reviewStartedAt),
      dec(row.waitingHours),
      int(row.versionCount),
      at(row.expiresOn),
      flag(row.hasVerifiedBytes),
      row.mimeType,
      count(row.sizeBytes),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * Expiry
 * ------------------------------------------------------------------ */

/**
 * The renewal list, the already-expired first with their days negative.
 *
 * `linkedEntityTypes` is joined rather than dropped because it is the column that turns a
 * list of expiring paper into a list of consequences: a passport with a pilgrim behind it
 * is a trip at risk, and the same passport filed against nothing is housekeeping. The
 * entity types travel as the wire spells them — `booking`, not `Réservation` — like every
 * other enumerated cell in this file.
 */
function expiryTable(rows: readonly DmsExpiryDocument[], tr: Translate): DmsTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('الرقم', 'Numéro', 'Number'),
      tr('العنوان', 'Titre', 'Title'),
      tr('النوع', 'Type', 'Type'),
      tr('حالة المراجعة', 'Statut de revue', 'Review status'),
      tr('تاريخ الإصدار', 'Émis le', 'Issued on'),
      tr('تاريخ الانتهاء', 'Expire le', 'Expires on'),
      tr('الأيام المتبقية', 'Jours restants', 'Days remaining'),
      tr('مهلة التنبيه', 'Préavis (jours)', 'Notice days'),
      tr('تاريخ التنبيه', 'Notifié le', 'Notified at'),
      tr('مرتبط بـ', 'Rattaché à', 'Linked to'),
    ],
    rows: rows.map((row) => [
      row.id,
      at(row.documentNumber),
      row.title,
      row.documentType,
      row.reviewStatus,
      at(row.issuedOn),
      row.expiresOn,
      int(row.daysRemaining),
      int(row.expiryNoticeDays),
      at(row.expiryNotifiedAt),
      list(row.linkedEntityTypes),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * Extraction quality
 * ------------------------------------------------------------------ */

/**
 * Accuracy per field over the window, keyed by field rather than by a row id.
 *
 * A report has no records of its own, so the first column is the field key — the thing the
 * numbers are about. `avgConfidence` is the engine's 0–1 and `accuracyPct` is
 * accepted-over-reviewed already multiplied out in SQL, which is why the two are scaled
 * differently here and why neither becomes a `%` string: they measure different things,
 * and the headers say which.
 *
 * The per-engine panel of the same tab is not in this file. It counts jobs rather than
 * fields, so it is a second rectangle instead of more rows of this one, and a CSV is one
 * rectangle. Somebody who needs it reads the tab.
 */
function qualityTable(rows: readonly DmsQualityField[], tr: Translate): DmsTable {
  return {
    header: [
      tr('الحقل', 'Champ', 'Field'),
      tr('مستخرج', 'Extraits', 'Extracted'),
      tr('مقبول', 'Acceptés', 'Accepted'),
      tr('مصحّح', 'Corrigés', 'Corrected'),
      tr('مرفوض', 'Rejetés', 'Rejected'),
      tr('بانتظار', 'En attente', 'Pending'),
      tr('متوسط الثقة', 'Confiance moyenne', 'Avg confidence'),
      tr('الدقة %', 'Exactitude %', 'Accuracy %'),
    ],
    rows: rows.map((row) => [
      row.fieldKey,
      int(row.extracted),
      int(row.accepted),
      int(row.corrected),
      int(row.rejected),
      int(row.pending),
      ratio(row.avgConfidence),
      dec(row.accuracyPct),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * Evidence packages
 * ------------------------------------------------------------------ */

/**
 * One row per package, and the whole seal checksum.
 *
 * Not shortened the way the detail pane shortens it: the only thing anybody does with a
 * digest is compare it to another one, and a file is where that comparison gets done.
 * A blank `sealMatches` means the package is not sealed yet; FALSE means a member changed
 * underneath a seal, which is the fact this whole subsystem exists to be able to state.
 *
 * The member list is a different grain and stays out of the rectangle. `documentCount` and
 * `driftedDocuments` are what a package row can say about its members without repeating
 * the package on every line.
 */
function packageTable(rows: readonly DmsPackage[], tr: Translate): DmsTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('الاسم', 'Nom', 'Name'),
      tr('الحالة', 'Statut', 'Status'),
      tr('المرجع', 'Référence', 'Reference'),
      tr('الغرض', 'Objet', 'Purpose'),
      tr('عدد المستندات', 'Documents', 'Documents'),
      tr('تاريخ الختم', 'Scellé le', 'Sealed at'),
      tr('ختمه', 'Scellé par', 'Sealed by'),
      tr('بصمة الختم', 'Empreinte du sceau', 'Seal checksum'),
      tr('الختم مطابق', 'Sceau conforme', 'Seal matches'),
      tr('مستندات متغيّرة', 'Documents en écart', 'Drifted documents'),
      tr('تاريخ الإنشاء', 'Créé le', 'Created at'),
      tr('أنشأه', 'Créé par', 'Created by'),
      tr('ملاحظات', 'Notes', 'Notes'),
    ],
    rows: rows.map((pack) => [
      pack.id,
      pack.name,
      pack.status,
      pack.reference,
      pack.purpose,
      int(pack.documentCount),
      at(pack.sealedAt),
      at(pack.sealedBy),
      at(pack.sealChecksum),
      flag(pack.sealMatches),
      int(pack.driftedDocuments),
      at(pack.createdAt),
      at(pack.createdBy),
      pack.notes,
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The two consumers
 * ------------------------------------------------------------------ */

/**
 * The tab a person is looking at, as a table.
 *
 * Every grid case reads the *visible* list rather than the loaded one: the file should hold
 * what the screen holds, search box included, because somebody who typed `passport` and
 * then pressed export asked for the passports. The two report tabs read their report's own
 * payload, which no search box narrows.
 */
function dmsTable(view: DmsView, model: DmsModel, tr: Translate): DmsTable {
  switch (view) {
    case 'dashboard':
      return dashboardTable(model.dashboard.value, tr);
    case 'library':
      return documentTable(model.visible, tr);
    case 'review':
      return queueTable(model.visibleQueue, tr);
    case 'expiry':
      return expiryTable(model.visibleExpiry, tr);
    case 'extraction':
      return qualityTable(model.quality.value?.byField ?? [], tr);
    case 'packages':
      return packageTable(model.visiblePackages, tr);
  }
}

/** The file. CRLF, the comma and the doubled quote are `csvDocument`'s business. */
export const dmsCsv = (view: DmsView, model: DmsModel, tr: Translate): string => {
  const table = dmsTable(view, model, tr);
  return csvDocument(table.header, table.rows);
};

/**
 * The same rectangle as tab-separated columns, which is what a spreadsheet accepts from the
 * clipboard as cells rather than as one long string per row.
 *
 * No quoting: a cell holding a tab or a newline would break the paste, so those are
 * replaced by spaces rather than escaped — the clipboard has no CSV-style escape a
 * spreadsheet honours on paste. An empty tab still yields its header line, which is a
 * truthful answer to *copy what I am looking at*.
 */
export const dmsClipboard = (view: DmsView, model: DmsModel, tr: Translate): string => {
  const table = dmsTable(view, model, tr);
  const flat = (cell: string): string => cell.replace(/[\t\r\n]+/g, ' ');
  const line = (cells: readonly string[]): string => cells.map(flat).join('\t');
  return [line(table.header), ...table.rows.map(line)].join('\n');
};
