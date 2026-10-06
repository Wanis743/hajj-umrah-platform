/**
 * Journal — the entry grid, the detail pane and the register.
 *
 * The grid is the book: one row per entry, the two totals in a footer, and a red
 * accent on any row whose sides disagree. It sorts and selects; it decides
 * nothing.
 *
 * Under it is the register, which is where an entry stops being a row. It loads
 * the lines on demand — `journalLines` is a separate query, keyed on the selected
 * id, so opening a book of 500 entries does not fetch 3000 lines nobody asked
 * for — and it draws them the way double entry is drawn, debits facing credits
 * with the two totals facing each other at the foot.
 *
 * The pane at the side keeps the header and the two discrepancies: the entry does
 * not balance, or the header does not agree with its own lines. That second check
 * is the one thing in this app nothing else does, and it is the reason the
 * register foots the lines rather than reprinting the header's own pair.
 */
import { AlertTriangle, BookOpen, Scale } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import {
  Badge,
  type Column,
  DataGrid,
  EmptyState,
  InfoBar,
  KpiTile,
  PropertyRow,
  Register,
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
  readonly currency: Currency;
}

/**
 * One entry's header, and what is wrong with it.
 *
 * The verbs are not here. They are in the ribbon, where the four of them sit in a
 * labelled group with the entry's own reference beside them — a button that posts
 * the books should be in the one place the window keeps its commands, not repeated
 * in a side pane where a second copy can disagree with the first about whether it
 * is allowed. What stays here is the header, and the two warnings that are the
 * reason anybody reads a pane rather than a row: the entry does not balance, or
 * the header does not agree with its own lines.
 */
export function EntryDetail({ entry, lines, currency }: EntryDetailProps) {
  const { t, tr, lang } = useApp().locale;
  const sums = lineTotals(lines);
  const agrees = headerMatchesLines(entry, lines);
  const balanced = isBalanced(entry);

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
    </div>
  );
}

export interface EntryRegisterProps {
  readonly entry: JournalEntry | null;
  readonly lines: readonly JournalLine[];
  readonly loading: boolean;
  readonly labelOf: (accountId: string | null) => string;
  readonly currency: Currency;
}

/**
 * The selected entry's lines, as the double-entry register they are.
 *
 * This used to be a stacked list in a 324-pixel gutter, and the comment above it
 * said why: a pane that narrow is no place for a table. The answer was not a
 * better list — it was to stop putting the lines in the gutter. Debits and credits
 * face each other in facing columns because that is what double entry *is*, and
 * the two totals facing each other at the foot are how a person checks the one
 * fact that decides whether the entry can be posted at all.
 *
 * It is a real `<table>` with column headers and a footer, not a virtualised grid.
 * `DataGrid` is the right instrument for ten thousand rows and the wrong one for
 * four that have to add up: a screen reader on this register says "Cash, debit,
 * 4,500" instead of reading four unrelated cells.
 *
 * The totals come from the lines and not from the header. The header carries its
 * own pair, and when the two disagree the pane above says so — a register that
 * footed the header's figures would be hiding exactly the discrepancy it exists
 * to reveal.
 */
export function EntryRegister({ entry, lines, loading, labelOf, currency }: EntryRegisterProps) {
  const { tr, lang } = useApp().locale;
  const money = (value: number) => fmt.money(value, currency, lang);

  if (entry === null) {
    return (
      <EmptyState
        icon={BookOpen}
        title={tr('لا قيد محدّد', 'Aucune écriture sélectionnée', 'No entry selected')}
        description={tr(
          'اختر قيدًا من الدفتر أعلاه لقراءة سطوره.',
          'Choisissez une écriture dans le livre ci-dessus pour en lire les lignes.',
          'Pick an entry from the book above to read its lines.',
        )}
      />
    );
  }

  if (loading && lines.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Spinner size={14} />
        <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
          {tr('تحميل السطور…', 'Chargement des lignes…', 'Loading lines…')}
        </span>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title={tr('لا سطور', 'Aucune ligne', 'No lines')}
        description={tr(
          'لا سطور محمّلة لهذا القيد.',
          'Aucune ligne chargée pour cette écriture.',
          'No lines are loaded for this entry.',
        )}
      />
    );
  }

  const sums = lineTotals(lines);
  const difference = sums.debit - sums.credit;
  return (
    <div className="fx-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Register
        label={tr('سطور القيد', 'Lignes de l’écriture', 'Entry lines')}
        lines={lines.map((line) => ({
          id: line.id,
          account: labelOf(line.accountId),
          memo: line.memo === '' ? undefined : line.memo,
          debit: line.debit === 0 ? undefined : money(line.debit),
          credit: line.credit === 0 ? undefined : money(line.credit),
        }))}
        totals={{
          debit: money(sums.debit),
          credit: money(sums.credit),
          balanced: Math.abs(difference) < 0.005,
          difference: Math.abs(difference) < 0.005 ? undefined : money(difference),
        }}
      />
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
