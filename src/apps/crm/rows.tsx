/**
 * The parts a pane is made of.
 *
 * `detail.tsx` draws seven records; this file draws the rows, chips and lists all seven are
 * built from. The split is not cosmetic — the panes and their primitives together ran past the
 * 900 code lines `max-lines` allows one module — and of the two halves this is the one that
 * does not know which record is on screen. Not one component here takes `CrmModel`: everything
 * arrives as props, a label and a value, a list of rows, an already-resolved name. That is what
 * makes them safe to share. A primitive that reached into the model would quietly become a
 * second source of truth for the pane drawing it.
 *
 * Four rules the whole file keeps.
 *
 * A blank column drops its row: `Text` and `Coded` return `null` for `''`, because a label with
 * nothing beside it reads as *'missing'* rather than *'absent'*. A stamp is the exception and
 * always draws — `fmt.dateTime(null)` is an em-dash, and *'not answered yet'* is one of the
 * things a person opens a quote to find out.
 *
 * Enums are resolved through `wordFor`, over the same option tables the editors write with, so
 * a pane and a dialog call a lead's `QUALIFIED` by one name. A code no table knows keeps its
 * row and prints itself rather than blanking.
 *
 * Foreign keys arrive already resolved. `Linked` takes the `name` its caller could find and
 * prints the raw id when that is `undefined`, because a dropped row means *'no campaign'* and
 * an id means *'a campaign this page could not name'*.
 *
 * And nothing is exported that is not a component: `react-refresh/only-export-components` is
 * error-level here, so the two private constants and the six props interfaces stay private.
 */
import {
  AlarmClock,
  FileText,
  ListTree,
  MessageSquare,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  fmt,
  IconButton,
  InfoBar,
  PropertyRow,
  Section,
  useLocale,
} from '@/platform/sdk';
import { Chip } from './cells';
import type { CrmEntity } from './form';
import { asStage, stageLabel } from './lifecycle';
import type { Activity, Followup, Opportunity, QuoteLine, StageStep } from './model';
import {
  FOLLOWUP_STATUS_TONE,
  STAGE_TONE,
  toneOf,
  type ToneTable,
  wordFor,
} from './tones';
/** A text row, dropped when the column is blank: a label with nothing beside it is noise. */
export function Text({ label, value }: { readonly label: string; readonly value: string }) {
  if (value.trim() === '') return null;
  return <PropertyRow label={label}>{value}</PropertyRow>;
}

/**
 * A stamp row, which stays even when the stamp is null — `fmt.dateTime` renders an em-dash
 * for it, and *'not yet answered'* is one of the things a person opens a quote to find out.
 */
export function Stamp({ label, value }: { readonly label: string; readonly value: string | null }) {
  const { lang } = useLocale();
  return (
    <PropertyRow label={label} mono>
      {fmt.dateTime(value, lang)}
    </PropertyRow>
  );
}

/** A date row, for the columns the database stores as a day rather than an instant. */
export function Day({ label, value }: { readonly label: string; readonly value: string | null }) {
  const { lang } = useLocale();
  return (
    <PropertyRow label={label} mono>
      {fmt.date(value, lang)}
    </PropertyRow>
  );
}
interface CodedProps {
  readonly label: string;
  readonly entity: CrmEntity;
  readonly field: string;
  readonly value: string;
  /** Omitted for the enums that are facts rather than states — a source, a channel, a type. */
  readonly table?: ToneTable;
}

/**
 * An enum row, resolved through the same option table the editor writes with, so the pane
 * and the dialog call a lead's `QUALIFIED` by one name. A blank value drops the row; a value
 * the table does not know keeps it and prints the code, for the reason `wordFor` gives.
 */
export function Coded({ label, entity, field, value, table }: CodedProps) {
  const { t } = useLocale();
  const text = wordFor(t, entity, field, value);
  if (text === '') return null;
  return (
    <PropertyRow label={label}>
      <Chip text={text} tone={table === undefined ? 'neutral' : toneOf(table, value)} />
    </PropertyRow>
  );
}

interface MoneyProps {
  readonly label: string;
  readonly value: number;
  /** A quote priced in riyals. Every other amount in the graph is dinars. */
  readonly sar?: boolean;
}

/**
 * An amount row. The currency arrives as a flag rather than a code because only two of the
 * union's members can reach this desk, and narrowing here keeps `fmt.money` honest.
 */
export function Money({ label, value, sar = false }: MoneyProps) {
  const { lang } = useLocale();
  return (
    <PropertyRow label={label} mono>
      {fmt.money(value, sar ? 'SAR' : 'DZD', lang)}
    </PropertyRow>
  );
}
interface LinkedProps {
  readonly label: string;
  readonly id: string | null;
  /** The name this page could resolve, or `undefined` when it never loaded that row. */
  readonly name: string | undefined;
}

/**
 * A foreign key as the name it points at, or as the key itself.
 *
 * A dropped row says *'no campaign'* and an id says *'a campaign this page could not name'* —
 * `export.ts` keeps the two apart in its cells for the same reason. The unresolved id is
 * monospaced because by then it is something to paste into a search box, not something to read.
 */
export function Linked({ label, id, name }: LinkedProps) {
  if (id === null) return null;
  if (name === undefined || name === '') {
    return (
      <PropertyRow label={label} mono>
        {id}
      </PropertyRow>
    );
  }
  return (
    <PropertyRow label={label}>
      <span className="fx-title-ellipsis" title={name}>
        {name}
      </span>
    </PropertyRow>
  );
}

/**
 * Free text, wrapped rather than clipped. Notes are the one column a person writes for
 * another person, and a note that ends in an ellipsis is worth less than no note at all.
 */
export function Prose({ text }: { readonly text: string }) {
  return <div style={{ whiteSpace: 'pre-wrap', minWidth: 0 }}>{text}</div>;
}

/** A count for a `Section`'s action slot — *'how many'*, answered before the list is read. */
export function Count({ value }: { readonly value: number }) {
  const { lang } = useLocale();
  return (
    <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)' }}>
      {fmt.integer(value, lang)}
    </span>
  );
}
// ---------------------------------------------------------------------------
// The two lists most records have
// ---------------------------------------------------------------------------

/** A pane is a summary: five rows, newest first. The Activities desk holds the whole log. */
const LOG_LIMIT = 5;

/**
 * One line of a communication log.
 *
 * The stamp is monospaced and sits on its own line so five of them read as a column rather
 * than drifting with the width of each subject. The type chip is dropped when the row's type
 * is blank instead of drawing an empty badge — a badge with nothing in it is a fault, not a fact.
 */
function LogRow({ row }: { readonly row: Activity }) {
  const { t, lang } = useLocale();
  const kind = wordFor(t, 'activity', 'activity_type', row.type);
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {kind === '' ? null : <Chip text={kind} />}
        <span className="fx-title-ellipsis" title={row.subject}>
          {row.subject}
        </span>
      </div>
      <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)' }}>
        {fmt.dateTime(row.occurredAt, lang)}
      </span>
    </div>
  );
}
/**
 * The log for one record, newest first — the order a conversation is read in when the question
 * is *'where did we leave this'*. The count in the action slot is the full total, so five rows
 * can never pass themselves off as the whole history.
 */
export function Log({ rows }: { readonly rows: readonly Activity[] }) {
  const { tr } = useLocale();
  const recent = [...rows]
    .sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))
    .slice(0, LOG_LIMIT);
  return (
    <Section title={tr('السجل', 'Journal', 'Log')} action={<Count value={rows.length} />}>
      {recent.length === 0 ? (
        <InfoBar
          icon={MessageSquare}
          title={tr('لا يوجد نشاط مسجَّل', 'Aucune activité enregistrée', 'Nothing logged yet')}
        />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {recent.map((row) => (
            <LogRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </Section>
  );
}
/**
 * One task. The status chip turns red when the model says the row is late, which is a stronger
 * statement than its status column makes: `PENDING` is a state, *'pending and past due'* is a
 * problem, and the pane should be able to say the second without the reader doing date arithmetic.
 */
function TaskRow({ row, late }: { readonly row: Followup; readonly late: boolean }) {
  const { t, lang } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Chip
          text={wordFor(t, 'followup', 'status', row.status)}
          tone={late ? 'danger' : toneOf(FOLLOWUP_STATUS_TONE, row.status)}
        />
        <span className="fx-title-ellipsis" title={row.title}>
          {row.title}
        </span>
      </div>
      <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)' }}>
        {fmt.dateTime(row.dueAt, lang)}
      </span>
    </div>
  );
}
interface TasksProps {
  readonly rows: readonly Followup[];
  /** The model's own reading of *late*, so this pane and the grid's red rows never disagree. */
  readonly overdue: ReadonlySet<string>;
}

/** Sorts an undated task last: nobody scheduled it, which is not the same as it being urgent. */
const UNDATED = '￿';

/**
 * The tasks against one record, soonest first — a follow-up list is read forwards, because the
 * next thing to do is what the reader came for.
 */
export function Tasks({ rows, overdue }: TasksProps) {
  const { tr } = useLocale();
  const soonest = [...rows].sort((a, b) =>
    (a.dueAt ?? UNDATED).localeCompare(b.dueAt ?? UNDATED),
  );
  return (
    <Section
      title={tr('المتابعات', 'Relances', 'Follow-ups')}
      action={<Count value={rows.length} />}
    >
      {soonest.length === 0 ? (
        <InfoBar icon={AlarmClock} title={tr('لا توجد متابعة', 'Aucune relance', 'No follow-up')} />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {soonest.slice(0, LOG_LIMIT).map((row) => (
            <TaskRow key={row.id} row={row} late={overdue.has(row.id)} />
          ))}
        </div>
      )}
    </Section>
  );
}
/** The notes card, absent when there are none: an empty card is a claim that content exists. */
export function Notes({ text }: { readonly text: string }) {
  const { tr } = useLocale();
  if (text.trim() === '') return null;
  return (
    <Card icon={ScrollText} title={tr('ملاحظات', 'Notes', 'Notes')}>
      <Prose text={text} />
    </Card>
  );
}

/**
 * A stage as a coloured word.
 *
 * `asStage` rather than a cast: the projection types `stage` as `string` because the database's
 * CHECK constraint owns the column, and `stageLabel` will only accept one of the six. A seventh
 * value added tomorrow therefore prints as its own code rather than crashing the ladder — the
 * same bargain `wordFor` strikes for every other enum on the desk.
 */
export function StageChip({ stage }: { readonly stage: string }) {
  const { t } = useLocale();
  const known = asStage(stage);
  return (
    <Chip
      text={known === null ? stage.toUpperCase() : t(stageLabel(known))}
      tone={toneOf(STAGE_TONE, stage)}
    />
  );
}

/**
 * One deal, as a customer's pane lists it: stage, title, and what it is worth.
 *
 * It reads its own locale rather than taking one, so the pane mapping over a customer's deals
 * never threads `lang` through a list it only wanted to draw.
 */
export function DealRow({ deal }: { readonly deal: Opportunity }) {
  const { lang } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <StageChip stage={deal.stage} />
        <span className="fx-title-ellipsis" title={deal.title}>
          {deal.title}
        </span>
      </div>
      <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)' }}>
        {fmt.money(deal.valueDzd, 'DZD', lang)}
      </span>
    </div>
  );
}

/**
 * One rung of the stage ladder: where the deal went, when, and at what odds.
 *
 * `fromStage` is blank on the first row the trigger ever wrote, so the arrow is dropped rather
 * than pointing at nothing — an EN DASH separates the pair, never an arrow, because the ladder
 * reads right-to-left in Arabic and a glyph that means *'onward'* in one script means the
 * opposite in the other.
 */
function Rung({ row }: { readonly row: StageStep }) {
  const { lang } = useLocale();
  const from = row.fromStage.trim() === '' ? null : row.fromStage;
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {from === null ? null : <StageChip stage={from} />}
        {from === null ? null : <span style={{ color: 'var(--fx-text-tertiary)' }}>–</span>}
        <StageChip stage={row.toStage} />
      </div>
      <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)' }}>
        {fmt.dateTime(row.changedAt, lang)} · {fmt.percent(row.probability / 100, lang)}
      </span>
      {row.note.trim() === '' ? null : <Prose text={row.note} />}
    </div>
  );
}

/**
 * The ladder a deal climbed, oldest first.
 *
 * Oldest first, unlike the activity log: a history is read as a story from its beginning, while
 * a log is read for what just happened. `model.history` is loaded for the selected deal alone,
 * which is the whole reason this belongs in a pane rather than a column.
 */
export function Ladder({ rows }: { readonly rows: readonly StageStep[] }) {
  const { tr } = useLocale();
  const climbed = [...rows].sort((a, b) => (a.changedAt ?? '').localeCompare(b.changedAt ?? ''));
  return (
    <Section title={tr('المراحل', 'Étapes', 'Stages')} action={<Count value={rows.length} />}>
      {climbed.length === 0 ? (
        <InfoBar
          icon={ListTree}
          title={tr('لا يوجد تغيير مرحلة', 'Aucun changement d’étape', 'No stage change')}
        />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {climbed.map((row) => (
            <Rung key={row.id} row={row} />
          ))}
        </div>
      )}
    </Section>
  );
}

interface LineRowProps {
  readonly line: QuoteLine;
  /** The quote's currency, already narrowed to the two this desk can price in. */
  readonly sar: boolean;
  /** False once the quote has been sent: a priced offer stops being editable. */
  readonly editable: boolean;
  readonly onEdit: (line: QuoteLine) => void;
  readonly onRemove: (line: QuoteLine) => void;
}

/**
 * One line of a quote, with the arithmetic spelled out.
 *
 * `lineTotal` is printed rather than recomputed from quantity and price, because the database
 * generates that column and a register that multiplied for itself would eventually disagree
 * with the total the customer was actually sent.
 */
function LineRow({ line, sar, editable, onEdit, onRemove }: LineRowProps) {
  const { tr, lang } = useLocale();
  const currency = sar ? 'SAR' : 'DZD';
  const each = fmt.money(line.unitPrice, currency, lang);
  const total = fmt.money(line.lineTotal, currency, lang);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
        <span className="fx-title-ellipsis" title={line.description}>
          {line.description}
        </span>
        <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)' }}>
          {fmt.integer(line.quantity, lang)} × {each} = {total}
        </span>
      </div>
      {editable ? (
        <div style={{ display: 'flex', gap: 2 }}>
          <IconButton
            icon={Pencil}
            label={tr('تعديل', 'Modifier', 'Edit')}
            size={14}
            onClick={() => onEdit(line)}
          />
          <IconButton
            icon={Trash2}
            label={tr('حذف', 'Supprimer', 'Delete')}
            size={14}
            tone="danger"
            onClick={() => onRemove(line)}
          />
        </div>
      ) : null}
    </div>
  );
}
interface LinesProps {
  readonly lines: readonly QuoteLine[];
  readonly sar: boolean;
  readonly editable: boolean;
  readonly onAdd: () => void;
  readonly onEdit: (line: QuoteLine) => void;
  readonly onRemove: (line: QuoteLine) => void;
}

/**
 * A quote's lines, in the order the document itself prints them.
 *
 * `sortOrder` rather than insertion order, because this list is also the check a reader makes
 * before pressing Send — `crm.quote.send` refuses a quote with none — and it has to read the
 * way the offer the customer receives will read.
 */
export function Lines({ lines, sar, editable, onAdd, onEdit, onRemove }: LinesProps) {
  const { tr } = useLocale();
  const ordered = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Section
      title={tr('البنود', 'Lignes', 'Lines')}
      action={
        editable ? (
          <Button icon={Plus} size="sm" variant="subtle" onClick={onAdd}>
            {tr('بند', 'Ligne', 'Line')}
          </Button>
        ) : (
          <Count value={lines.length} />
        )
      }
    >
      {ordered.length === 0 ? (
        <InfoBar icon={FileText} title={tr('لا توجد بنود', 'Aucune ligne', 'No lines')} />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {ordered.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              sar={sar}
              editable={editable}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
