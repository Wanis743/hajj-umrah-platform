/**
 * Fluent UI kit — document and statement layouts.
 *
 * The arrangements in `boards.tsx` are spatial: things beside other things. The
 * ones here are the other half of the suite's work, where the shape of the
 * screen is the shape of a *document* — a journal entry that has to balance, a
 * close checklist that runs in order, a statement that will be printed, a
 * variance that is only meaningful against zero.
 *
 * The same rule applies to all of them. They hold no data, make no syscall, and
 * never format a number: every figure arrives already formatted by the app that
 * owns the locale and the currency. Where a component needs the *magnitude* of a
 * number — only `VarianceRow` does — it takes the raw value separately and uses
 * it for geometry alone, so a bar can never disagree with the figure printed
 * beside it.
 */
import {
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import { useKitLabels } from './kitRuntime';
import { Pivot } from './layout';
import { useElementWidth } from './responsive';
import { toneColor, toneSurface, type Tone } from './tokens';

/* ------------------------------------------------------------------ *
 * Ribbon
 * ------------------------------------------------------------------ */

export interface RibbonCommand {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: LucideIcon;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** Two rows tall: the one command the group is actually about. */
  readonly primary?: boolean;
  readonly tone?: Tone;
}

export interface RibbonGroup {
  readonly id: string;
  readonly label: ReactNode;
  readonly commands: readonly RibbonCommand[];
}

export interface RibbonTab<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
  readonly groups: readonly RibbonGroup[];
}

export interface RibbonProps<T extends string> {
  tabs: readonly RibbonTab<T>[];
  tab: T;
  onTab: (next: T) => void;
  /** Shown at the inline-end of the tab strip: a document title, a dirty mark. */
  aside?: ReactNode;
  /** Opens collapsed — tabs only, no command rows. */
  initiallyCollapsed?: boolean;
}

/**
 * A grouped command surface, in the shape Office has used since 2007.
 *
 * The reason a journal entry gets this rather than a toolbar is that posting is
 * not one task: there is entering, there is attaching, there is reversing, there
 * is period control, and a flat row of sixteen icons says nothing about which of
 * those a given button belongs to. A ribbon's labelled groups say it on the
 * screen, so the structure does not have to be learned.
 *
 * The tab strip is the kit's own `Pivot`, not a hand-rolled one. That matters
 * for a reason this commit's predecessor paid for: `Pivot` is Fluent's `TabList`
 * now, which means roving tabindex, arrow keys, Home and End, and space reserved
 * for the selected tab's weight — a contract this file would otherwise have had
 * to implement for the third time.
 */
export function Ribbon<T extends string>({ tabs, tab, onTab, aside, initiallyCollapsed = false }: RibbonProps<T>) {
  const tr = useKitLabels();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const bodyId = useId();
  const active = tabs.find((entry) => entry.id === tab) ?? tabs[0];

  return (
    <div style={{ display: 'grid', background: 'var(--fx-control)', borderBottom: '1px solid var(--fx-divider)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingInline: 10 }}>
        <Pivot
          tabs={tabs.map((entry) => ({ id: entry.id, label: entry.label }))}
          active={active === undefined ? tab : active.id}
          onChange={onTab}
        />
        {aside !== undefined ? (
          <div style={{ marginInlineStart: 'auto', paddingBottom: 8, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {aside}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          title={collapsed ? tr('إظهار الشريط', 'Afficher le ruban', 'Show the ribbon') : tr('طي الشريط', 'Réduire le ruban', 'Collapse the ribbon')}
          style={{
            marginInlineStart: aside === undefined ? 'auto' : undefined,
            marginBottom: 6,
            display: 'grid',
            placeItems: 'center',
            width: 26,
            height: 22,
            flex: 'none',
            border: 'none',
            borderRadius: 'var(--fx-radius-control)',
            background: 'transparent',
            color: 'var(--fx-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      <div id={bodyId} hidden={collapsed}>
        {active === undefined || collapsed ? null : (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', paddingInline: 6 }}>
            {active.groups.map((group, index) => (
              <section
                key={group.id}
                style={{
                  display: 'grid',
                  gridTemplateRows: '1fr auto',
                  gap: 4,
                  paddingInline: 10,
                  paddingBlock: '8px 5px',
                  borderInlineStart: index === 0 ? undefined : '1px solid var(--fx-divider)',
                  flex: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 3 }}>
                  {group.commands.map((command) => (
                    <RibbonButton key={command.id} command={command} />
                  ))}
                </div>
                <div
                  style={{
                    fontSize: 'var(--fx-caption)',
                    color: 'var(--fx-text-tertiary)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.label}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One ribbon command. Large and stacked when `primary`, small and inline otherwise. */
function RibbonButton({ command }: { command: RibbonCommand }) {
  const Glyph = command.icon;
  const tint = command.tone === undefined ? 'var(--fx-text-secondary)' : toneColor(command.tone);
  const large = command.primary === true;
  return (
    <button
      type="button"
      onClick={command.onClick}
      disabled={command.disabled === true}
      style={{
        display: 'flex',
        flexDirection: large ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: large ? 'center' : 'flex-start',
        gap: large ? 4 : 7,
        minWidth: large ? 60 : undefined,
        maxWidth: large ? 84 : 168,
        paddingInline: large ? 8 : 9,
        paddingBlock: large ? 6 : 5,
        border: 'none',
        borderRadius: 'var(--fx-radius-control)',
        background: 'transparent',
        color: command.disabled === true ? 'var(--fx-text-disabled)' : 'var(--fx-text-primary)',
        font: 'inherit',
        fontSize: 'var(--fx-caption)',
        cursor: command.disabled === true ? 'default' : 'pointer',
        textAlign: large ? 'center' : 'start',
      }}
    >
      {Glyph ? (
        <Glyph
          size={large ? 22 : 15}
          strokeWidth={large ? 1.4 : 1.7}
          style={{ color: command.disabled === true ? 'var(--fx-text-disabled)' : tint, flex: 'none' }}
        />
      ) : null}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>{command.label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

export type TimelineState = 'done' | 'active' | 'blocked' | 'waiting';

export interface TimelineGate {
  readonly label: ReactNode;
  readonly ok: boolean;
}

export interface TimelineStep {
  readonly id: string;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly state: TimelineState;
  /** Owner, date, duration — whatever the step is accountable to. */
  readonly meta?: ReactNode;
  /** The conditions this step is waiting on, each already evaluated. */
  readonly gates?: readonly TimelineGate[];
  readonly action?: ReactNode;
  /** Rendered under the step when it is the selected one. */
  readonly children?: ReactNode;
}

export interface TimelineProps {
  steps: readonly TimelineStep[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  label?: string;
}

const STATE_TONE: Record<TimelineState, Tone> = {
  done: 'success',
  active: 'accent',
  blocked: 'danger',
  waiting: 'neutral',
};

const STATE_GLYPH: Record<TimelineState, LucideIcon> = {
  done: Check,
  active: Circle,
  blocked: AlertTriangle,
  waiting: Circle,
};

/**
 * An ordered process, drawn as the order it runs in.
 *
 * A period close is a sequence with dependencies, and presenting it as a grid
 * sorted by name loses the only thing about it that matters: what is finished,
 * what is running, and what the running one is waiting for. The rail carries
 * that. Each segment is tinted by the step *above* it, so the filled length of
 * the rail is the progress through the sequence rather than a separate number
 * that can disagree with the rows.
 *
 * Every state is given a glyph as well as a colour. Red for blocked and green
 * for done is not a distinction a person with deuteranopia can make, and this
 * particular screen is the one where "blocked" has to be unmissable.
 */
export function Timeline({ steps, selected = null, onSelect, label }: TimelineProps) {
  const tr = useKitLabels();
  const stateWord: Record<TimelineState, string> = {
    done: tr('مكتمل', 'Terminé', 'Done'),
    active: tr('جارٍ', 'En cours', 'In progress'),
    blocked: tr('متوقف', 'Bloqué', 'Blocked'),
    waiting: tr('في الانتظار', 'En attente', 'Waiting'),
  };

  return (
    <ol aria-label={label} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
      {steps.map((step, index) => {
        const tone = STATE_TONE[step.state];
        const tint = toneColor(tone);
        const Glyph = STATE_GLYPH[step.state];
        const open = step.id === selected;
        const last = index === steps.length - 1;
        // The segment below a node belongs to the step it leaves, which is what
        // makes the rail fill as the sequence completes.
        const trail = step.state === 'done' ? toneColor('success') : 'var(--fx-stroke)';
        const head: CSSProperties = {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          width: '100%',
          border: 'none',
          background: open ? toneSurface(tone) : 'transparent',
          borderRadius: 'var(--fx-radius-control)',
          padding: '8px 10px',
          font: 'inherit',
          textAlign: 'start',
          cursor: onSelect === undefined ? 'default' : 'pointer',
          color: 'inherit',
        };
        const body = (
          <>
            <span
              aria-hidden="true"
              style={{
                position: 'relative',
                flex: 'none',
                width: 20,
                height: 20,
                marginTop: 1,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                background: step.state === 'waiting' ? 'transparent' : tint,
                border: `1.5px solid ${step.state === 'waiting' ? 'var(--fx-stroke-strong)' : tint}`,
                color: step.state === 'waiting' ? 'var(--fx-text-tertiary)' : 'var(--fx-on-accent)',
              }}
            >
              <Glyph
                size={step.state === 'active' ? 8 : 12}
                strokeWidth={3}
                fill={step.state === 'active' ? 'currentColor' : 'none'}
              />
            </span>
            <span style={{ minWidth: 0, flex: 1, display: 'grid', gap: 2 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--fx-body)', fontWeight: 600 }}>{step.title}</span>
                <span style={{ fontSize: 'var(--fx-caption)', color: tint, fontWeight: 600 }}>{stateWord[step.state]}</span>
                {step.meta !== undefined ? (
                  <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>{step.meta}</span>
                ) : null}
              </span>
              {step.detail !== undefined ? (
                <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>{step.detail}</span>
              ) : null}
              {step.gates !== undefined && step.gates.length > 0 ? (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                  {step.gates.map((gate, gateIndex) => (
                    <span
                      key={gateIndex}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 'var(--fx-caption)',
                        paddingInline: 6,
                        paddingBlock: 1,
                        borderRadius: 999,
                        background: toneSurface(gate.ok ? 'success' : 'warning'),
                        color: toneColor(gate.ok ? 'success' : 'warning'),
                      }}
                    >
                      {gate.ok ? <Check size={10} strokeWidth={3} /> : <AlertTriangle size={10} strokeWidth={2.5} />}
                      {gate.label}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            {step.action !== undefined ? <span style={{ flex: 'none' }}>{step.action}</span> : null}
          </>
        );

        return (
          <li key={step.id} style={{ position: 'relative', display: 'grid' }}>
            {last ? null : (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  // The node is 20px wide inside 10px of padding, so its centre
                  // is 20px in and the rail starts just under it.
                  insetInlineStart: 19,
                  top: 29,
                  bottom: 0,
                  width: 2,
                  background: trail,
                }}
              />
            )}
            {onSelect === undefined ? (
              <span style={head}>{body}</span>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-expanded={step.children === undefined ? undefined : open}
                style={head}
              >
                {body}
              </button>
            )}
            {open && step.children !== undefined ? (
              <div style={{ paddingInlineStart: 40, paddingBottom: 8 }}>{step.children}</div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * Document page
 * ------------------------------------------------------------------ */

export interface DocumentPageProps {
  children: ReactNode;
  /** Paper width in CSS pixels. A4 at 96 dpi is 794, US Letter 816. */
  width?: number;
  /** Printed margin, inside the paper's edge. */
  margin?: number;
  /** Running header, repeated at the top of the sheet. */
  header?: ReactNode;
  /** Running footer: page numbers, the basis of preparation, a signature line. */
  footer?: ReactNode;
  label?: string;
}

/**
 * A sheet of paper on a desk.
 *
 * Financial statements are the one output in the suite whose final form is a
 * printed page, and a statement laid out edge-to-edge in a resizable window is a
 * statement nobody can check against the version in the binder. So the column is
 * fixed at paper width, centred on a desk surface, with the margins and the
 * running header and footer the print will have.
 *
 * There is no zoom control, deliberately. Zoom by CSS transform does not change
 * layout, so the scroller around it ends up sized for the unscaled page, and
 * every honest alternative reflows the text — at which point it is no longer the
 * same page. `width` is the knob instead: an app that wants a wider sheet asks
 * for one, and what it gets back is a correct layout at that width.
 *
 * The paper is `--fx-solid`, not white. It is the only opaque surface token in
 * the set, and in the dark theme it is a dark sheet — which is what every
 * document reader now does, because a white rectangle in a dark room is a lamp.
 */
export function DocumentPage({ children, width = 794, margin = 56, header, footer, label }: DocumentPageProps) {
  const rule: CSSProperties = { borderColor: 'var(--fx-divider)', borderStyle: 'solid', borderWidth: 0 };
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        background: 'var(--fx-control)',
        padding: '20px 16px 32px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <article
        aria-label={label}
        style={{
          width,
          maxWidth: '100%',
          flex: 'none',
          background: 'var(--fx-solid)',
          color: 'var(--fx-text-primary)',
          boxShadow: 'var(--fx-shadow-card)',
          border: '1px solid var(--fx-stroke-card)',
          borderRadius: 2,
          paddingInline: margin,
          paddingBlock: Math.round(margin * 0.75),
          display: 'grid',
          alignContent: 'start',
          gap: 0,
        }}
      >
        {header !== undefined ? (
          <header
            style={{
              ...rule,
              borderBottomWidth: 1,
              paddingBottom: 10,
              marginBottom: 18,
              fontSize: 'var(--fx-caption)',
              color: 'var(--fx-text-secondary)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
            }}
          >
            {header}
          </header>
        ) : null}
        <div style={{ display: 'grid', gap: 16 }}>{children}</div>
        {footer !== undefined ? (
          <footer
            style={{
              ...rule,
              borderTopWidth: 1,
              paddingTop: 10,
              marginTop: 24,
              fontSize: 'var(--fx-caption)',
              color: 'var(--fx-text-tertiary)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
            }}
          >
            {footer}
          </footer>
        ) : null}
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Hero band
 * ------------------------------------------------------------------ */

export interface HeroFact {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly tone?: Tone;
}

export interface HeroBandProps {
  /** The one figure the screen is about, already formatted. */
  value: ReactNode;
  label: ReactNode;
  caption?: ReactNode;
  tone?: Tone;
  /** What gives the figure its shape — a runway curve, a trend, a gauge. */
  chart?: ReactNode;
  facts?: readonly HeroFact[];
  action?: ReactNode;
  /** Narrowest the chart may be before the band stacks. */
  chartMin?: number;
  /** Width reserved for the figure itself. */
  figureWidth?: number;
}

/**
 * One figure at display size, with the chart that explains it.
 *
 * Treasury's question is a single number — how many days of cash are left — and
 * a screen that opens on a twelve-column grid of transactions makes a person
 * compute it. Here the answer is the first thing on the screen at display type,
 * the curve behind it shows how it got there, and the grid moves below where it
 * belongs: the evidence, not the headline.
 */
export function HeroBand({
  value,
  label,
  caption,
  tone = 'accent',
  chart,
  facts,
  action,
  chartMin = 260,
  figureWidth = 260,
}: HeroBandProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const stacked = chart !== undefined && width > 0 && width < figureWidth + chartMin;
  const tint = toneColor(tone);

  return (
    <section
      ref={frame}
      className="fx-card"
      style={{
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'stretch' : 'center',
        gap: 18,
        padding: 18,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: chart === undefined ? 1 : `0 0 ${stacked ? 'auto' : `${figureWidth}px`}`, minWidth: 0, display: 'grid', gap: 6 }}>
        <span
          style={{
            fontSize: 'var(--fx-caption)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--fx-text-tertiary)',
          }}
        >
          {label}
        </span>
        <span
          className="fx-mono"
          style={{ fontSize: 'var(--fx-display)', fontWeight: 600, lineHeight: 1.05, color: tint, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {value}
        </span>
        {caption !== undefined ? (
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>{caption}</span>
        ) : null}
        {facts !== undefined && facts.length > 0 ? (
          <dl
            style={{
              margin: '6px 0 0',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(facts.length, stacked ? 2 : 1)}, minmax(0, 1fr))`,
              gap: '6px 16px',
            }}
          >
            {facts.map((fact, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <dt style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)', minWidth: 0 }}>{fact.label}</dt>
                <dd
                  className="fx-mono"
                  style={{
                    margin: 0,
                    marginInlineStart: 'auto',
                    fontSize: 'var(--fx-caption)',
                    fontWeight: 600,
                    color: fact.tone === undefined ? 'var(--fx-text-primary)' : toneColor(fact.tone),
                  }}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {action !== undefined ? <div style={{ marginTop: 6 }}>{action}</div> : null}
      </div>
      {chart !== undefined ? <div style={{ flex: 1, minWidth: 0 }}>{chart}</div> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Register
 * ------------------------------------------------------------------ */

export interface RegisterLine {
  readonly id: string;
  readonly account: ReactNode;
  readonly memo?: ReactNode;
  /** Formatted, or null for the side this line is not on. */
  readonly debit?: ReactNode;
  readonly credit?: ReactNode;
  readonly tone?: Tone;
}

export interface RegisterTotals {
  readonly debit: ReactNode;
  readonly credit: ReactNode;
  readonly balanced: boolean;
  /** Formatted difference, shown only when the two sides disagree. */
  readonly difference?: ReactNode;
}

export interface RegisterProps {
  lines: readonly RegisterLine[];
  totals: RegisterTotals;
  columns?: { account: ReactNode; memo: ReactNode; debit: ReactNode; credit: ReactNode };
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** A trailing row — usually the control that adds a line. */
  append?: ReactNode;
  label?: string;
}

/**
 * Debits on the left, credits on the right, and the two totals facing each other.
 *
 * This is the one layout in the suite that is genuinely a table, so it is one: a
 * real `<table>` with `scope="col"` headers and a `<tfoot>`, which is what lets a
 * screen reader say "Cash, debit, 4,500" instead of reading four unrelated cells.
 * The virtualised `DataGrid` is the right instrument for ten thousand rows and
 * the wrong one for a journal entry, which has four and has to balance.
 *
 * Balance is stated in words as well as in colour, for the same reason the
 * timeline gives every state a glyph — and because "balanced" is the single fact
 * that decides whether the entry can be posted at all.
 */
export function Register({ lines, totals, columns, selected = null, onSelect, append, label }: RegisterProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const tr = useKitLabels();
  // The memo is the first thing to go: an account and two figures are the entry.
  const showMemo = width === 0 || width >= 520;
  const heads = columns ?? {
    account: tr('الحساب', 'Compte', 'Account'),
    memo: tr('البيان', 'Libellé', 'Memo'),
    debit: tr('مدين', 'Débit', 'Debit'),
    credit: tr('دائن', 'Crédit', 'Credit'),
  };
  const cell: CSSProperties = { padding: '7px 10px', verticalAlign: 'top', fontSize: 'var(--fx-body)' };
  const num: CSSProperties = { ...cell, textAlign: 'end', width: 132, whiteSpace: 'nowrap' };
  const headCell: CSSProperties = {
    padding: '6px 10px',
    fontSize: 'var(--fx-caption)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color: 'var(--fx-text-tertiary)',
    textAlign: 'start',
    borderBottom: '1px solid var(--fx-divider)',
  };

  const balanceWord = totals.balanced
    ? tr('متوازن', 'Équilibré', 'Balanced')
    : tr('غير متوازن', 'Déséquilibré', 'Out of balance');
  const balanceStyle: CSSProperties = {
    ...cell,
    fontSize: 'var(--fx-caption)',
    fontWeight: 600,
    color: toneColor(totals.balanced ? 'success' : 'danger'),
  };

  return (
    <div ref={frame} className="fx-card" style={{ overflow: 'hidden' }}>
      <table aria-label={label} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead>
          <tr>
            <th scope="col" style={headCell}>{heads.account}</th>
            {showMemo ? <th scope="col" style={headCell}>{heads.memo}</th> : null}
            <th scope="col" style={{ ...headCell, textAlign: 'end' }}>{heads.debit}</th>
            <th scope="col" style={{ ...headCell, textAlign: 'end' }}>{heads.credit}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const chosen = line.id === selected;
            return (
              <tr
                key={line.id}
                aria-selected={onSelect === undefined ? undefined : chosen}
                tabIndex={onSelect === undefined ? undefined : 0}
                onClick={onSelect === undefined ? undefined : () => onSelect(line.id)}
                onKeyDown={
                  onSelect === undefined
                    ? undefined
                    : (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onSelect(line.id);
                      }
                }
                style={{
                  background: chosen ? toneSurface('accent') : undefined,
                  borderBottom: '1px solid var(--fx-divider)',
                  cursor: onSelect === undefined ? 'default' : 'pointer',
                  boxShadow: line.tone === undefined ? undefined : `inset 3px 0 0 ${toneColor(line.tone)}`,
                }}
              >
                <th scope="row" style={{ ...cell, fontWeight: 500, textAlign: 'start' }}>
                  {line.account}
                </th>
                {showMemo ? (
                  <td style={{ ...cell, color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)' }}>{line.memo}</td>
                ) : null}
                <td className="fx-mono" style={num}>{line.debit}</td>
                <td className="fx-mono" style={num}>{line.credit}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--fx-stroke-strong)', background: 'var(--fx-control)' }}>
            <th scope="row" style={{ ...cell, fontWeight: 600, textAlign: 'start' }}>
              {tr('الإجمالي', 'Total', 'Total')}
            </th>
            {showMemo ? (
              <td style={balanceStyle}>
                {balanceWord}
                {totals.balanced || totals.difference === undefined ? null : <> · {totals.difference}</>}
              </td>
            ) : null}
            <td className="fx-mono" style={{ ...num, fontWeight: 600 }}>{totals.debit}</td>
            <td className="fx-mono" style={{ ...num, fontWeight: 600 }}>{totals.credit}</td>
          </tr>
          {showMemo ? null : (
            <tr style={{ background: 'var(--fx-control)' }}>
              <td colSpan={3} style={balanceStyle}>
                {balanceWord}
                {totals.balanced || totals.difference === undefined ? null : <> · {totals.difference}</>}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
      {append !== undefined ? (
        <div style={{ padding: 8, borderTop: '1px solid var(--fx-divider)' }}>{append}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Variance row
 * ------------------------------------------------------------------ */

export interface VarianceRowProps {
  label: ReactNode;
  /** Signed variance. Used for geometry only — never printed. */
  value: number;
  /** The widest variance in the set, so every row shares one scale. */
  scale: number;
  /** The figure as the app formatted it. */
  display: ReactNode;
  /**
   * True when this variance is good news regardless of sign — under budget on a
   * cost line is favourable even though the number is negative. Omitted, the
   * sign decides.
   */
  favourable?: boolean;
  meta?: ReactNode;
  onClick?: () => void;
  /** Width reserved for the label column. */
  labelWidth?: number;
}

/**
 * One budget line, drawn against zero.
 *
 * A column of signed numbers makes a person find the big ones by reading all of
 * them. A bar that grows outward from a fixed centre makes the big ones the long
 * ones, and which side they fall on says over or under without a minus sign
 * having to be noticed. Every row in a set must be passed the same `scale`, or
 * the lengths stop being comparable, which is the only thing the drawing is for.
 *
 * `favourable` exists because the arithmetic sign is not the business meaning:
 * spending less than budgeted on a cost line is a negative variance and good
 * news. The colour follows the meaning; the figure beside it keeps the sign.
 *
 * The bar is `aria-hidden`: it is a second rendering of a number that is already
 * in the row as text, and announcing it twice is worse than not announcing it.
 */
export function VarianceRow({
  label,
  value,
  scale,
  display,
  favourable,
  meta,
  onClick,
  labelWidth = 180,
}: VarianceRowProps) {
  const safe = scale > 0 ? scale : 1;
  const extent = Math.min(1, Math.abs(value) / safe) * 50;
  const good = favourable ?? value >= 0;
  const tint = value === 0 ? 'var(--fx-text-tertiary)' : toneColor(good ? 'success' : 'danger');
  const shell: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '6px 8px',
    border: 'none',
    borderRadius: 'var(--fx-radius-control)',
    background: 'transparent',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    cursor: onClick === undefined ? 'default' : 'pointer',
  };

  const body = (
    <>
      <span style={{ flex: `0 0 ${labelWidth}px`, minWidth: 0, display: 'grid', gap: 1 }}>
        <span style={{ fontSize: 'var(--fx-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {meta !== undefined ? (
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>{meta}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 60,
          height: 14,
          borderRadius: 3,
          background: 'var(--fx-control)',
          overflow: 'hidden',
        }}
      >
        {/* Positive grows from the centre outward; negative ends at the centre. */}
        <span
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineStart: value >= 0 ? '50%' : `${50 - extent}%`,
            width: `${extent}%`,
            background: tint,
            opacity: 0.85,
          }}
        />
        <span style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 'calc(50% - 0.5px)', width: 1, background: 'var(--fx-stroke-strong)' }} />
      </span>
      <span className="fx-mono" style={{ flex: 'none', width: 108, textAlign: 'end', fontSize: 'var(--fx-body)', fontWeight: 600, color: tint }}>
        {display}
      </span>
    </>
  );

  return onClick === undefined ? (
    <div style={shell}>{body}</div>
  ) : (
    <button type="button" onClick={onClick} style={shell}>
      {body}
    </button>
  );
}
