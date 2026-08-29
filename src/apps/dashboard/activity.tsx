/**
 * Dashboard — the activity page.
 *
 * The one page whose range control does something: `journal_entries` carries
 * `entry_date`, so a window over it means something, and every figure here is counted
 * inside it. The status bar's "entries in range" is this page's headline.
 *
 * The audit trail underneath is the other half of the story. The counts say what the
 * book looks like; the trail says who did it and why — `details.reason` is where an
 * approval note or a void reason lands, and it is printed verbatim rather than
 * summarised, because a reason somebody typed is evidence.
 */
import type { CSSProperties } from 'react';
import { ArrowRight, Clock, History, ShieldAlert, Sigma } from 'lucide-react';
import {
  Badge,
  BarChart,
  type BarDatum,
  Button,
  Card,
  type Column,
  DataGrid,
  EmptyState,
  fmt,
  KpiTile,
  toneColor,
  useApp,
} from '@/platform/sdk';
import { ENTRY_STATUS_LABEL, ENTRY_STATUSES, entryTone, type JournalEntry } from '../shared/ledger';
import {
  type Destination,
  type FeedRow,
  feedTone,
  type Formatters,
  type Snapshot,
  TO_APPROVALS,
  TO_DRAFTS,
  TO_POSTED,
} from './metrics';

const PAGE: CSSProperties = { display: 'grid', gap: 16, alignContent: 'start' };
const KPI_GRID: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(212px, 1fr))',
};
const CARD_GRID: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
};

/** How many rows the two lists show before deferring to Journal and Event Viewer. */
const GRID_ROWS = 14;
const FEED_ROWS = 12;

export interface ActivityPageProps {
  readonly snap: Snapshot;
  readonly f: Formatters;
  /** The audit trail, newest first. It comes from the model, not the snapshot. */
  readonly feed: readonly FeedRow[];
  onOpen: (destination: Destination) => void;
}

/** Four counts of the window, the two pictures of it, then the two lists. */
export function ActivityPage({ snap, f, feed, onOpen }: ActivityPageProps) {
  const { tr, lang } = useApp().locale;
  const a = snap.activity;
  const waiting = a.waiting.length;
  const broken = a.unbalanced.length;
  return (
    <div style={PAGE}>
      <div style={KPI_GRID}>
        <KpiTile
          label={tr('قيود', 'Écritures', 'Entries')}
          value={f.integer(a.total)}
          secondary={
            a.firstDate === null
              ? tr('لا شيء في النطاق', 'Rien dans la portée', 'Nothing in the window')
              : `${fmt.date(a.firstDate, lang)} → ${fmt.date(a.lastDate ?? a.firstDate, lang)}`
          }
          icon={History}
          onClick={() => onOpen(TO_POSTED)}
        />
        <KpiTile
          label={tr('المعتمد', 'Comptabilisé', 'Posted value')}
          value={f.money(a.value)}
          secondary={tr(
            `${f.integer(a.byStatus.posted)} قيد معتمد`,
            `${f.integer(a.byStatus.posted)} écritures comptabilisées`,
            `${f.integer(a.byStatus.posted)} posted entries`,
          )}
          icon={Sigma}
        />
        <KpiTile
          label={tr('في الانتظار', 'En attente', 'Waiting')}
          value={f.integer(waiting)}
          secondary={tr(
            `${f.integer(a.byStatus.draft)} مسودة · ${f.integer(a.byStatus.pending)} قيد الاعتماد`,
            `${f.integer(a.byStatus.draft)} brouillons · ${f.integer(a.byStatus.pending)} à approuver`,
            `${f.integer(a.byStatus.draft)} draft · ${f.integer(a.byStatus.pending)} pending`,
          )}
          icon={Clock}
          tone={waiting === 0 ? 'success' : 'warning'}
          onClick={() => onOpen(TO_APPROVALS)}
        />
        <UnbalancedTile count={broken} f={f} onOpen={onOpen} />
      </div>
      <ActivityCharts snap={snap} f={f} />
      <EntryTableCard snap={snap} f={f} onOpen={onOpen} />
      <FeedCard feed={feed} />
    </div>
  );
}

interface UnbalancedTileProps {
  readonly count: number;
  readonly f: Formatters;
  onOpen: (destination: Destination) => void;
}

/**
 * Entries whose two sides disagree.
 *
 * This is the tile that earns the page. The database trigger refuses to post an entry
 * whose debits and credits differ, so a book with three of these has three entries that
 * will fail at the worst possible moment — and nothing else in the suite counts them
 * on one screen. Zero is drawn green rather than hidden, because "none" is the answer
 * a person came here for.
 */
function UnbalancedTile({ count, f, onOpen }: UnbalancedTileProps) {
  const { tr } = useApp().locale;
  const clean = count === 0;
  return (
    <KpiTile
      label={tr('غير متوازنة', 'Déséquilibrées', 'Unbalanced')}
      value={f.integer(count)}
      secondary={
        clean
          ? tr('كل قيد يتوازن', 'Chaque écriture s’équilibre', 'Every entry adds up')
          : tr('سيرفضها الترحيل', 'Le report les refusera', 'Posting will refuse them')
      }
      icon={ShieldAlert}
      tone={clean ? 'success' : 'danger'}
      onClick={clean ? undefined : () => onOpen(TO_DRAFTS)}
    />
  );
}

interface ChartsProps {
  readonly snap: Snapshot;
  readonly f: Formatters;
}

/**
 * The window in two pictures: value over time, and where the entries stand.
 *
 * The monthly bars are the *debit* total of posted entries, which is the only sum of a
 * journal that means anything — credits are the same figure by construction, and adding
 * both would double the book. Drafts contribute nothing to it, on purpose: money that
 * is not posted is not in the books.
 */
function ActivityCharts({ snap, f }: ChartsProps) {
  const { t, tr } = useApp().locale;
  const a = snap.activity;
  const months: readonly BarDatum[] = a.months.map((point) => ({ label: point.label, value: point.value }));
  const statuses: readonly BarDatum[] = ENTRY_STATUSES.map((status) => ({
    label: t(ENTRY_STATUS_LABEL[status]),
    value: a.byStatus[status],
    color: toneColor(entryTone(status)),
  }));
  return (
    <div style={CARD_GRID}>
      <Card
        title={tr('المعتمد بالشهر', 'Comptabilisé par mois', 'Posted value by month')}
        subtitle={tr('مجموع المدين', 'Total au débit', 'Debit total')}
        icon={Sigma}
      >
        {a.months.length === 0 ? (
          <EmptyState
            compact
            icon={Sigma}
            title={tr('لا قيود', 'Aucune écriture', 'No entries')}
            description={tr(
              'لا قيد داخل هذا النطاق.',
              'Aucune écriture dans cette portée.',
              'No entry falls inside this window.',
            )}
          />
        ) : (
          <BarChart data={months} height={200} format={f.money} />
        )}
      </Card>
      <Card
        title={tr('بالحالة', 'Par état', 'By status')}
        subtitle={tr('قيود النطاق', 'Écritures de la portée', 'Entries in the window')}
        icon={History}
      >
        <BarChart data={statuses} orientation="horizontal" height={200} format={f.integer} />
      </Card>
    </div>
  );
}

interface EntryTableProps {
  readonly snap: Snapshot;
  readonly f: Formatters;
  onOpen: (destination: Destination) => void;
}

/** The newest entries of the window. Double-click lands on them in the journal. */
function EntryTableCard({ snap, f, onOpen }: EntryTableProps) {
  const { t, tr, lang } = useApp().locale;
  const rows = snap.activity.recent.slice(0, GRID_ROWS);
  const columns: readonly Column<JournalEntry>[] = [
    {
      id: 'reference',
      header: tr('المرجع', 'Référence', 'Reference'),
      width: 132,
      mono: true,
      render: (row) => row.reference,
      sort: (a, b) => a.reference.localeCompare(b.reference),
    },
    {
      id: 'date',
      header: tr('التاريخ', 'Date', 'Date'),
      width: 108,
      render: (row) => fmt.date(row.date, lang),
      sort: (a, b) => a.date.localeCompare(b.date),
    },
    {
      id: 'description',
      header: tr('البيان', 'Libellé', 'Description'),
      render: (row) => row.description,
    },
    {
      id: 'status',
      header: tr('الحالة', 'État', 'Status'),
      width: 118,
      render: (row) => <Badge tone={entryTone(row.status)}>{t(ENTRY_STATUS_LABEL[row.status])}</Badge>,
    },
    {
      id: 'debit',
      header: tr('مدين', 'Débit', 'Debit'),
      width: 140,
      align: 'end',
      mono: true,
      render: (row) => f.money(row.debit),
      sort: (a, b) => a.debit - b.debit,
    },
  ];
  return <EntryCard rows={rows} columns={columns} onOpen={onOpen} />;
}

interface EntryCardProps {
  readonly rows: readonly JournalEntry[];
  readonly columns: readonly Column<JournalEntry>[];
  onOpen: (destination: Destination) => void;
}

/** The shell around the entry grid, split out so neither half runs long. */
function EntryCard({ rows, columns, onOpen }: EntryCardProps) {
  const { t, tr } = useApp().locale;
  return (
    <Card
      title={tr('أحدث القيود', 'Écritures récentes', 'Recent entries')}
      subtitle={tr(
        `أحدث ${GRID_ROWS} قيدًا في النطاق`,
        `Les ${GRID_ROWS} dernières écritures de la portée`,
        `The newest ${GRID_ROWS} in the window`,
      )}
      icon={History}
      actions={
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_POSTED)}>
          {t(TO_POSTED.label)}
        </Button>
      }
      padded={false}
    >
      {rows.length === 0 ? (
        <div style={{ padding: 14 }}>
          <EmptyState
            compact
            icon={History}
            title={tr('لا قيود', 'Aucune écriture', 'No entries')}
            description={tr(
              'لا قيد داخل هذا النطاق. جرّب نطاقًا أوسع.',
              'Aucune écriture dans cette portée. Essayez une portée plus large.',
              'No entry falls inside this window. Try a wider range.',
            )}
          />
        </div>
      ) : (
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          density="compact"
          onActivate={(row) => onOpen(row.status === 'posted' ? TO_POSTED : TO_DRAFTS)}
        />
      )}
    </Card>
  );
}

interface FeedCardProps {
  readonly feed: readonly FeedRow[];
}

/**
 * Who did what, in the words the server wrote.
 *
 * The action code is printed verbatim rather than translated into a friendly verb. Every
 * RPC in the schema writes its own string into `audit_logs.action`, so a lookup table
 * here would go stale the day somebody adds one, and a row reading "unknown" is worse
 * than a row reading `LEDGER_POST_ENTRY`. The colour carries the meaning instead.
 */
function FeedCard({ feed }: FeedCardProps) {
  const { tr, lang } = useApp().locale;
  const rows = feed.slice(0, FEED_ROWS);
  const hidden = feed.length - FEED_ROWS;
  return (
    <Card
      title={tr('من فعل ماذا', 'Qui a fait quoi', 'Who did what')}
      subtitle={tr('سجل التدقيق، الأحدث أولًا', 'Journal d’audit, du plus récent', 'The audit trail, newest first')}
      icon={Clock}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Clock}
          title={tr('لا سجل', 'Aucune trace', 'Nothing recorded')}
          description={tr(
            'لم يكتب سجل التدقيق شيئًا بعد.',
            'Le journal d’audit est vide.',
            'The audit trail has nothing in it yet.',
          )}
        />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <FeedLine key={row.id} row={row} />
          ))}
          {hidden <= 0 ? null : (
            <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
              {tr(
                `و${fmt.integer(hidden, lang)} حدثًا آخر`,
                `et ${fmt.integer(hidden, lang)} autres événements`,
                `and ${fmt.integer(hidden, lang)} more events`,
              )}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

/** One audit line: what happened, to what, by whom, when, and why. */
function FeedLine({ row }: { readonly row: FeedRow }) {
  const { lang } = useApp().locale;
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Badge tone={feedTone(row.action)}>{row.action}</Badge>
        <span
          className="fx-mono"
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-secondary)',
          }}
          title={row.resourceId === null ? row.resource : `${row.resource} · ${row.resourceId}`}
        >
          {row.resource}
        </span>
        <span
          style={{
            marginInlineStart: 'auto',
            whiteSpace: 'nowrap',
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-tertiary)',
          }}
          title={fmt.dateTime(row.at, lang)}
        >
          {fmt.relativeTime(row.at, lang)}
        </span>
      </div>
      <div
        style={{
          fontSize: 'var(--fx-caption)',
          color: 'var(--fx-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={row.reason ?? row.who}
      >
        {row.who}
        {row.reason === null ? '' : ` · ${row.reason}`}
      </div>
    </div>
  );
}
