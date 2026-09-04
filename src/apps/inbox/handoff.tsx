/**
 * Inbox — the handoff reading pane.
 *
 * A handoff is not a document this window owns; it is a question another desk asked.
 * The pane is ordered the way the question is: who is asking whom and what for, then
 * what it is about, then who owes the answer and by when, and only then what has
 * already happened to it.
 *
 * The route leads because the route is the sentence. "Documents → Accounting", over
 * "Review", says who is waiting on whom and for what kind of answer, and it is the one
 * line that would still be legible with the rest of the pane cut away. The title comes
 * second because titles repeat down a chain — five steps all called "Rooming list,
 * block C" — so a title on its own identifies nothing.
 *
 * Every act is gated by `handoffActs`, which mirrors `private.spine_guard_handoff`'s
 * status rule once. Nothing here re-derives an act from `status`: two copies of that
 * rule would drift the day the guard changes, and the copy on the button is the one
 * that would lie to a person before the server refused them.
 *
 * The chain arrives ordered — `seq` for the steps, time for the events — and is
 * rendered in the order it arrives. When it cannot be read at all this says so in
 * words rather than drawing an empty timeline: "nothing has happened to this" and "we
 * could not find out what has happened to this" are opposite facts.
 */
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Check, UserCheck } from 'lucide-react';
import { Fragment, type CSSProperties } from 'react';
import { Badge, Button, fmt, InfoBar, PropertyRow, Section, toneColor, useApp } from '@/platform/sdk';
import {
  ACTION_LABEL,
  CHAIN_STATUS_LABEL,
  chainTone,
  HANDOFF_STATUS_LABEL,
  handoffTone,
  INTENT_LABEL,
  PRIORITY_LABEL,
  priorityTone,
  ROLE_LABEL,
  type SpineChainDoc,
  type SpineEvent,
  type SpineHandoff,
  type SpineInboxItem,
  type SpineStage,
  STAGE_LABEL,
  subjectLabel,
  toRole,
} from '../shared/spine';
import type { InboxBusy } from './actions';
import { ageTone, handoffActs, type WorkItem } from './queue';

/** The pane's own gutter, matched to `detail.tsx` so the two panes do not shift. */
const PANE: CSSProperties = { display: 'grid', gap: 14, alignContent: 'start' };

/** Caption-sized tertiary text: section counts, and prose that carries no value. */
const NOTE: CSSProperties = { fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' };

/** A person's own words, set apart from the facts around them. */
const QUOTE: CSSProperties = {
  fontSize: 'var(--fx-caption)',
  lineHeight: 1.5,
  paddingInlineStart: 10,
  borderInlineStart: '2px solid var(--fx-stroke)',
  color: 'var(--fx-text-secondary)',
};

/** Three columns per step: its number, its route, and where it got to. */
const STEP_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '20px minmax(0, 1fr) auto',
  gap: '5px 8px',
  fontSize: 'var(--fx-caption)',
  alignItems: 'center',
};

/** One event's head line: step, action, actor — and the time pushed to the far edge. */
const EVENT_HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 7,
  flexWrap: 'wrap',
  fontSize: 'var(--fx-caption)',
};

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

interface RouteProps {
  readonly from: SpineStage;
  readonly to: SpineStage;
  /** Arrow size in px: the head wants it legible, a step row wants it quiet. */
  readonly glyph: number;
}

/**
 * `from → to`, with the arrow pointing the way the reader reads.
 *
 * `ArrowLeft` in Arabic is not a mirrored decoration. The two stage names swap sides
 * under `direction: rtl`, so an arrow that kept pointing right would point from the
 * destination back to the origin — the one thing this line exists to get right.
 */
function Route({ from, to, glyph }: RouteProps) {
  const { t, rtl } = useApp().locale;
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <span className="fx-title-ellipsis">{t(STAGE_LABEL[from])}</span>
      <Arrow size={glyph} aria-hidden style={{ flex: 'none', color: 'var(--fx-text-tertiary)' }} />
      <span className="fx-title-ellipsis">{t(STAGE_LABEL[to])}</span>
    </span>
  );
}

/**
 * The Arabic title when there is one and the reader is reading right to left, else the
 * Latin one.
 *
 * Keyed on `rtl` rather than on `lang === 'ar'` because reading direction, not one
 * particular language code, is what decides which of the two titles is the useful one.
 * A right-to-left reader handed the Latin title while the Arabic one sits unused in the
 * row is a bug that only ever shows up on somebody else's screen.
 */
function titleFor(rtl: boolean, arabic: string | null, latin: string): string {
  return rtl && arabic !== null && arabic !== '' ? arabic : latin;
}

interface ScalarFields {
  readonly rows: readonly (readonly [string, string | number | boolean])[];
  readonly skipped: number;
}

/**
 * A jsonb object split into what can honestly be shown as a row, and a count of what
 * cannot.
 *
 * The shape of a payload is whatever the desk that opened the handoff put there, and
 * this pane knows none of it. Scalars become rows; anything nested is counted and left
 * alone, because a stringified object in a property cell is not information, it is a
 * shape somebody has to decode. Nested detail belongs to the application that wrote
 * it, and the subject row is the way there.
 *
 * Keys are sorted so the same payload does not reorder itself between reads: object
 * key order is insertion order, and the projection that builds the column is free to
 * change it.
 */
function scalarFields(payload: Readonly<Record<string, unknown>>): ScalarFields {
  const rows: (readonly [string, string | number | boolean])[] = [];
  let skipped = 0;
  for (const key of Object.keys(payload).sort((a, b) => a.localeCompare(b))) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      rows.push([key, value]);
    } else {
      skipped += 1;
    }
  }
  return { rows, skipped };
}

interface ScalarProps {
  readonly value: string | number | boolean;
}

/** One scalar as a cell: booleans as words, whole numbers grouped, the rest verbatim. */
function Scalar({ value }: ScalarProps) {
  const { tr, lang } = useApp().locale;
  if (typeof value === 'boolean') return <>{value ? tr('نعم', 'Oui', 'Yes') : tr('لا', 'Non', 'No')}</>;
  if (typeof value === 'number') return <>{Number.isInteger(value) ? fmt.integer(value, lang) : String(value)}</>;
  return <>{value === '' ? '—' : value}</>;
}

/* ------------------------------------------------------------------ *
 * One handoff
 * ------------------------------------------------------------------ */

interface HandoffDetailProps {
  readonly item: WorkItem;
  /**
   * The row itself, narrowed by the caller.
   *
   * `WorkItem` carries all four payloads and none of them is discriminated by `kind`,
   * so somebody has to do the null check. Doing it in the dispatcher — the way the
   * other three panes already do it — leaves this component with no unreachable branch
   * and no opinion about what to render when a handoff row arrives without a handoff.
   */
  readonly handoff: SpineInboxItem;
  readonly chain: SpineChainDoc | null;
  readonly chainLoading: boolean;
  readonly busy: InboxBusy;
  onCommand: (id: string) => void;
}

/**
 * One handoff: the question, the facts about it, the acts, and the chain behind it.
 *
 * The acts sit above the history rather than under it. The history is what a person
 * reads in order to decide, so it is context for the buttons and not a step after
 * them — and on a chain of eleven steps, a button below the ledger is a button nobody
 * finds.
 */
export function HandoffDetail({ item, handoff, chain, chainLoading, busy, onCommand }: HandoffDetailProps) {
  const { t, rtl } = useApp().locale;
  const title = titleFor(rtl, handoff.titleAr, handoff.title);
  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 7 }}>
        <div style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600, minWidth: 0 }}>
          <Route from={handoff.fromStage} to={handoff.toStage} glyph={15} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone="info">{t(INTENT_LABEL[handoff.intent])}</Badge>
          <Badge tone={handoffTone(handoff.status)}>{t(HANDOFF_STATUS_LABEL[handoff.status])}</Badge>
        </div>
        {/* An untitled handoff falls back to the grid's `#id` rather than to an empty
            line, because the pane and the row it was clicked from should agree. */}
        <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{title === '' ? item.title : title}</span>
        {handoff.note === null || handoff.note === '' ? null : <div style={QUOTE}>{handoff.note}</div>}
      </div>
      <HandoffFacts item={item} handoff={handoff} />
      <ActRow item={item} busy={busy} onCommand={onCommand} />
      <PayloadList payload={handoff.payload} />
      <HandoffChain chain={chain} chainLoading={chainLoading} selectedId={handoff.id} />
    </div>
  );
}

interface HandoffFactsProps {
  readonly item: WorkItem;
  readonly handoff: SpineInboxItem;
}

/**
 * What it is about, whose it is, and when it was due.
 *
 * The chain's title, status and priority are read off the projection row rather than
 * out of the chain document, and the redundancy is the point: `private.spine_inbox`
 * denormalises them precisely so a row can still say what it belongs to when the chain
 * read has not arrived — or cannot be read at all.
 */
function HandoffFacts({ item, handoff }: HandoffFactsProps) {
  const { t, tr, lang, rtl } = useApp().locale;
  const chainTitle = titleFor(rtl, handoff.chainTitleAr, handoff.chainTitle);
  const waiting = item.state === 'waiting';
  return (
    <div>
      <PropertyRow label={tr('السلسلة', 'Chaîne', 'Chain')}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {chainTitle === '' ? '—' : chainTitle}
          <Badge tone={chainTone(handoff.chainStatus)}>{t(CHAIN_STATUS_LABEL[handoff.chainStatus])}</Badge>
          <Badge tone={priorityTone(handoff.chainPriority)}>{t(PRIORITY_LABEL[handoff.chainPriority])}</Badge>
        </span>
      </PropertyRow>
      <PropertyRow label={tr('الخطوة', 'Étape', 'Step')}>
        {tr(
          `رقم ${fmt.integer(handoff.seq, lang)}`,
          `n° ${fmt.integer(handoff.seq, lang)}`,
          `no. ${fmt.integer(handoff.seq, lang)}`,
        )}
        {handoff.chainStage === null
          ? ''
          : ` · ${tr('السلسلة الآن عند', 'chaîne à', 'chain now at')} ${t(STAGE_LABEL[handoff.chainStage])}`}
      </PropertyRow>
      <PropertyRow label={tr('الموضوع', 'Objet', 'Subject')}>
        {handoff.subjectType === null ? (
          <span style={{ color: 'var(--fx-text-tertiary)' }}>
            {tr('لا شيء مرتبط.', 'Rien de rattaché.', 'Nothing attached.')}
          </span>
        ) : (
          <>
            {t(subjectLabel(handoff.subjectType))}
            {handoff.subjectId === null ? '' : ` · ${handoff.subjectId.slice(0, 8)}`}
          </>
        )}
      </PropertyRow>
      <PropertyRow label={tr('على عاتق', 'Attribuée à', 'Assigned to')} mono={handoff.assignedTo !== null}>
        <Assignee handoff={handoff} mine={item.mine} />
      </PropertyRow>
      <PropertyRow label={tr('الاستحقاق', 'Échéance', 'Due')}>
        {handoff.dueOn === null ? (
          <span style={{ color: 'var(--fx-text-tertiary)' }}>{tr('غير محددة', 'Non fixée', 'Not set')}</span>
        ) : (
          fmt.date(handoff.dueOn, lang)
        )}
      </PropertyRow>
      {/* The label changes with the state because the number means two different
          things: days somebody has been kept waiting, or the age of a closed record. */}
      <PropertyRow label={waiting ? tr('منتظرة منذ', 'En attente depuis', 'Waiting') : tr('العمر', 'Âge', 'Age')}>
        <span style={{ color: toneColor(ageTone(item.age, item.state)) }}>
          {item.age === 0
            ? tr('اليوم', 'aujourd’hui', 'today')
            : tr(
                `${fmt.integer(item.age, lang)} يوم`,
                `${fmt.integer(item.age, lang)} j`,
                `${fmt.integer(item.age, lang)} d`,
              )}
        </span>
      </PropertyRow>
      <PropertyRow label={tr('فتحها', 'Ouverte par', 'Opened by')} mono>
        {handoff.openedBy === null ? '—' : handoff.openedBy}
      </PropertyRow>
      <PropertyRow label={tr('فُتحت', 'Ouverte le', 'Opened')}>
        {handoff.openedAt === null ? '—' : fmt.dateTime(handoff.openedAt, lang)}
      </PropertyRow>
      {/* `decidedBy`, `decidedAt` and `decidedNote` fill in together or not at all, so
          all three are checked: any one of them present means this was answered. */}
      {handoff.decidedBy === null && handoff.decidedAt === null && handoff.decidedNote === null ? null : (
        <>
          <PropertyRow label={tr('أجابها', 'Répondue par', 'Answered by')} mono>
            {handoff.decidedBy === null ? '—' : handoff.decidedBy}
          </PropertyRow>
          <PropertyRow label={tr('تاريخ الجواب', 'Répondue le', 'Answered')}>
            {handoff.decidedAt === null ? '—' : fmt.dateTime(handoff.decidedAt, lang)}
          </PropertyRow>
          {handoff.decidedNote === null || handoff.decidedNote === '' ? null : (
            <PropertyRow label={tr('الجواب', 'Réponse', 'Answer')}>{handoff.decidedNote}</PropertyRow>
          )}
        </>
      )}
      <PropertyRow label={tr('المعرّف', 'Identifiant', 'Identifier')} mono>
        {handoff.id}
      </PropertyRow>
    </div>
  );
}
interface AssigneeProps {
  readonly handoff: SpineInboxItem;
  readonly mine: boolean;
}

/**
 * Who owes the answer — and when nobody in particular does, that it is a desk.
 *
 * `assigned_to` is null until somebody takes the work, so the honest reading of a role
 * is "whoever holds it", said in as many words. `ACCOUNTANT` printed on its own reads
 * as a person's name to anybody who has not seen the schema.
 *
 * An unrecognised role is printed as the database spelled it rather than dropped: a
 * word this build has not been taught is still the answer to "whose is this".
 */
function Assignee({ handoff, mine }: AssigneeProps) {
  const { t, tr } = useApp().locale;
  if (handoff.assignedTo !== null) {
    return (
      <>
        {handoff.assignedTo}
        {mine ? ` · ${tr('أنت', 'vous', 'you')}` : ''}
      </>
    );
  }
  const role = toRole(handoff.assignedRole);
  const name = role === null ? handoff.assignedRole : t(ROLE_LABEL[role]);
  if (name === null || name === '') {
    return (
      <span style={{ color: 'var(--fx-text-tertiary)' }}>
        {tr('لم تُخصَّص لأحد بعد.', 'Attribuée à personne pour l’instant.', 'Nobody in particular, yet.')}
      </span>
    );
  }
  return (
    <>
      {name}
      <span style={{ color: 'var(--fx-text-tertiary)' }}>
        {` · ${tr('دور، لا شخص', 'un rôle, pas une personne', 'a role, not a person')}`}
      </span>
      {mine ? ` · ${tr('وهو دورك', 'le vôtre', 'yours')}` : ''}
    </>
  );
}
interface ActRowProps {
  readonly item: WorkItem;
  readonly busy: InboxBusy;
  onCommand: (id: string) => void;
}

/**
 * The three answers, each shown only where the guard would allow it.
 *
 * `handoffActs` is the one client-side copy of `private.spine_guard_handoff`'s rule —
 * OPEN accepts, ACCEPTED completes, either declines — and it is read here rather than
 * re-derived from `status`. An act the server would refuse is not rendered disabled, it
 * is not rendered: a greyed button on a settled handoff invites somebody to work out
 * why, and there is nothing to work out. Exactly one of accept and complete can ever
 * apply, so the two never appear side by side competing for the same emphasis.
 *
 * The commands are ids, not calls. This pane has no route to the RPC layer: the
 * toolbar, the row menu and this row all emit the same three ids through `onCommand`,
 * so the note a decline has to collect is built once, where the commands are handled.
 */
function ActRow({ item, busy, onCommand }: ActRowProps) {
  const { tr } = useApp().locale;
  const acts = handoffActs(item);
  if (!acts.accept && !acts.complete && !acts.decline) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {acts.accept ? (
        <Button variant="accent" icon={UserCheck} busy={busy === 'accept'} onClick={() => onCommand('accept')}>
          {tr('استلام', 'Prendre en charge', 'Accept')}
        </Button>
      ) : null}
      {acts.complete ? (
        <Button variant="accent" icon={Check} busy={busy === 'complete'} onClick={() => onCommand('complete')}>
          {tr('إنجاز', 'Terminer', 'Complete')}
        </Button>
      ) : null}
      {acts.decline ? (
        <Button icon={Ban} busy={busy === 'decline'} onClick={() => onCommand('decline')}>
          {tr('رفض…', 'Refuser…', 'Decline…')}
        </Button>
      ) : null}
    </div>
  );
}
interface PayloadListProps {
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Whatever the asking desk attached, as far as it can be read as rows.
 *
 * Nothing is rendered when there is nothing to render — an empty heading is furniture.
 * When every field is nested the count is still shown, because "there is something here
 * this pane will not show you" is worth saying, and it is not the same sentence as
 * "there is nothing here".
 */
function PayloadList({ payload }: PayloadListProps) {
  const { tr, lang } = useApp().locale;
  const { rows, skipped } = scalarFields(payload);
  if (rows.length === 0 && skipped === 0) return null;
  return (
    <Section title={tr('بيانات مرفقة', 'Données jointes', 'Attached data')}>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.length === 0 ? null : (
          <div>
            {rows.map(([key, value]) => (
              <PropertyRow
                key={key}
                label={<span className="fx-mono">{key}</span>}
                mono={typeof value !== 'boolean'}
              >
                <Scalar value={value} />
              </PropertyRow>
            ))}
          </div>
        )}
        {skipped === 0 ? null : (
          <span style={NOTE}>
            {tr(
              `و${fmt.integer(skipped, lang)} حقلًا مركّبًا لا يُعرض هنا.`,
              `${fmt.integer(skipped, lang)} champ(s) imbriqué(s) non affiché(s) ici.`,
              `${fmt.integer(skipped, lang)} nested field(s) not shown here.`,
            )}
          </span>
        )}
      </div>
    </Section>
  );
}
/* ------------------------------------------------------------------ *
 * The chain behind it
 * ------------------------------------------------------------------ */

interface HandoffChainProps {
  readonly chain: SpineChainDoc | null;
  readonly chainLoading: boolean;
  /** The step being read, marked in place rather than repeated underneath. */
  readonly selectedId: string;
}

/**
 * Everything that has happened to this chain: the steps, and then the ledger.
 *
 * Three states, and they are three different sentences. Reading — the document is on its
 * way, and an empty timeline drawn in the meantime reads as "nothing has happened here".
 * Unreadable — said in a warning bar, because a silent absence cannot be told apart from
 * a chain that genuinely has one step. Read — the steps and the events, in the order the
 * function returned them.
 *
 * A document that does not contain this handoff is the previous selection's chain, still
 * in hand while the new read is in flight. `private.spine_chain` returns every handoff of
 * the chain with no limit, so the selected one is always among them when the document is
 * the right one; rendering it regardless would attribute one desk's history to another.
 */
function HandoffChain({ chain, chainLoading, selectedId }: HandoffChainProps) {
  const { tr, lang } = useApp().locale;
  const doc = chain !== null && chain.handoffs.some((step) => step.id === selectedId) ? chain : null;
  if (doc === null) {
    return chainLoading ? (
      <span style={NOTE}>{tr('جارٍ قراءة السلسلة…', 'Lecture de la chaîne…', 'Reading the chain…')}</span>
    ) : (
      <InfoBar
        tone="warning"
        icon={AlertTriangle}
        title={tr('لا يمكن قراءة السلسلة', 'Chaîne illisible', 'The chain could not be read')}
      >
        {tr(
          'التحويلة أعلاه صحيحة، أمّا تاريخ السلسلة فلم يُقرأ. ما سبق هذه الخطوة غير معروف الآن.',
          'La transmission ci-dessus est exacte ; son historique n’a pas pu être lu. Ce qui a précédé cette étape est inconnu pour l’instant.',
          'The handoff above is accurate; its history could not be read. What came before this step is unknown for now.',
        )}
      </InfoBar>
    );
  }
  return (
    <>
      <Section
        title={tr('خطوات السلسلة', 'Étapes de la chaîne', 'Chain steps')}
        action={<span style={NOTE}>{fmt.integer(doc.handoffs.length, lang)}</span>}
      >
        <StepList handoffs={doc.handoffs} selectedId={selectedId} />
      </Section>
      {/* The ledger is last because it is the longest and the least urgent: it answers
          "how did this get here", which is the question a reader has after the ones the
          rows above already answered. */}
      <Section
        title={tr('السجل', 'Journal', 'Ledger')}
        action={<span style={NOTE}>{fmt.integer(doc.events.length, lang)}</span>}
      >
        <EventList events={doc.events} handoffs={doc.handoffs} selectedId={selectedId} />
      </Section>
    </>
  );
}
interface StepListProps {
  readonly handoffs: readonly SpineHandoff[];
  readonly selectedId: string;
}

/**
 * The chain as a numbered sequence: which desk asked which, and where each ask got to.
 *
 * `seq` leads because it is the chain's own numbering and nothing else on the row tells
 * two steps between the same pair of stages apart.
 *
 * The step being read is named in words as well as weighted. A reader who cannot tell 600
 * from 400 — or who is reading this at high contrast, or has it read aloud — still has to
 * know which of eleven rows is the one the buttons above act on.
 */
function StepList({ handoffs, selectedId }: StepListProps) {
  const { t, tr, lang } = useApp().locale;
  return (
    <div style={STEP_GRID}>
      {handoffs.map((step) => {
        const here = step.id === selectedId;
        return (
          <Fragment key={step.id}>
            <span className="fx-mono" style={{ color: 'var(--fx-text-tertiary)', fontWeight: here ? 600 : 400 }}>
              {fmt.integer(step.seq, lang)}
            </span>
            <span style={{ minWidth: 0, fontWeight: here ? 600 : 400 }}>
              <Route from={step.fromStage} to={step.toStage} glyph={12} />
              {here ? <span style={NOTE}>{` · ${tr('هذه', 'celle-ci', 'this one')}`}</span> : null}
            </span>
            <Badge tone={handoffTone(step.status)}>{t(HANDOFF_STATUS_LABEL[step.status])}</Badge>
          </Fragment>
        );
      })}
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

/**
 * The words a person typed on an event, or nothing.
 *
 * Every action stores its prose under one of two keys — `note` for the three a person
 * performs, `reason` for the one the chain performs when it is abandoned — so reading both
 * covers all five without the caller having to know which action it is holding.
 *
 * Accept and complete store `coalesce(btrim(p_note), '')`, so an empty note arrives as a
 * present-but-empty string. That has to fall through to nothing rather than draw an empty
 * quote block: a rule with no words beside it says somebody had nothing to add, which is
 * true, and an empty indented box says the note failed to load, which is not.
 */
function eventWords(detail: Readonly<Record<string, unknown>>): string {
  for (const key of ['note', 'reason'] as const) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * The e-mail if the row has one, else the uid, else nothing.
 *
 * The uid is what the row scoping was checked against and the e-mail is what a person
 * recognises. Preferring the e-mail is not cosmetic: `spine_actor_email()` returns `''`
 * for a service role, and printing a bare uuid to a reader looking for a colleague's name
 * is worse than printing nothing at all.
 */
function actorOf(event: SpineEvent): string {
  if (event.actorEmail !== null && event.actorEmail !== '') return event.actorEmail;
  return event.actor ?? '';
}

interface EventListProps {
  readonly events: readonly SpineEvent[];
  readonly handoffs: readonly SpineHandoff[];
  readonly selectedId: string;
}
/**
 * Every action taken on this chain, oldest first.
 *
 * The order is the database's (`order by at, id`) and is not re-sorted here: two events
 * written in one transaction share a timestamp to the microsecond, and `id` is what breaks
 * that tie the same way on every read.
 *
 * Each line names its step, because eleven steps produce thirty events and «مقبولة» on its
 * own is not a fact anybody can place. Events on the step being read are set in the primary
 * colour; the rest recede.
 *
 * The statuses an event moved between are deliberately not printed. The action already is
 * that transition, said in the reader's language, and the rows above show where each step
 * landed — `OPEN → ACCEPTED` beside «مقبولة» would be the same fact twice, the second time
 * in a vocabulary that belongs to the table.
 */
function EventList({ events, handoffs, selectedId }: EventListProps) {
  const { t, tr, lang } = useApp().locale;
  if (events.length === 0) {
    return (
      <span style={NOTE}>
        {tr('لم يُسجَّل شيء بعد.', 'Rien n’a encore été enregistré.', 'Nothing recorded yet.')}
      </span>
    );
  }
  const seqOf = new Map(handoffs.map((step) => [step.id, step.seq] as const));
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {events.map((event) => {
        const seq = event.handoffId === null ? undefined : seqOf.get(event.handoffId);
        const here = event.handoffId === selectedId;
        const who = actorOf(event);
        const words = eventWords(event.detail);
        return (
          <div key={event.id} style={{ display: 'grid', gap: 3, minWidth: 0 }}>
            <span style={EVENT_HEAD}>
              <span className="fx-mono" style={{ color: 'var(--fx-text-tertiary)' }}>
                {seq === undefined ? '—' : `#${fmt.integer(seq, lang)}`}
              </span>
              <span
                style={{
                  fontWeight: here ? 600 : 400,
                  color: here ? 'var(--fx-text-primary)' : 'var(--fx-text-secondary)',
                }}
              >
                {t(ACTION_LABEL[event.action])}
              </span>
              {who === '' ? null : <span style={NOTE}>{who}</span>}
              <span style={{ ...NOTE, marginInlineStart: 'auto' }}>
                {event.at === null ? '—' : fmt.dateTime(event.at, lang)}
              </span>
            </span>
            {words === '' ? null : <div style={QUOTE}>{words}</div>}
          </div>
        );
      })}
    </div>
  );
}
