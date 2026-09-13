/**
 * The five grids: the catalog, the dashboards, the reports, the query log and the ledger.
 *
 * One file, because the five tabs are one control in five configurations — same `DataGrid`, same
 * single-selection semantics, same context menu, same empty state, different columns. The cells
 * themselves are in `./cells`, so what is left here is genuinely per-column: which field, how
 * wide, whether it sorts, and what the header says.
 *
 * Rows come off `shell.visible`, not off `model.*.rows`. The search box narrows in the model,
 * over the page the reads returned, because these are RPC projections and there is no `ilike` to
 * push a title search down into. The two ledgers are already windowed server-side, which is why
 * `ledgerWindowed` exists and why the status bar says so — a search over the last two hundred
 * events is a search over the last two hundred events.
 *
 * Sorting is opt-in per column: `DataGrid` makes a column sortable exactly when it carries a
 * comparator, so the ones that get one are the ones an analyst actually reorders a list by — a
 * name, a status, a count, a latency, a stamp. Nulls go to the bottom of an ascending sort
 * rather than into a `NaN` comparator.
 *
 * Two tabs are missing from the switch on purpose. `overview` is six cards and lives in
 * `dashboard.tsx`; `analysis` is a result grid addressed by `BiColumn` rather than by a row
 * shape and lives in `detail.tsx`. Both cases are still spelled out below rather than left to a
 * `default`, so an eighth view added to `BI_VIEWS` fails typecheck here instead of rendering
 * nothing.
 */
import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Database,
  FileBarChart,
  History,
  LayoutDashboard,
  ScrollText,
  SearchX,
} from 'lucide-react';
import { DataGrid, EmptyState, fmt, useLocale, type AppLang, type Column } from '@/platform/sdk';
import { Actor, Chip, Count, Dash, Latency, OpenChip, Stack, StateChip, Tinted } from './cells';
import { DASH } from './format';
import { OUTCOME_LABEL, STATUS_LABEL } from './labels';
import { eventTone, OUTCOME_TONE, readableTone, STATUS_TONE } from './tones';
import type { BiShell } from './shell';
import type { BiDashboard, BiDataset, BiEvent, BiQueryEntry, BiReport } from './types';

/** What every grid needs, which is the whole shell and nothing narrower. */
interface Desk {
  readonly shell: BiShell;
}

/**
 * `DataGrid` speaks sets because it can multi-select. BI speaks one id, because everything
 * downstream of the selection — the inspector, the row commands, the context menu — acts on a
 * single record. The last key wins, which is the row just clicked.
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
  iso === null || iso === '' ? DASH : fmt.relativeTime(iso, lang);

interface BlankProps {
  readonly icon: LucideIcon;
  /** True when the search box is holding text, which changes what "empty" means. */
  readonly searching: boolean;
  /** What the tab would be showing if it had anything. */
  readonly noun: string;
  /** Where the rows come from, so an empty tab says what would fill it. */
  readonly hint: string;
}

/**
 * An empty tab, which is two different facts wearing one component.
 *
 * A catalog with no rows because nobody has defined a dataset needs to say where datasets come
 * from; a catalog with no rows because the search box has `zzz` in it needs to say the search
 * found nothing. Conflating them is how a filtered view gets read as a broken one.
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

/* ------------------------------------------------------------------ *
 * The catalog
 * ------------------------------------------------------------------ */

/**
 * What may be asked about: every dataset defined on this workspace.
 *
 * Two columns here are the ones an analyst reads the tab for. *Fields* is dimensions over
 * metrics, and the metric half is drawn from `publishedMetricCount` when the two disagree —
 * metrics carry their own status, so a published dataset can be mostly draft, and the gap is the
 * interesting number. *Readable* is `readableByMe`, drawn as a word rather than left implicit,
 * because a dataset whose `requiredPermission` this caller lacks returns an empty result set
 * rather than an error, and an analyst deserves to know that before they build on it.
 */
function CatalogGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<BiDataset>[] = [
    {
      id: 'name',
      header: tr('مجموعة البيانات', 'Jeu de données', 'Dataset'),
      render: (row) => (
        <Stack title={row.name} caption={row.key} hint={row.description ?? undefined} mono />
      ),
      sort: (a, b) => byText(a.name, b.name),
    },
    {
      id: 'source',
      header: tr('المصدر', 'Source', 'Source'),
      width: 150,
      render: (row) =>
        row.sourceName === null ? <Dash /> : <Chip text={row.sourceName} title={row.sourceKey ?? undefined} />,
      sort: (a, b) => byText(a.sourceName ?? '', b.sourceName ?? ''),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 116,
      render: (row) => <StateChip value={row.status} tones={STATUS_TONE} labels={STATUS_LABEL} />,
      sort: (a, b) => byText(a.status, b.status),
    },
    {
      id: 'fields',
      header: tr('الحقول', 'Champs', 'Fields'),
      width: 104,
      align: 'end',
      title: tr(
        'الأبعاد ثم المقاييس المنشورة من الإجمالي',
        'Dimensions, puis mesures publiées sur le total',
        'Dimensions, then published metrics of the total',
      ),
      render: (row) => (
        <Stack
          title={`${row.dimensionCount} · ${row.metricCount}`}
          caption={
            row.publishedMetricCount === row.metricCount
              ? null
              : tr(
                  `${row.publishedMetricCount} منشور`,
                  `${row.publishedMetricCount} publiées`,
                  `${row.publishedMetricCount} published`,
                )
          }
        />
      ),
      sort: (a, b) => byNum(a.metricCount, b.metricCount),
    },
    {
      id: 'readable',
      header: tr('القراءة', 'Lecture', 'Readable'),
      width: 104,
      render: (row) => (
        <Chip
          text={row.readableByMe ? tr('متاح', 'Oui', 'Yes') : tr('ممنوع', 'Non', 'No')}
          tone={readableTone(row.readableByMe)}
          title={row.requiredPermission ?? undefined}
        />
      ),
      sort: (a, b) => Number(a.readableByMe) - Number(b.readableByMe),
    },
    {
      id: 'queries',
      header: tr('الاستعلامات', 'Requêtes', 'Queries'),
      width: 96,
      align: 'end',
      render: (row) => <Count value={row.queryCount} zero={false} />,
      sort: (a, b) => byNum(a.queryCount, b.queryCount),
    },
    {
      id: 'lastQueried',
      header: tr('آخر استعلام', 'Dernière requête', 'Last queried'),
      width: 124,
      render: (row) => ago(row.lastQueriedAt, lang),
      sort: (a, b) => byStamp(a.lastQueriedAt, b.lastQueriedAt),
    },
  ];
  return (
    <DataGrid
      rows={shell.visible.datasets}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('edit', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      rowTone={(row) => (row.readableByMe ? undefined : 'warning')}
      loading={shell.model.catalog.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'name', direction: 'asc' }}
      empty={
        <Blank
          icon={Database}
          searching={shell.search !== ''}
          noun={tr('لا مجموعات بيانات', 'Aucun jeu de données', 'No datasets')}
          hint={tr(
            'عرّف مجموعة بيانات فوق مصدر مسجَّل لتبدأ السؤال.',
            'Définissez un jeu de données sur une source enregistrée pour commencer.',
            'Define a dataset over a registered source to start asking questions.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Dashboards
 * ------------------------------------------------------------------ */

/**
 * Saved answers arranged on a grid.
 *
 * `fullyReadableByMe` is false when at least one tile sits on a dataset this caller may not
 * read, and it is drawn here rather than discovered on opening: a board where four tiles render
 * and two say *denied* reads as a broken page, so the list says so first and the row is tinted
 * for it.
 */
function DashboardGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<BiDashboard>[] = [
    {
      id: 'title',
      header: tr('اللوحة', 'Tableau de bord', 'Dashboard'),
      render: (row) => (
        <Stack title={row.title} caption={row.key} hint={row.description ?? undefined} mono />
      ),
      sort: (a, b) => byText(a.title, b.title),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 116,
      render: (row) => <StateChip value={row.status} tones={STATUS_TONE} labels={STATUS_LABEL} />,
      sort: (a, b) => byText(a.status, b.status),
    },
    {
      id: 'tiles',
      header: tr('البلاطات', 'Tuiles', 'Tiles'),
      width: 88,
      align: 'end',
      render: (row) => <Count value={row.tileCount} zero />,
      sort: (a, b) => byNum(a.tileCount, b.tileCount),
    },
    {
      id: 'readable',
      header: tr('القراءة', 'Lecture', 'Readable'),
      width: 112,
      render: (row) =>
        row.fullyReadableByMe ? (
          <Chip text={tr('كاملة', 'Complète', 'Full')} tone="success" />
        ) : (
          <Chip
            text={tr('جزئية', 'Partielle', 'Partial')}
            tone="warning"
            title={tr(
              'بلاطة واحدة على الأقل فوق مجموعة بيانات لا تقرؤها',
              'Au moins une tuile porte sur un jeu de données que vous ne lisez pas',
              'At least one tile sits on a dataset you cannot read',
            )}
          />
        ),
      sort: (a, b) => Number(a.fullyReadableByMe) - Number(b.fullyReadableByMe),
    },
    {
      id: 'default',
      header: tr('الافتراضية', 'Par défaut', 'Default'),
      width: 96,
      render: (row) => (row.isDefault ? <Chip text={tr('نعم', 'Oui', 'Yes')} tone="accent" /> : <Dash />),
      sort: (a, b) => Number(a.isDefault) - Number(b.isDefault),
    },
    {
      id: 'updated',
      header: tr('آخر تعديل', 'Modifié', 'Updated'),
      width: 124,
      render: (row) => ago(row.updatedAt, lang),
      sort: (a, b) => byStamp(a.updatedAt, b.updatedAt),
    },
  ];
  return (
    <DataGrid
      rows={shell.visible.dashboards}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('edit', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      rowTone={(row) => (row.fullyReadableByMe ? undefined : 'warning')}
      loading={shell.model.dashboards.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'title', direction: 'asc' }}
      empty={
        <Blank
          icon={LayoutDashboard}
          searching={shell.search !== ''}
          noun={tr('لا لوحات', 'Aucun tableau de bord', 'No dashboards')}
          hint={tr(
            'احفظ تحليلًا ثم ضعه على لوحة ليقرأه غيرك.',
            'Enregistrez une analyse, puis posez-la sur un tableau de bord.',
            'Save an analysis, then place it on a dashboard for others to read.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/**
 * The same saved answers, bound into a document rather than laid on a grid.
 *
 * A report carries its analyses inline — `BiReport.analyses` is the whole list, not a count —
 * so the column shows how many and the inspector shows which. Nought analyses is drawn rather
 * than dashed: a report with nothing in it is a report somebody started and left, and that is
 * exactly the row worth finding.
 */
function ReportGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<BiReport>[] = [
    {
      id: 'title',
      header: tr('التقرير', 'Rapport', 'Report'),
      render: (row) => (
        <Stack title={row.title} caption={row.key} hint={row.description ?? undefined} mono />
      ),
      sort: (a, b) => byText(a.title, b.title),
    },
    {
      id: 'status',
      header: tr('الحالة', 'Statut', 'Status'),
      width: 116,
      render: (row) => <StateChip value={row.status} tones={STATUS_TONE} labels={STATUS_LABEL} />,
      sort: (a, b) => byText(a.status, b.status),
    },
    {
      id: 'analyses',
      header: tr('التحليلات', 'Analyses', 'Analyses'),
      width: 104,
      align: 'end',
      render: (row) => <Count value={row.analyses.length} tone={row.analyses.length === 0 ? 'warning' : 'neutral'} />,
      sort: (a, b) => byNum(a.analyses.length, b.analyses.length),
    },
    {
      id: 'version',
      header: tr('النسخة', 'Version', 'Version'),
      width: 88,
      align: 'end',
      render: (row) => <Count value={row.version} />,
      sort: (a, b) => byNum(a.version, b.version),
    },
    {
      id: 'published',
      header: tr('النشر', 'Publication', 'Published'),
      width: 124,
      render: (row) => ago(row.publishedAt, lang),
      sort: (a, b) => byStamp(a.publishedAt, b.publishedAt),
    },
    {
      id: 'updated',
      header: tr('آخر تعديل', 'Modifié', 'Updated'),
      width: 124,
      render: (row) => ago(row.updatedAt, lang),
      sort: (a, b) => byStamp(a.updatedAt, b.updatedAt),
    },
  ];
  return (
    <DataGrid
      rows={shell.visible.reports}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('edit', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      loading={shell.model.reports.loading}
      density="compact"
      virtualized
      rowHeight={44}
      initialSort={{ columnId: 'title', direction: 'asc' }}
      empty={
        <Blank
          icon={FileBarChart}
          searching={shell.search !== ''}
          noun={tr('لا تقارير', 'Aucun rapport', 'No reports')}
          hint={tr(
            'التقرير يجمع عدة تحليلات في مستند واحد يُنشر ويُصدَّر.',
            'Un rapport réunit plusieurs analyses dans un document publiable.',
            'A report gathers several analyses into one publishable document.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The query log
 * ------------------------------------------------------------------ */

/**
 * Every query this workspace has run, and what became of it.
 *
 * This is a ledger and not a list of things: there is no edit and no delete, only *what
 * happened*. `isMine` tints nothing and is not a column — the actor cell already says who, and a
 * second marker for *me* would be two answers to one question — but it is why the tab is worth
 * reading at all when a query returned nothing and the analyst wants to know whether the refusal
 * was theirs.
 *
 * Rows fail loudly. An outcome other than success tones the whole row, because the number in the
 * *rows* column of a failed run is null and a reader scanning down that column needs to know why
 * before they read it as a zero.
 */
function QueryGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<BiQueryEntry>[] = [
    {
      id: 'at',
      header: tr('الوقت', 'Heure', 'When'),
      width: 132,
      render: (row) => ago(row.createdAt, lang),
      sort: (a, b) => byStamp(a.createdAt, b.createdAt),
    },
    {
      id: 'target',
      header: tr('الاستعلام', 'Requête', 'Query'),
      render: (row) => (
        <Stack
          title={row.visualizationTitle ?? row.datasetName ?? tr('استعلام حر', 'Requête ad hoc', 'Ad-hoc query')}
          caption={row.datasetKey}
          hint={row.errorMessage ?? undefined}
          mono
        />
      ),
      sort: (a, b) => byText(a.datasetName ?? '', b.datasetName ?? ''),
    },
    {
      id: 'outcome',
      header: tr('النتيجة', 'Issue', 'Outcome'),
      width: 128,
      render: (row) => (
        <StateChip
          value={row.outcome}
          tones={OUTCOME_TONE}
          labels={OUTCOME_LABEL}
          title={row.errorCode ?? undefined}
        />
      ),
      sort: (a, b) => byText(a.outcome, b.outcome),
    },
    {
      id: 'rows',
      header: tr('الصفوف', 'Lignes', 'Rows'),
      width: 88,
      align: 'end',
      render: (row) => <Count value={row.rowCount} />,
      sort: (a, b) => byNum(a.rowCount, b.rowCount),
    },
    {
      id: 'duration',
      header: tr('المدة', 'Durée', 'Duration'),
      width: 96,
      align: 'end',
      render: (row) => <Latency ms={row.durationMs} />,
      sort: (a, b) => byNum(a.durationMs, b.durationMs),
    },
    {
      id: 'actor',
      header: tr('المنفِّذ', 'Exécutant', 'Ran by'),
      width: 132,
      render: (row) => <Actor id={row.actorId} role={row.actorRole} />,
      sort: (a, b) => byText(a.actorRole ?? '', b.actorRole ?? ''),
    },
  ];
  return (
    <DataGrid
      rows={shell.visible.queries}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onActivate={(row) => shell.perform('sql', row)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      rowTone={(row) => (row.outcome === 'OK' ? undefined : OUTCOME_TONE[row.outcome])}
      loading={shell.model.queries.loading}
      density="compact"
      virtualized
      rowHeight={44}
      empty={
        <Blank
          icon={History}
          searching={shell.search !== ''}
          noun={tr('لا استعلامات', 'Aucune requête', 'No queries')}
          hint={tr(
            'كل تشغيل يُسجَّل هنا مع زمنه وعدد صفوفه وسبب رفضه إن رُفض.',
            'Chaque exécution est journalisée ici : durée, lignes, et motif du refus.',
            'Every run is logged here with its duration, its row count and why it was refused.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

/**
 * What was defined, published or deprecated, and by whom.
 *
 * The two token columns go through {@link OpenChip} rather than {@link StateChip}, and that is a
 * decision made two files away: `BiEvent.eventType` has no CHECK constraint behind it and
 * `entityKind` is typed `BiEntityKind | string` because of it, so neither can be looked up in a
 * table the compiler would check. Humanizing the token is the honest rendering — it is what the
 * server wrote, spelled the way a sentence spells it.
 *
 * The status transition is the column the tab exists for. `from → to` with both ends present is
 * a governance act; a null `from` is a first publication; both null is an event that was not
 * about status at all, and the cell says so with a dash rather than an arrow pointing nowhere.
 */
function EventGrid({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<BiEvent>[] = [
    {
      id: 'at',
      header: tr('الوقت', 'Heure', 'When'),
      width: 132,
      render: (row) => ago(row.createdAt, lang),
      sort: (a, b) => byStamp(a.createdAt, b.createdAt),
    },
    {
      id: 'event',
      header: tr('الحدث', 'Événement', 'Event'),
      width: 188,
      render: (row) => <OpenChip token={row.eventType} tone={eventTone(row.to, row.eventType)} />,
      sort: (a, b) => byText(a.eventType, b.eventType),
    },
    {
      id: 'entity',
      header: tr('الكيان', 'Entité', 'Entity'),
      render: (row) => (
        <Stack
          title={row.entityKind === '' ? DASH : row.entityKind}
          caption={row.entityId}
          hint={row.note ?? undefined}
          mono
        />
      ),
      sort: (a, b) => byText(a.entityKind, b.entityKind),
    },
    {
      id: 'transition',
      header: tr('الانتقال', 'Transition', 'Transition'),
      width: 168,
      render: (row) => {
        if (row.to === null) return <Dash />;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {row.from === null ? null : (
              <>
                <Tinted text={row.from} />
                <span style={{ color: 'var(--fx-text-disabled)' }}>→</span>
              </>
            )}
            <StateChip value={row.to} tones={STATUS_TONE} labels={STATUS_LABEL} />
          </span>
        );
      },
      sort: (a, b) => byText(a.to ?? '', b.to ?? ''),
    },
    {
      id: 'actor',
      header: tr('الفاعل', 'Auteur', 'By'),
      width: 132,
      render: (row) => <Actor id={row.actorId} role={row.actorRole} />,
      sort: (a, b) => byText(a.actorRole ?? '', b.actorRole ?? ''),
    },
  ];
  return (
    <DataGrid
      rows={shell.visible.events}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={only(shell.selectedId)}
      onSelectionChange={pick(shell.pickRow)}
      onRowContextMenu={(row, event) => shell.openMenu(event, row)}
      loading={shell.model.events.loading}
      density="compact"
      virtualized
      rowHeight={44}
      empty={
        <Blank
          icon={ScrollText}
          searching={shell.search !== ''}
          noun={tr('لا أحداث', 'Aucun événement', 'No events')}
          hint={tr(
            'يُكتب هنا كل تعريف ونشر وإيقاف، ولا يُحذف منه شيء.',
            'Chaque définition, publication et dépréciation est écrite ici, et rien n’en est retiré.',
            'Every definition, publication and deprecation is written here, and nothing is removed.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The switch
 * ------------------------------------------------------------------ */

export interface BiListProps {
  readonly shell: BiShell;
}

/**
 * The active tab's grid, and the file's only export.
 *
 * A switch with all seven cases and no `default`, returning a declared `ReactElement | null`:
 * that combination is what makes an eighth entry in `BI_VIEWS` a typecheck failure here, because
 * the end of the function becomes reachable and `ReactElement | null` does not admit `undefined`.
 * A `default` clause would have swallowed the new tab and rendered nothing.
 *
 * Two cases return null and both are drawn elsewhere: `overview` is cards, in `overview.tsx`,
 * and `analysis` is the builder and its result grid, in `detail.tsx`. `App.tsx` renders those
 * instead of this.
 */
export function BiList({ shell }: BiListProps): ReactElement | null {
  switch (shell.view) {
    case 'overview':
      return null;
    case 'analysis':
      return null;
    case 'catalog':
      return <CatalogGrid shell={shell} />;
    case 'dashboards':
      return <DashboardGrid shell={shell} />;
    case 'reports':
      return <ReportGrid shell={shell} />;
    case 'queries':
      return <QueryGrid shell={shell} />;
    case 'events':
      return <EventGrid shell={shell} />;
  }
}
