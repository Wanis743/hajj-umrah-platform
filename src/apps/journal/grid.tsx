/**
 * Journal — the entry grid and the detail pane.
 *
 * The grid is the book: one row per entry, the two totals in a footer, and a red
 * accent on any row whose sides disagree. It sorts and selects; it decides
 * nothing.
 *
 * The pane beside it is where an entry stops being a row. It loads the lines on
 * demand — `journalLines` is a separate query, keyed on the selected id, so
 * opening a book of 500 entries does not fetch 3000 lines nobody asked for — and
 * it is the one place in the app that checks the header against its own detail.
 */
import { AlertTriangle, ClipboardCopy, Copy, Scale, Send, Undo2 } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import {
  Badge,
  Button,
  type Column,
  DataGrid,
  EmptyState,
  InfoBar,
  KpiTile,
  PropertyRow,
  Sparkline,
  Spinner,
  fmt,
  useApp,
} from '@/platform/sdk';
import {
  type Currency,
  ENTRY_STATUS_LABEL,
  type JournalEntry,
  type JournalLine,
  entryTone,
  isBalanced,
} from '../shared/ledger';
import type { JournalBusy } from './actions';
import { type Tally, headerMatchesLines, lineTotals, totalsOf, volumeByDay } from './entries';

const ROW_HEIGHT = 33;

/** One empty set, so "nothing selected" is not a new object every render. */
const NO_SELECTION: ReadonlySet<string> = new Set<string>();

export interface EntryGridProps {
  readonly entries: readonly JournalEntry[];
  readonly loading: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onActivate: (entry: JournalEntry) => void;
  readonly onContextMenu: (entry: JournalEntry, event: MouseEvent) => void;
  readonly filtered: boolean;
}

/**
 * The entry list.
 *
 * Amounts are `fmt.amount` and not `fmt.money`: seven currency symbols down a
 * column of numbers is noise, and the currency is stated once in the status bar
 * where it belongs. Zero is drawn as an em dash — a column of `0,00` beside the
 * numbers that matter is a column you have to read twice.
 */
export function EntryGrid({
  entries,
  loading,
  selectedId,
  onSelect,
  onActivate,
  onContextMenu,
  filtered,
}: EntryGridProps) {
  const { t, tr, lang } = useApp().locale;
  const totals = useMemo(() => totalsOf(entries), [entries]);
  const selected = useMemo(
    () => (selectedId === null ? NO_SELECTION : new Set([selectedId])),
    [selectedId],
  );

  const columns = useMemo<readonly Column<JournalEntry>[]>(
    () => [
      {
        id: 'date',
        header: tr('التاريخ', 'Date', 'Date'),
        width: 104,
        render: (entry) => fmt.date(entry.date, lang),
        sort: (a, b) => a.date.localeCompare(b.date),
      },
      {
        id: 'reference',
        header: tr('المرجع', 'Référence', 'Reference'),
        width: 138,
        mono: true,
        render: (entry) => (entry.reference === '' ? '—' : entry.reference),
        sort: (a, b) => a.reference.localeCompare(b.reference),
      },
      {
        id: 'description',
        header: tr('الوصف', 'Libellé', 'Description'),
        render: (entry) => (entry.description === '' ? '—' : entry.description),
        sort: (a, b) => a.description.localeCompare(b.description),
      },
      {
        id: 'status',
        header: tr('الحالة', 'État', 'Status'),
        width: 132,
        render: (entry) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Badge tone={entryTone(entry.status)}>{t(ENTRY_STATUS_LABEL[entry.status])}</Badge>
            {isBalanced(entry) ? null : (
              <Scale
                size={12}
                style={{ color: 'var(--fx-danger)' }}
                aria-label={tr('غير متوازن', 'Déséquilibré', 'Unbalanced')}
              />
            )}
          </span>
        ),
        sort: (a, b) => a.status.localeCompare(b.status),
      },
      {
        id: 'source',
        header: tr('المصدر', 'Origine', 'Source'),
        width: 128,
        render: (entry) => (entry.sourceType === '' ? '—' : entry.sourceType),
        sort: (a, b) => a.sourceType.localeCompare(b.sourceType),
      },
      {
        id: 'debit',
        header: tr('مدين', 'Débit', 'Debit'),
        width: 132,
        align: 'end',
        mono: true,
        render: (entry) => (entry.debit === 0 ? '—' : fmt.amount(entry.debit, lang)),
        sort: (a, b) => a.debit - b.debit,
        footer: fmt.amount(totals.debit, lang),
      },
      {
        id: 'credit',
        header: tr('دائن', 'Crédit', 'Credit'),
        width: 132,
        align: 'end',
        mono: true,
        render: (entry) => (entry.credit === 0 ? '—' : fmt.amount(entry.credit, lang)),
        sort: (a, b) => a.credit - b.credit,
        footer: fmt.amount(totals.credit, lang),
      },
    ],
    [t, tr, lang, totals],
  );

  return (
    <DataGrid<JournalEntry>
      rows={entries}
      columns={columns}
      rowKey={(entry) => entry.id}
      selectedKeys={selected}
      onSelectionChange={(keys) => {
        const [first] = [...keys];
        onSelect(first ?? null);
      }}
      onActivate={onActivate}
      onRowContextMenu={onContextMenu}
      loading={loading}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      showFooter
      initialSort={{ columnId: 'date', direction: 'desc' }}
      rowTone={(entry) => (isBalanced(entry) ? undefined : 'danger')}
      empty={
        <EmptyState
          title={
            filtered
              ? tr('لا قيود مطابقة', 'Aucune écriture correspondante', 'No matching entries')
              : tr('لا قيود بعد', 'Aucune écriture', 'No entries yet')
          }
          description={
            filtered
              ? tr(
                  'وسّع التواريخ أو امسح المرشّحات.',
                  'Élargissez les dates ou effacez les filtres.',
                  'Widen the dates, or clear the filters.',
                )
              : tr(
                  'ابدأ بقيد جديد (Ctrl+N).',
                  'Commencez par une nouvelle écriture (Ctrl+N).',
                  'Start with a new entry (Ctrl+N).',
                )
          }
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Detail pane
 * ------------------------------------------------------------------ */

export interface EntryDetailProps {
  readonly entry: JournalEntry;
  readonly lines: readonly JournalLine[];
  readonly loading: boolean;
  readonly labelOf: (accountId: string | null) => string;
  readonly currency: Currency;
  readonly busy: JournalBusy;
  readonly onPost: () => void;
  readonly onVoid: () => void;
  readonly onDuplicate: () => void;
  readonly onCopy: () => void;
}

/**
 * One entry, its lines, and what can still be done to it.
 *
 * Post carries no confirmation of its own. `ledger.post` is privileged, so the
 * kernel raises consent before the RPC runs; a second dialog in front of it would
 * only train the reflex that clicks through both.
 */
export function EntryDetail({
  entry,
  lines,
  loading,
  labelOf,
  currency,
  busy,
  onPost,
  onVoid,
  onDuplicate,
  onCopy,
}: EntryDetailProps) {
  const { t, tr, lang } = useApp().locale;
  const sums = lineTotals(lines);
  const agrees = headerMatchesLines(entry, lines);
  const balanced = isBalanced(entry);
  const canPost = entry.status !== 'posted' && entry.status !== 'void' && balanced;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span className="fx-mono fx-title-ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
          {entry.reference === '' ? fmt.date(entry.date, lang) : entry.reference}
        </span>
        <Badge tone={entryTone(entry.status)}>{t(ENTRY_STATUS_LABEL[entry.status])}</Badge>
      </div>

      {balanced ? null : (
        <InfoBar tone="danger" icon={Scale} title={tr('قيد غير متوازن', 'Écriture déséquilibrée', 'Unbalanced entry')}>
          {tr(
            `الفرق ${fmt.money(entry.debit - entry.credit, currency, lang)}. الترحيل سيُرفض.`,
            `Écart de ${fmt.money(entry.debit - entry.credit, currency, lang)}. La comptabilisation sera refusée.`,
            `Off by ${fmt.money(entry.debit - entry.credit, currency, lang)}. Posting would be refused.`,
          )}
        </InfoBar>
      )}
      {agrees ? null : (
        <InfoBar
          tone="warning"
          icon={AlertTriangle}
          title={tr('الإجماليات لا تطابق السطور', 'Totaux et lignes divergent', 'Totals disagree with the lines')}
        >
          {tr(
            `الرأس ${fmt.amount(entry.debit, lang)} والسطور ${fmt.amount(sums.debit, lang)}.`,
            `En-tête ${fmt.amount(entry.debit, lang)}, lignes ${fmt.amount(sums.debit, lang)}.`,
            `Header ${fmt.amount(entry.debit, lang)}, lines ${fmt.amount(sums.debit, lang)}.`,
          )}
        </InfoBar>
      )}

      <div>
        <PropertyRow label={tr('التاريخ', 'Date', 'Date')}>{fmt.date(entry.date, lang)}</PropertyRow>
        <PropertyRow label={tr('الوصف', 'Libellé', 'Description')}>
          {entry.description === '' ? '—' : entry.description}
        </PropertyRow>
        <PropertyRow label={tr('المصدر', 'Origine', 'Source')} mono>
          {entry.sourceType === '' ? '—' : entry.sourceType}
        </PropertyRow>
        <PropertyRow label={tr('مدين', 'Débit', 'Debit')} mono>
          {fmt.money(entry.debit, currency, lang)}
        </PropertyRow>
        <PropertyRow label={tr('دائن', 'Crédit', 'Credit')} mono>
          {fmt.money(entry.credit, currency, lang)}
        </PropertyRow>
        {entry.postedAt === null ? null : (
          <PropertyRow label={tr('تاريخ الترحيل', 'Comptabilisée le', 'Posted')}>
            {fmt.dateTime(entry.postedAt, lang)}
          </PropertyRow>
        )}
      </div>

      <EntryLines lines={lines} loading={loading} labelOf={labelOf} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Button
          size="sm"
          variant="accent"
          icon={Send}
          busy={busy === 'post'}
          disabled={!canPost}
          onClick={onPost}
          title={
            canPost
              ? undefined
              : balanced
                ? tr('القيد ليس مسودة.', 'L’écriture n’est pas un brouillon.', 'The entry is not a draft.')
                : tr('القيد غير متوازن.', 'L’écriture est déséquilibrée.', 'The entry does not balance.')
          }
        >
          {tr('ترحيل', 'Comptabiliser', 'Post')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={Undo2}
          busy={busy === 'void'}
          disabled={entry.status === 'void' || entry.status === 'draft'}
          onClick={onVoid}
        >
          {tr('إلغاء', 'Annuler', 'Void')}
        </Button>
        <Button
          size="sm"
          icon={Copy}
          disabled={lines.length === 0}
          onClick={onDuplicate}
          title={
            lines.length === 0
              ? tr(
                  'السطور لم تُحمّل بعد.',
                  'Les lignes ne sont pas encore chargées.',
                  'The lines have not loaded yet.',
                )
              : undefined
          }
        >
          {tr('تكرار', 'Dupliquer', 'Duplicate')}
        </Button>
        <Button size="sm" variant="subtle" icon={ClipboardCopy} onClick={onCopy}>
          {tr('نسخ', 'Copier', 'Copy')}
        </Button>
      </div>
    </div>
  );
}

interface EntryLinesProps {
  readonly lines: readonly JournalLine[];
  readonly loading: boolean;
  readonly labelOf: (accountId: string | null) => string;
}

/**
 * The lines, as a list rather than a grid.
 *
 * A 300px pane is too narrow for a sortable table, and the account label is the
 * long value: it gets its own row, with the amount beside it and the memo under.
 */
function EntryLines({ lines, loading, labelOf }: EntryLinesProps) {
  const { tr, lang } = useApp().locale;
  if (loading && lines.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
        <Spinner size={14} />
        <span style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}>
          {tr('تحميل السطور…', 'Chargement des lignes…', 'Loading lines…')}
        </span>
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fx-text-secondary)', padding: '8px 0' }}>
        {tr('لا سطور محمّلة.', 'Aucune ligne chargée.', 'No lines loaded.')}
      </div>
    );
  }
  return (
    <div className="fx-scroll" style={{ flex: 1, minHeight: 96, overflowY: 'auto' }}>
      {lines.map((line) => (
        <div
          key={line.id}
          style={{
            padding: '6px 0',
            borderBottom: '1px solid var(--fx-stroke)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="fx-title-ellipsis" style={{ flex: 1, fontSize: 12 }}>
              {labelOf(line.accountId)}
            </span>
            <span className="fx-mono fx-num" style={{ fontSize: 12 }}>
              {line.debit === 0 ? '' : fmt.amount(line.debit, lang)}
            </span>
            <span className="fx-mono fx-num" style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}>
              {line.credit === 0 ? '' : fmt.amount(line.credit, lang)}
            </span>
          </div>
          {line.memo === '' ? null : (
            <span style={{ fontSize: 11, color: 'var(--fx-text-secondary)' }}>{line.memo}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

export interface EntryOverviewProps {
  readonly entries: readonly JournalEntry[];
  readonly tally: Tally;
  readonly currency: Currency;
  readonly today: string;
}

const VOLUME_DAYS = 30;

/**
 * What the aside shows when no entry is selected.
 *
 * The four numbers are the ones a person opens this app to see, and the sparkline
 * is thirty days of entry volume — enough to notice that Thursday was quiet, which
 * is usually the first sign that something upstream stopped posting.
 */
export function EntryOverview({ entries, tally, currency, today }: EntryOverviewProps) {
  const { tr, lang } = useApp().locale;
  const volume = useMemo(() => volumeByDay(entries, today, VOLUME_DAYS), [entries, today]);
  const busiest = Math.max(...volume, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <KpiTile
          label={tr('قيود معروضة', 'Écritures', 'Entries')}
          value={fmt.integer(tally.counts.all, lang)}
          secondary={fmt.money(tally.debit, currency, lang)}
        />
        <KpiTile
          label={tr('مسودات', 'Brouillons', 'Drafts')}
          value={fmt.integer(tally.counts.draft, lang)}
          tone={tally.counts.draft === 0 ? 'neutral' : 'warning'}
        />
        <KpiTile
          label={tr('قيد الموافقة', 'En attente', 'Pending')}
          value={fmt.integer(tally.counts.pending, lang)}
          tone={tally.counts.pending === 0 ? 'neutral' : 'accent'}
        />
        <KpiTile
          label={tr('غير متوازنة', 'Déséquilibrées', 'Unbalanced')}
          value={fmt.integer(tally.unbalanced, lang)}
          tone={tally.unbalanced === 0 ? 'success' : 'danger'}
          icon={Scale}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--fx-text-secondary)', marginBottom: 4 }}>
          {tr(
            `الحجم اليومي · ${String(VOLUME_DAYS)} يومًا`,
            `Volume quotidien · ${String(VOLUME_DAYS)} jours`,
            `Daily volume · ${String(VOLUME_DAYS)} days`,
          )}
        </div>
        <Sparkline values={volume} width={288} height={44} filled />
        <div style={{ fontSize: 11, color: 'var(--fx-text-secondary)', marginTop: 2 }}>
          {tr(
            `الذروة ${fmt.integer(busiest, lang)} في اليوم`,
            `Pointe à ${fmt.integer(busiest, lang)} par jour`,
            `Peak ${fmt.integer(busiest, lang)} in a day`,
          )}
        </div>
      </div>

      <span style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}>
        {tr(
          'اختر قيدًا لعرض سطوره وترحيله.',
          'Sélectionnez une écriture pour voir ses lignes.',
          'Select an entry to see its lines and post it.',
        )}
      </span>
    </div>
  );
}
