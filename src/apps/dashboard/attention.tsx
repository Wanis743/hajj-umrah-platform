/**
 * Dashboard — the attention pane.
 *
 * The one part of this window that is not a number. It is the answer to "is anything
 * wrong, and who has to do something about it", and it is the reason the app is worth
 * opening before the ledger itself.
 *
 * Three rules hold it together:
 *
 *   • Aggregated, never itemised. Eleven entries waiting on approval are one row that
 *     says eleven, with three references so it is not abstract. A list of eleven rows
 *     is a list nobody reads, and it is Inbox's job anyway.
 *   • Every row ends in a door. This app cannot approve, certify or post — it declares
 *     no privileged capability — so a row that could only be complained about would be
 *     a dead end. The button launches the app that owns the work, on the view that
 *     shows it.
 *   • Empty is a real state and it is drawn as one. A pane that renders nothing when
 *     nothing is wrong reads as broken.
 */
import { ArrowRight, Ban, BadgeCheck, CalendarRange, CheckCheck, Clock, ShieldAlert } from 'lucide-react';
import { Badge, Button, EmptyState, fmt, Section, toneColor, toneSurface, useApp } from '@/platform/sdk';
import {
  type AttentionItem,
  type AttentionKind,
  type Destination,
  type Snapshot,
  TO_APPROVALS,
  TO_CHART,
  TO_DRAFTS,
  TO_POSTED,
  TO_TRIAL,
} from './metrics';

/** A glyph per kind, so a row is recognisable before it is read. */
const KIND_ICON: Readonly<Record<AttentionKind, typeof ShieldAlert>> = {
  drift: ShieldAlert,
  unbalanced: ShieldAlert,
  closedPeriod: CalendarRange,
  approval: Clock,
  blocked: Ban,
  ready: BadgeCheck,
};

interface AttentionRowProps {
  readonly item: AttentionItem;
  onOpen: (destination: Destination) => void;
}

/** One fact, its count, a few of the things it is about, and the way through. */
function AttentionRow({ item, onOpen }: AttentionRowProps) {
  const { t, lang } = useApp().locale;
  const Glyph = KIND_ICON[item.kind];
  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        padding: 12,
        borderRadius: 6,
        background: toneSurface(item.tone),
        borderInlineStart: `3px solid ${toneColor(item.tone)}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Glyph size={14} color={toneColor(item.tone)} />
        <span style={{ fontWeight: 600, minWidth: 0 }}>{t(item.label)}</span>
        {item.count > 1 ? (
          <span style={{ marginInlineStart: 'auto' }}>
            <Badge tone={item.tone}>{fmt.integer(item.count, lang)}</Badge>
          </span>
        ) : null}
      </div>
      {item.sample.length === 0 ? null : (
        <div
          className="fx-mono"
          style={{
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.sample.join(', ')}
        >
          {item.sample.join(' · ')}
          {item.count > item.sample.length ? ` +${fmt.integer(item.count - item.sample.length, lang)}` : ''}
        </div>
      )}
      <div>
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(item.destination)}>
          {t(item.destination.label)}
        </Button>
      </div>
    </div>
  );
}

export interface AttentionPaneProps {
  readonly snap: Snapshot;
  onOpen: (destination: Destination) => void;
}

/** The pane: what needs a person, then the five doors out of this window. */
export function AttentionPane({ snap, onOpen }: AttentionPaneProps) {
  const { t, tr, lang } = useApp().locale;
  const links: readonly Destination[] = [TO_APPROVALS, TO_DRAFTS, TO_POSTED, TO_TRIAL, TO_CHART];
  return (
    <div style={{ display: 'grid', gap: 16, padding: 12, alignContent: 'start' }}>
      <Section
        title={tr('يحتاج إلى قرار', 'Demande une décision', 'Needs a person')}
        action={
          snap.attention.length === 0 ? null : (
            <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
              {fmt.integer(snap.attention.length, lang)}
            </span>
          )
        }
      >
        {snap.attention.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCheck}
            title={tr('لا شيء ينتظر', 'Rien en attente', 'Nothing is waiting')}
            description={tr(
              'الميزان متوازن، ولا قيد ينتظر اعتمادًا، ولا خطوة إقفال متعطّلة.',
              'La balance est équilibrée, aucune écriture n’attend d’approbation, aucune étape n’est bloquée.',
              'The balance adds up, no entry is waiting on approval, and no close step is blocked.',
            )}
          />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {snap.attention.map((item) => (
              <AttentionRow key={item.key} item={item} onOpen={onOpen} />
            ))}
          </div>
        )}
      </Section>
      <Section title={tr('الانتقال إلى', 'Aller à', 'Jump to')}>
        <div style={{ display: 'grid', gap: 6, justifyItems: 'stretch' }}>
          {links.map((destination) => (
            <Button
              key={`${destination.app}:${destination.command ?? ''}`}
              size="sm"
              variant="subtle"
              icon={ArrowRight}
              onClick={() => onOpen(destination)}
            >
              {t(destination.label)}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
