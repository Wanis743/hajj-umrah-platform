/**
 * The five grids, and the forty-five columns that are the app's actual reading surface.
 *
 * One file because the five tabs are one control in five configurations: same `DataGrid`, same
 * selection semantics, same context menu, same empty state — different rectangles. CRM
 * settled this shape first (seven grids, each declaring its own column table inline, one
 * exported switch) and it holds here for the same reason: a column table read next to the
 * component that renders it is checkable at a glance, and a column table hoisted to module
 * scope for reuse-that-never-comes is a lookup away from its only caller.
 *
 * The cells themselves are all in `./cells`. What is left here is genuinely per-column:
 * which field, how wide, whether it sorts, and what the header says. A grid body is
 * consequently a column table and a `<DataGrid>` call, and nothing else.
 *
 * Four of the five grids select and activate; the extraction grid does neither, because its
 * rows are `GROUP BY field_key` aggregates with no document behind them — the same fact that
 * makes `EMPTY_SELECTION.extraction` unreachable and `findRow` return null for that tab.
 *
 * Sorting is opt-in per column: `DataGrid` makes a column sortable exactly when it carries a
 * comparator, so the columns that get one are the ones a clerk actually reorders a queue by —
 * a title, a state, a wait, a size, a day count, a stamp. The three comparators below cover
 * all of them, and each puts nulls at the bottom rather than throwing.
 */
import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarClock, FileStack, Inbox, PackageCheck, ScanLine, SearchX } from 'lucide-react';
import {
  DataGrid,
  EmptyState,
  fmt,
  useLocale,
  type AppLang,
  type Column,
} from '@/platform/sdk';
import {
  Chip,
  Confidence,
  Days,
  Hash,
  Seal,
  Stack,
  StateChip,
  TagList,
  Tinted,
  Verified,
} from './cells';
import { actorLabel, DASH, daysUntil, int, pct, size, waited } from './format';
import {
  CONFIDENTIALITY_LABEL,
  humanize,
  labelFor,
  LINK_ENTITY_LABEL,
  PACKAGE_LABEL,
  REVIEW_LABEL,
} from './labels';
import type { DmsShell } from './shell';
import { confidenceTone, CONFIDENTIALITY_TONE, PACKAGE_TONE, REVIEW_TONE } from './tones';
import type {
  DmsDocument,
  DmsExpiryDocument,
  DmsPackage,
  DmsQualityField,
  DmsQueueRow,
} from './types';

/** What every grid needs, which is the whole shell and nothing narrower. */
interface Desk {
  readonly shell: DmsShell;
}

/**
 * `DataGrid` speaks sets because it can multi-select. DMS speaks one id, because everything
 * downstream of the selection — the detail pane, the twenty accelerators, the context menu —
 * acts on a single document. The last key wins, which is the row the user just clicked.
 */
const pick = (choose: (id: string | null) => void) => (keys: ReadonlySet<string>) => {
  const last = [...keys].pop();
  choose(last ?? null);
};

/** The other direction: one id back into the set the grid wants. */
const only = (id: string | null): ReadonlySet<string> => new Set(id === null ? [] : [id]);

const byText = (a: string, b: string): number => a.localeCompare(b);

/** Nulls to the bottom of an ascending sort rather than to a `NaN` comparator. */
const byNum = (a: number | null, b: number | null): number =>
  (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY);

/** ISO stamps sort lexicographically, so this is a string compare and not two `Date`s. */
const byStamp = (a: string | null, b: string | null): number => (a ?? '').localeCompare(b ?? '');

/** `fmt.relativeTime` takes a real date; the nullable columns feeding it need this. */
const ago = (iso: string | null, lang: AppLang): string =>
  iso === null ? DASH : fmt.relativeTime(iso, lang);

interface BlankProps {
  readonly icon: LucideIcon;
  /** True when the search box is holding text, which changes what "empty" means. */
  readonly searching: boolean;
  /** What the tab would be showing if it had anything: "No documents", "Nothing queued". */
  readonly noun: string;
  /** Where the rows come from, so an empty tab says what would fill it. */
  readonly hint: string;
}

/**
 * An empty tab, which is two different facts wearing one component.
 *
 * A grid with no rows because the library is empty needs to say where documents come from; a
 * grid with no rows because the search box has `zzz` in it needs to say the search found
 * nothing. Conflating them is how a filtered view gets read as a broken one.
 *
 * The two strings arrive translated: the callers are all holding `tr` already, and a
 * `Localized` triple per call site would be four lines where one does.
 */
function Blank({ icon, searching, noun, hint }: BlankProps) {
  const { tr } = useLocale();
  if (searching) {
    return (
      <EmptyState
        icon={SearchX}
        title={tr('لا نتائج', 'Aucun résultat', 'No matches')}
        description={tr(
          'لا شيء في هذه الصفحة يطابق ما كتبته.',
          'Rien sur cette page ne correspond à votre saisie.',
          'Nothing on this page matches what you typed.',
        )}
      />
    );
  }
  return <EmptyState icon={icon} title={noun} description={hint} />;
}

/**
 * The library: every document on the page, which is the tab the other four are read against.
 *
 * `model.visible` and not `model.documents.rows` — the search box narrows in the model, over
 * the page the broker returned, because the broker's `where` speaks equality and `in` and has
 * no `ilike` to push a title search down into.
 *
 * `rowHeight={44}` on every grid in this file, because `Stack` puts two lines in a cell and
 * virtualization needs the height it is told. The SDK's default 33 is for one-line rows.
 */
function LibraryGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const { model } = shell;
  const columns: readonly Column<DmsDocument>[] = [
    {
      id: 'title',
      header: tr('المستند', 'Document', 'Document'),
      render: (row) => (
        <Stack title={row.title} caption={row.documentNumber} hint={row.description} />
      ),
      sort: (a, b) => byText(a.title, b.title),
    },
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      width: 140,
      render: (row) => <Chip text={humanize(row.documentType)} />,
      sort: (a, b) => byText(a.documentType, b.documentType),
    },
    {
      id: 'review',
      header: tr('المراجعة', 'Revue', 'Review'),
      width: 132,
      render: (row) => (
        <StateChip value={row.reviewStatus} tones={REVIEW_TONE} labels={REVIEW_LABEL} />
      ),
      sort: (a, b) => byText(a.reviewStatus, b.reviewStatus),
    },
    {
      id: 'confidentiality',
      header: tr('السرية', 'Confidentialité', 'Classification'),
      width: 124,
      render: (row) => (
        <StateChip
          value={row.confidentiality}
          tones={CONFIDENTIALITY_TONE}
          labels={CONFIDENTIALITY_LABEL}
        />
      ),
    },
    {
      id: 'tags',
      header: tr('الوسوم', 'Étiquettes', 'Tags'),
      width: 150,
      render: (row) => <TagList tags={row.tags} />,
    },
    {
      id: 'versions',
      header: tr('نسخ', 'Vers.', 'Vers.'),
      width: 64,
      align: 'end',
      title: tr('عدد النسخ', 'Nombre de versions', 'Version count'),
      render: (row) => int(row.versionCount, lang),
      sort: (a, b) => byNum(a.versionCount, b.versionCount),
    },
    {
      id: 'expiry',
      header: tr('أيام', 'Jours', 'Days'),
      width: 72,
      align: 'end',
      title: tr('أيام حتى الانتهاء', 'Jours avant expiration', 'Days to expiry'),
      render: (row) => <Days days={row.daysRemaining} on={row.expiresOn} />,
      sort: (a, b) => byNum(a.daysRemaining, b.daysRemaining),
    },
    {
      id: 'updated',
      header: tr('آخر تحديث', 'Modifié', 'Updated'),
      width: 116,
      render: (row) => ago(row.updatedAt, lang),
      sort: (a, b) => byStamp(a.updatedAt, b.updatedAt),
    },
  ];
  return (
    <DataGrid
      rows={model.visible}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('preview', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      loading={model.documents.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'updated', direction: 'desc' }}
      empty={
        <Blank
          icon={FileStack}
          searching={shell.search !== ''}
          noun={tr('لا مستندات', 'Aucun document', 'No documents')}
          hint={tr(
            'ارفع ملفًا لبدء المكتبة.',
            'Téléversez un fichier pour démarrer la bibliothèque.',
            'Upload a file to start the library.',
          )}
        />
      }
    />
  );
}

/**
 * The review queue, ordered by how long people have been waiting.
 *
 * The one grid with a `rowTone`: an amber row is a document whose bytes never finalized, which
 * is the single fact a reviewer must know *before* opening it rather than after. Everything
 * else on this tab is a column; that one is the whole row, because approving a document with
 * no bytes approves nothing.
 */
function ReviewGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const { model } = shell;
  const columns: readonly Column<DmsQueueRow>[] = [
    {
      id: 'title',
      header: tr('المستند', 'Document', 'Document'),
      render: (row) => <Stack title={row.title} caption={row.documentNumber} />,
      sort: (a, b) => byText(a.title, b.title),
    },
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      width: 140,
      render: (row) => <Chip text={humanize(row.documentType)} />,
      sort: (a, b) => byText(a.documentType, b.documentType),
    },
    {
      id: 'review',
      header: tr('الحالة', 'État', 'State'),
      width: 132,
      render: (row) => (
        <StateChip value={row.reviewStatus} tones={REVIEW_TONE} labels={REVIEW_LABEL} />
      ),
      sort: (a, b) => byText(a.reviewStatus, b.reviewStatus),
    },
    {
      id: 'confidentiality',
      header: tr('السرية', 'Confidentialité', 'Classification'),
      width: 124,
      render: (row) => (
        <StateChip
          value={row.confidentiality}
          tones={CONFIDENTIALITY_TONE}
          labels={CONFIDENTIALITY_LABEL}
        />
      ),
    },
    {
      id: 'waited',
      header: tr('الانتظار', 'Attente', 'Waiting'),
      width: 104,
      align: 'end',
      title: tr('منذ الإرسال', 'Depuis la soumission', 'Since submission'),
      render: (row) => waited(row.waitingHours, lang),
      sort: (a, b) => byNum(a.waitingHours, b.waitingHours),
    },
    {
      id: 'bytes',
      header: tr('الملف', 'Fichier', 'File'),
      width: 56,
      align: 'center',
      render: (row) => <Verified ok={row.hasVerifiedBytes} />,
    },
    {
      id: 'size',
      header: tr('الحجم', 'Taille', 'Size'),
      width: 88,
      align: 'end',
      render: (row) => size(row.sizeBytes, lang),
      sort: (a, b) => byNum(a.sizeBytes, b.sizeBytes),
    },
    {
      id: 'versions',
      header: tr('نسخ', 'Vers.', 'Vers.'),
      width: 64,
      align: 'end',
      title: tr('عدد النسخ', 'Nombre de versions', 'Version count'),
      render: (row) => int(row.versionCount, lang),
      sort: (a, b) => byNum(a.versionCount, b.versionCount),
    },
    {
      id: 'expiry',
      header: tr('أيام', 'Jours', 'Days'),
      width: 72,
      align: 'end',
      title: tr('أيام حتى الانتهاء', 'Jours avant expiration', 'Days to expiry'),
      render: (row) => <Days days={daysUntil(row.expiresOn)} on={row.expiresOn} />,
      sort: (a, b) => byStamp(a.expiresOn, b.expiresOn),
    },
    {
      id: 'submitted',
      header: tr('أُرسل', 'Soumis', 'Submitted'),
      width: 116,
      render: (row) => ago(row.submittedAt, lang),
      sort: (a, b) => byStamp(a.submittedAt, b.submittedAt),
    },
    {
      id: 'reviewer',
      header: tr('المراجع', 'Réviseur', 'Reviewer'),
      width: 96,
      mono: true,
      title: tr('معرّف المراجع', 'Identifiant du réviseur', 'Reviewer id'),
      render: (row) => actorLabel(row.reviewerId),
    },
  ];
  return (
    <DataGrid
      rows={model.visibleQueue}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('preview', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      rowTone={(row) => (row.hasVerifiedBytes ? undefined : 'warning')}
      loading={model.queue.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'waited', direction: 'desc' }}
      empty={
        <Blank
          icon={Inbox}
          searching={shell.search !== ''}
          noun={tr('الطابور فارغ', 'File vide', 'Queue is empty')}
          hint={tr(
            'لا مستند بانتظار المراجعة الآن.',
            'Aucun document n’attend une revue.',
            'No document is waiting for review.',
          )}
        />
      }
    />
  );
}

/**
 * What lapses, and when — the tab a compliance officer lives in.
 *
 * `rowTone` marks the rows that have already gone past, which the `Days` column also says in
 * colour; the duplication is deliberate, because the row accent survives horizontal scrolling
 * and the column does not. The finer bands — a week out, a month out — stay in the cell.
 *
 * The last column is the one that makes this list actionable: a passport expiring in nine days
 * matters because a pilgrim is attached to it, and a stray scan attached to nothing is noise.
 * Its tokens are `dms_document_links` entity types, so they go through `labelFor` before they
 * reach `TagList` — which translates nothing itself, precisely because only the caller knows
 * whether it is holding SQL tokens or a filer's free text.
 */
function ExpiryGrid({ shell }: Desk) {
  const { t, tr, lang } = useLocale();
  const { model } = shell;
  const columns: readonly Column<DmsExpiryDocument>[] = [
    {
      id: 'title',
      header: tr('المستند', 'Document', 'Document'),
      render: (row) => <Stack title={row.title} caption={row.documentNumber} />,
      sort: (a, b) => byText(a.title, b.title),
    },
    {
      id: 'type',
      header: tr('النوع', 'Type', 'Type'),
      width: 140,
      render: (row) => <Chip text={humanize(row.documentType)} />,
      sort: (a, b) => byText(a.documentType, b.documentType),
    },
    {
      id: 'review',
      header: tr('المراجعة', 'Revue', 'Review'),
      width: 132,
      render: (row) => (
        <StateChip value={row.reviewStatus} tones={REVIEW_TONE} labels={REVIEW_LABEL} />
      ),
    },
    {
      id: 'days',
      header: tr('أيام', 'Jours', 'Days'),
      width: 72,
      align: 'end',
      title: tr('أيام حتى الانتهاء', 'Jours avant expiration', 'Days to expiry'),
      render: (row) => <Days days={row.daysRemaining} on={row.expiresOn} />,
      sort: (a, b) => byNum(a.daysRemaining, b.daysRemaining),
    },
    {
      id: 'expires',
      header: tr('ينتهي', 'Expire le', 'Expires'),
      width: 112,
      render: (row) => fmt.date(row.expiresOn, lang),
      sort: (a, b) => byStamp(a.expiresOn, b.expiresOn),
    },
    {
      id: 'issued',
      header: tr('أُصدر', 'Délivré le', 'Issued'),
      width: 112,
      render: (row) => fmt.date(row.issuedOn, lang),
      sort: (a, b) => byStamp(a.issuedOn, b.issuedOn),
    },
    {
      id: 'notice',
      header: tr('التنبيه', 'Préavis', 'Notice'),
      width: 80,
      align: 'end',
      title: tr(
        'مهلة التنبيه بالأيام',
        'Fenêtre de préavis, en jours',
        'Notice window, in days',
      ),
      render: (row) => int(row.expiryNoticeDays, lang),
      sort: (a, b) => byNum(a.expiryNoticeDays, b.expiryNoticeDays),
    },
    {
      id: 'notified',
      header: tr('أُبلغ', 'Notifié', 'Notified'),
      width: 116,
      render: (row) => ago(row.expiryNotifiedAt, lang),
      sort: (a, b) => byStamp(a.expiryNotifiedAt, b.expiryNotifiedAt),
    },
    {
      id: 'filed',
      header: tr('مرتبط بـ', 'Rattaché à', 'Filed against'),
      width: 180,
      render: (row) => (
        <TagList tags={row.linkedEntityTypes.map((kind) => labelFor(LINK_ENTITY_LABEL, kind, t))} />
      ),
    },
  ];
  return (
    <DataGrid
      rows={model.visibleExpiry}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('preview', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      rowTone={(row) => (row.daysRemaining < 0 ? 'danger' : undefined)}
      loading={model.expiry.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'days', direction: 'asc' }}
      empty={
        <Blank
          icon={CalendarClock}
          searching={shell.search !== ''}
          noun={tr('لا انتهاءات', 'Aucune échéance', 'Nothing expiring')}
          hint={tr(
            'لا مستند ينتهي داخل هذه المدة.',
            'Aucun document n’expire dans cette fenêtre.',
            'No document expires inside this horizon.',
          )}
        />
      }
    />
  );
}

/**
 * How well the extraction engines are actually doing, one row per field.
 *
 * The one grid with no selection, no activation and no context menu, because a row here is a
 * `GROUP BY field_key` aggregate over every job in the window — there is no document behind
 * `passport_number` to open, archive or link. `rowKey` is the field key for the same reason.
 *
 * Corrected and rejected are tinted only when they are non-zero: a column of quiet zeroes with
 * one amber number in it is the shape a reviewer scans for, and colouring a zero would claim a
 * problem that isn't there. The last two columns are both percentages on different scales —
 * `avgConfidence` is the engine's own 0–1 score, `accuracyPct` is accepted-over-reviewed already
 * multiplied out in SQL — which is why one goes through `Confidence` and the other through
 * `pct`, and why the tone lookup divides before it bands.
 */
function ExtractionGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const { model } = shell;
  const columns: readonly Column<DmsQualityField>[] = [
    {
      id: 'field',
      header: tr('الحقل', 'Champ', 'Field'),
      render: (row) => <Stack title={humanize(row.fieldKey)} caption={row.fieldKey} />,
      sort: (a, b) => byText(a.fieldKey, b.fieldKey),
    },
    {
      id: 'extracted',
      header: tr('مستخرج', 'Extraits', 'Extracted'),
      width: 96,
      align: 'end',
      render: (row) => int(row.extracted, lang),
      sort: (a, b) => byNum(a.extracted, b.extracted),
    },
    {
      id: 'accepted',
      header: tr('مقبول', 'Acceptés', 'Accepted'),
      width: 96,
      align: 'end',
      render: (row) => int(row.accepted, lang),
      sort: (a, b) => byNum(a.accepted, b.accepted),
    },
    {
      id: 'corrected',
      header: tr('مصحّح', 'Corrigés', 'Corrected'),
      width: 96,
      align: 'end',
      render: (row) => (
        <Tinted text={int(row.corrected, lang)} tone={row.corrected > 0 ? 'warning' : 'neutral'} />
      ),
      sort: (a, b) => byNum(a.corrected, b.corrected),
    },
    {
      id: 'rejected',
      header: tr('مرفوض', 'Rejetés', 'Rejected'),
      width: 96,
      align: 'end',
      render: (row) => (
        <Tinted text={int(row.rejected, lang)} tone={row.rejected > 0 ? 'danger' : 'neutral'} />
      ),
      sort: (a, b) => byNum(a.rejected, b.rejected),
    },
    {
      id: 'pending',
      header: tr('معلّق', 'En attente', 'Pending'),
      width: 96,
      align: 'end',
      render: (row) => int(row.pending, lang),
      sort: (a, b) => byNum(a.pending, b.pending),
    },
    {
      id: 'confidence',
      header: tr('الثقة', 'Confiance', 'Confidence'),
      width: 104,
      align: 'end',
      title: tr('متوسط ثقة المحرك', 'Confiance moyenne du moteur', 'Mean engine confidence'),
      render: (row) => <Confidence value={row.avgConfidence} />,
      sort: (a, b) => byNum(a.avgConfidence, b.avgConfidence),
    },
    {
      id: 'accuracy',
      header: tr('الدقة', 'Exactitude', 'Accuracy'),
      width: 104,
      align: 'end',
      title: tr(
        'المقبول من المُراجَع',
        'Acceptés parmi les champs revus',
        'Accepted out of reviewed',
      ),
      render: (row) => (
        <Tinted
          text={pct(row.accuracyPct, lang)}
          tone={row.accuracyPct === null ? 'neutral' : confidenceTone(row.accuracyPct / 100)}
        />
      ),
      sort: (a, b) => byNum(a.accuracyPct, b.accuracyPct),
    },
  ];
  return (
    <DataGrid
      rows={model.quality.value?.byField ?? []}
      columns={columns}
      rowKey={(row) => row.fieldKey}
      loading={model.quality.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'extracted', direction: 'desc' }}
      empty={
        <Blank
          icon={ScanLine}
          searching={false}
          noun={tr('لا استخراج', 'Aucune extraction', 'No extraction yet')}
          hint={tr(
            'لم يُشغّل أي محرّك استخراج داخل هذه المدة.',
            'Aucun moteur d’extraction n’a tourné dans cette fenêtre.',
            'No extraction engine has run inside this window.',
          )}
        />
      }
    />
  );
}

/**
 * Evidence packages, and whether their seals still hold.
 *
 * Double-clicking a package re-verifies it rather than previewing it: a package has no bytes of
 * its own, and the question anybody opens this tab to ask is whether the documents inside it are
 * still the ones that were sealed. `package:verify` costs `ledger.read` precisely so that asking
 * is free.
 *
 * `rowTone` tests `sealMatches === false` and not `!row.sealMatches`, because `null` — an open
 * package with nothing sealed yet — is not a broken seal, and painting it red would accuse a
 * clerk of something that hasn't happened. `Seal` makes the same distinction in the cell.
 */
function PackageGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const { model } = shell;
  const columns: readonly Column<DmsPackage>[] = [
    {
      id: 'name',
      header: tr('الحزمة', 'Dossier', 'Package'),
      render: (row) => <Stack title={row.name} caption={row.reference} hint={row.purpose} />,
      sort: (a, b) => byText(a.name, b.name),
    },
    {
      id: 'status',
      header: tr('الحالة', 'État', 'State'),
      width: 124,
      render: (row) => (
        <StateChip value={row.status} tones={PACKAGE_TONE} labels={PACKAGE_LABEL} />
      ),
      sort: (a, b) => byText(a.status, b.status),
    },
    {
      id: 'documents',
      header: tr('مستندات', 'Pièces', 'Documents'),
      width: 96,
      align: 'end',
      render: (row) => int(row.documentCount, lang),
      sort: (a, b) => byNum(a.documentCount, b.documentCount),
    },
    {
      id: 'seal',
      header: tr('الختم', 'Sceau', 'Seal'),
      width: 112,
      render: (row) => <Seal matches={row.sealMatches} drifted={row.driftedDocuments} />,
    },
    {
      id: 'checksum',
      header: tr('البصمة', 'Empreinte', 'Checksum'),
      width: 168,
      render: (row) => <Hash hash={row.sealChecksum} />,
    },
    {
      id: 'sealed',
      header: tr('خُتم', 'Scellé le', 'Sealed'),
      width: 132,
      render: (row) => fmt.dateTime(row.sealedAt, lang),
      sort: (a, b) => byStamp(a.sealedAt, b.sealedAt),
    },
    {
      id: 'sealedBy',
      header: tr('خَتَم', 'Scellé par', 'Sealed by'),
      width: 96,
      mono: true,
      title: tr('معرّف من ختم', 'Identifiant du scelleur', 'Sealer id'),
      render: (row) => actorLabel(row.sealedBy),
    },
    {
      id: 'created',
      header: tr('أُنشئ', 'Créé', 'Created'),
      width: 116,
      render: (row) => ago(row.createdAt, lang),
      sort: (a, b) => byStamp(a.createdAt, b.createdAt),
    },
    {
      id: 'createdBy',
      header: tr('أنشأ', 'Créé par', 'Created by'),
      width: 96,
      mono: true,
      title: tr('معرّف المُنشئ', 'Identifiant du créateur', 'Creator id'),
      render: (row) => actorLabel(row.createdBy),
    },
  ];
  return (
    <DataGrid
      rows={model.visiblePackages}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('package:verify', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      rowTone={(row) => (row.sealMatches === false ? 'danger' : undefined)}
      loading={model.packages.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'created', direction: 'desc' }}
      empty={
        <Blank
          icon={PackageCheck}
          searching={shell.search !== ''}
          noun={tr('لا حزم', 'Aucun dossier', 'No packages')}
          hint={tr(
            'أنشئ حزمة لتجميع المستندات وختمها.',
            'Créez un dossier pour regrouper et sceller des pièces.',
            'Create a package to gather documents and seal them.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The switch
 * ------------------------------------------------------------------ */

export interface DmsListProps {
  readonly shell: DmsShell;
}

/**
 * The active tab's grid, and the file's only export.
 *
 * A switch with all six cases and no `default`, returning a declared `ReactElement | null`: that
 * combination is what makes a seventh entry in `DMS_VIEWS` a typecheck failure here — the end of
 * the function becomes reachable, and `ReactElement | null` does not admit `undefined`. A
 * `default` clause would have swallowed the new tab and rendered nothing, which is the failure
 * mode this app has avoided in `EMPTY_SELECTION`, `VIEW` and `errorOf` for the same reason.
 *
 * `dashboard` returns null because its surface is tiles rather than rows and lives in
 * `dashboard.tsx`; `App.tsx` renders that one instead of this. The case is spelled out anyway
 * rather than left to a `default`, so the exhaustiveness above is real.
 */
export function DmsList({ shell }: DmsListProps): ReactElement | null {
  switch (shell.view) {
    case 'dashboard':
      return null;
    case 'library':
      return <LibraryGrid shell={shell} />;
    case 'review':
      return <ReviewGrid shell={shell} />;
    case 'expiry':
      return <ExpiryGrid shell={shell} />;
    case 'extraction':
      return <ExtractionGrid shell={shell} />;
    case 'packages':
      return <PackageGrid shell={shell} />;
  }
}
