/**
 * The pipeline, as a board.
 *
 * Six of the seven CRM surfaces are registers — a list of leads, a list of quotes — and a
 * grid is the right shape for a register. The pipeline is not a register. A deal's stage is
 * not a column you read, it is a *place the deal is*, and the question a salesperson opens
 * this tab to answer is "what is sitting in negotiation" rather than "sort by weighted
 * value". So this one surface is a board: the stages are the columns, every deal is a card
 * in one of them, and moving a deal is moving its card.
 *
 * All six stages are drawn, including the two terminal ones. A board that hid WON and LOST
 * would be a board that lost half of the quarter's history the moment a deal closed, and
 * the two columns are also the only honest place to read a win rate off. What it means is
 * that most drops are illegal — `STAGE_TRANSITIONS` allows three or four moves out of any
 * stage, and nothing at all into WON, because a deal is won by accepting its quote — so the
 * refusal is a normal outcome and `shell.moveStage` says so in a toast rather than letting
 * the card spring back in silence.
 *
 * The funnel band stays above the board even though a board already reads across the stages,
 * because the two are not measuring the same thing: the band comes from `crm_pipeline`, which
 * aggregates every open deal on the server, and the columns hold only the rows this window
 * actually loaded and the search actually left. Dropping the band would quietly turn a page
 * cap into a pipeline total.
 *
 * Nothing here reads or writes. The cards come from `model.visible.opportunities`, the moves
 * go out through the one callback, and the empty state is the same two-branch rule every grid
 * in `list.tsx` keeps: a search that matched nothing must not look like a register that is
 * empty.
 */
import { type MouseEvent as ReactMouseEvent, useMemo } from 'react';
import { Target } from 'lucide-react';
import {
  BoardCard,
  type BoardColumn,
  EmptyState,
  fmt,
  KanbanBoard,
  Spinner,
  useLocale,
} from '@/platform/sdk';
import { Dash, Funnel } from './cells';
import { asStage, stageChoices, stageLabel } from './lifecycle';
import { type CrmModel, type Opportunity, type Stage, STAGES } from './model';
import type { CrmRow } from './shell';
import { STAGE_TONE, toneOf } from './tones';

export interface PipelineBoardProps {
  readonly model: CrmModel;
  /** Only its emptiness matters here, for the empty state's wording. */
  readonly searching: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onContext: (row: CrmRow, event: ReactMouseEvent) => void;
  readonly onActivate: (row: CrmRow) => void;
  /** A card was dragged or Ctrl+arrowed. The shell decides whether the move is legal. */
  readonly onMoveStage: (opportunityId: string, to: Stage) => void;
}

/** Deals that landed on a stage no enum knows. They are shown, in their own column, locked. */
const OTHER = '__other__';

/**
 * Every deal filed under the stage it claims.
 *
 * A row whose `stage` is not one of the six keeps a column of its own rather than being
 * dropped. The grid this replaced printed such a row with its raw code in a neutral badge,
 * and a board that silently showed one deal fewer than the funnel counted would be worse
 * than one with an odd seventh column.
 */
function group(rows: readonly Opportunity[]): ReadonlyMap<string, readonly Opportunity[]> {
  const byStage = new Map<string, Opportunity[]>();
  for (const stage of STAGES) byStage.set(stage, []);
  for (const row of rows) {
    const known = asStage(row.stage);
    const key = known === null ? OTHER : known;
    const bucket = byStage.get(key);
    if (bucket === undefined) byStage.set(key, [row]);
    else bucket.push(row);
  }
  return byStage;
}

/** A date that has gone by. Parse failures are not overdue — the grid's rule, verbatim. */
function due(iso: string | null, now: number): boolean {
  if (iso === null) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at < now;
}

interface CardProps {
  readonly row: Opportunity;
  readonly customer: string | undefined;
  readonly overdue: boolean;
  readonly locked: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string | null) => void;
  readonly onContext: (row: CrmRow, event: ReactMouseEvent) => void;
  readonly onActivate: (row: CrmRow) => void;
}

/**
 * One deal.
 *
 * Four facts and no more: what it is, who it is for, what it is worth, and when it is meant
 * to close. The grid carried eight columns because a grid can afford eight; a card cannot,
 * and the inspector is where the rest of the row already lives. Value is the plain figure
 * and the weighted one is the caption beside it, because the probability is already implied
 * by which column the card is sitting in.
 */
function DealCard({
  row,
  customer,
  overdue,
  locked,
  selected,
  onSelect,
  onContext,
  onActivate,
}: CardProps) {
  const { tr, lang } = useLocale();
  return (
    <BoardCard
      id={row.id}
      tone={overdue ? 'warning' : undefined}
      selected={selected}
      locked={locked}
      onClick={() => onSelect(row.id)}
      onActivate={() => onActivate(row)}
      onContextMenu={(event) => onContext(row, event)}
    >
      <span
        className="fx-title-ellipsis"
        title={row.title}
        style={{ fontSize: 'var(--fx-body)', fontWeight: 600 }}
      >
        {row.title}
      </span>
      <span
        className="fx-title-ellipsis"
        style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}
      >
        {customer === undefined || customer === '' ? row.reference : customer}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
        <span className="fx-mono" style={{ fontSize: 'var(--fx-body)' }}>
          {fmt.money(row.valueDzd, 'DZD', lang)}
        </span>
        <span
          className="fx-mono"
          style={{
            marginInlineStart: 'auto',
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-tertiary)',
          }}
          title={tr('القيمة المرجّحة', 'Valeur pondérée', 'Weighted value')}
        >
          {fmt.compact(row.weightedDzd, lang)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          fontSize: 'var(--fx-caption)',
          color: overdue ? 'var(--fx-warning)' : 'var(--fx-text-tertiary)',
        }}
      >
        <span className="fx-mono">
          {row.expectedCloseDate === null ? <Dash /> : fmt.date(row.expectedCloseDate, lang)}
        </span>
        <span className="fx-mono" style={{ marginInlineStart: 'auto' }}>
          {fmt.integer(row.travelers, lang)}
          {' '}
          {tr('مسافر', 'voy.', 'pax')}
        </span>
      </div>
    </BoardCard>
  );
}

/**
 * The pipeline board.
 *
 * `KanbanBoard` owns the measurement, the fold to one column at a time on a narrow window,
 * the drag plumbing and the Ctrl+Arrow contract. What this owns is which columns there are,
 * what is in them, and what each column is worth — which is the only part that is about a
 * pipeline rather than about boards.
 */
export function PipelineBoard({
  model,
  searching,
  selectedId,
  onSelect,
  onContext,
  onActivate,
  onMoveStage,
}: PipelineBoardProps) {
  const { t, tr, lang } = useLocale();
  const now = Date.now();
  const rows = model.visible.opportunities;
  const buckets = useMemo(() => group(rows), [rows]);
  // The grid's loading rule, kept: measured against the *unfiltered* length, so a search
  // that matched nothing says so instead of spinning forever. Six empty columns would read
  // as an empty pipeline rather than as a pipeline that has not arrived.
  const loading = model.loading && model.all.opportunities.length === 0;

  const columns: BoardColumn[] = [];
  for (const stage of STAGES) {
    const deals = buckets.get(stage) ?? [];
    const value = deals.reduce((sum, deal) => sum + deal.valueDzd, 0);
    const onward = stageChoices(stage);
    columns.push({
      id: stage,
      title: t(stageLabel(stage)),
      tone: toneOf(STAGE_TONE, stage),
      meta:
        deals.length === 0
          ? '—'
          : `${fmt.integer(deals.length, lang)} · ${fmt.compact(value, lang)}`,
      // Where a card in this column may go. The keyboard contract is Ctrl+Arrow and the
      // next column along is often not a legal destination, so the legal set is written
      // down rather than left to be discovered by refusal.
      footer:
        onward.length === 0 ? (
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {tr('مرحلة نهائية', 'Étape finale', 'Final stage')}
          </span>
        ) : (
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {tr('إلى', 'vers', 'to')}
            {': '}
            {onward.map((next) => t(stageLabel(next))).join(' · ')}
          </span>
        ),
      children: deals.map((row) => (
        <DealCard
          key={row.id}
          row={row}
          customer={row.customerId === null ? undefined : model.customerById.get(row.customerId)?.name}
          overdue={row.wonAt === null && row.lostAt === null && due(row.expectedCloseDate, now)}
          locked={onward.length === 0}
          selected={row.id === selectedId}
          onSelect={onSelect}
          onContext={onContext}
          onActivate={onActivate}
        />
      )),
    });
  }

  const strays = buckets.get(OTHER) ?? [];
  if (strays.length > 0) {
    columns.push({
      id: OTHER,
      title: tr('مراحل أخرى', 'Autres étapes', 'Other stages'),
      meta: fmt.integer(strays.length, lang),
      footer: (
        <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
          {tr('مرحلة غير معروفة', 'Étape inconnue', 'Unrecognised stage')}
        </span>
      ),
      children: strays.map((row) => (
        <DealCard
          key={row.id}
          row={row}
          customer={row.customerId === null ? undefined : model.customerById.get(row.customerId)?.name}
          overdue={false}
          locked
          selected={row.id === selectedId}
          onSelect={onSelect}
          onContext={onContext}
          onActivate={onActivate}
        />
      )),
    });
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Funnel stages={model.pipeline} />
      {loading ? (
        <div
          role="status"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'var(--fx-text-secondary)',
            fontSize: 'var(--fx-body)',
          }}
        >
          <Spinner size={18} />
          {tr('جارٍ التحميل…', 'Chargement…', 'Loading…')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={
            searching
              ? tr('لا نتائج', 'Aucun résultat', 'No matches')
              : tr('لا فرص', 'Aucune opportunité', 'No deals')
          }
          description={
            searching
              ? tr('عدّل البحث أو امسحه.', 'Modifiez la recherche ou effacez-la.', 'Adjust the search, or clear it.')
              : tr('ابدأ بـ Ctrl+N.', 'Commencez par Ctrl+N.', 'Start with Ctrl+N.')
          }
        />
      ) : (
        <KanbanBoard
          columns={columns}
          columnWidth={272}
          onMove={(cardId, toColumn) => {
            const to = asStage(toColumn);
            if (to !== null) onMoveStage(cardId, to);
          }}
          label={tr('لوحة خط الأنابيب', 'Tableau du pipeline', 'Pipeline board')}
        />
      )}
    </div>
  );
}
