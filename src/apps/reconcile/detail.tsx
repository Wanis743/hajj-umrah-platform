/**
 * Reconciliation — the pane that makes the case.
 *
 * The grid says which lines are open; this says what each one might be, and why. The
 * "why" is the entire reason a suggestion is trustworthy: a bare score is a number
 * nobody can check, whereas "same amount, same direction, same reference" is a claim
 * a person can agree or disagree with in a second. So every candidate carries its
 * signals, in reading order, and the score itself is never shown.
 *
 * Three states, three components. Nothing selected gets the statement in four
 * numbers, because the question then is "how far off am I", not "what is this line".
 * A matched line gets its counterpart and the one act that can undo it. An open line
 * gets the ranked list — and under it, the near misses, which exist to be read and
 * never to be pressed.
 *
 * The near-miss list is the part that earns its keep on a real statement. A line
 * 150,00 heavier than the entry it obviously belongs to is a bank charge nobody
 * booked; the answer is a journal entry, not a match, and an interface that only ever
 * showed legal pairings would leave somebody staring at an unexplained difference.
 */
import {
  Ban,
  BadgeCheck,
  BookOpen,
  Check,
  CircleSlash,
  ClipboardCopy,
  ExternalLink,
  Landmark,
  Lock,
  Scale,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Badge, Button, EmptyState, fmt, InfoBar, KpiTile, PropertyRow, Section, useApp } from '@/platform/sdk';
import {
  type BankAccount,
  type BankStatement,
  type BankTransaction,
  type Currency,
  MATCH_STATE_LABEL,
  matchTone,
  STATEMENT_STATUS_LABEL,
  statementTone,
} from '../shared/ledger';
import type { ReconcileBusy } from './actions';
import {
  type Candidate,
  type CandidateSet,
  CONFIDENCE_LABEL,
  confidenceTone,
  isAgreed,
  isEligible,
  type LedgerRow,
  NEAR_DAYS,
  type Reconciliation,
  SIGNAL_LABEL,
} from './match';

/** The pane's gutter, matched to the aside's own padding. */
const PANE: CSSProperties = { display: 'grid', gap: 14, alignContent: 'start' };

const CARD: CSSProperties = { display: 'grid', gap: 6, padding: 10, cursor: 'default' };

const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };

const CAPTION: CSSProperties = { fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' };

const LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'var(--fx-accent-text)',
  cursor: 'default',
  textAlign: 'start',
  minWidth: 0,
};

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

interface LineHeadProps {
  readonly transaction: BankTransaction;
  readonly currency: Currency;
}

/** The line, as a bank would read it aloud: date, side, amount, state. */
function LineHead({ transaction, currency }: LineHeadProps) {
  const { t, tr, lang } = useApp().locale;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={ROW}>
        <span className="fx-mono" style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600 }}>
          {fmt.money(transaction.amount, currency, lang)}
        </span>
        <Badge tone={transaction.kind === 'debit' ? 'success' : 'neutral'}>
          {transaction.kind === 'debit' ? tr('مدين', 'Débit', 'Debit') : tr('دائن', 'Crédit', 'Credit')}
        </Badge>
        <Badge tone={matchTone(transaction.state)}>{t(MATCH_STATE_LABEL[transaction.state])}</Badge>
      </div>
      <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-secondary)' }}>
        {transaction.description === '' ? tr('بلا بيان', 'Sans libellé', 'No detail') : transaction.description}
      </span>
    </div>
  );
}

interface LineFactsProps {
  readonly transaction: BankTransaction;
}

function LineFacts({ transaction }: LineFactsProps) {
  const { tr, lang } = useApp().locale;
  return (
    <div>
      <PropertyRow label={tr('التاريخ', 'Date', 'Date')}>{fmt.date(transaction.date, lang)}</PropertyRow>
      <PropertyRow label={tr('المرجع', 'Référence', 'Reference')} mono>
        {transaction.reference === '' ? '—' : transaction.reference}
      </PropertyRow>
      <PropertyRow label={tr('المعرّف', 'Identifiant', 'Identifier')} mono>
        {transaction.id}
      </PropertyRow>
    </div>
  );
}

interface LedgerLineProps {
  readonly row: LedgerRow;
  readonly currency: Currency;
  onOpenAccount: () => void;
}

/** A ledger row as a line of prose: what it hits, what it says, what it moved. */
function LedgerLine({ row, currency, onOpenAccount }: LedgerLineProps) {
  const { tr, lang } = useApp().locale;
  return (
    <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
      <div style={ROW}>
        <span className="fx-mono">{row.date === '' ? '—' : fmt.date(row.date, lang)}</span>
        <span style={{ flex: 1 }} />
        <span className="fx-num" style={{ fontWeight: 600 }}>
          {fmt.money(row.amount, currency, lang)}
        </span>
      </div>
      <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-secondary)' }}>
        {row.line.memo === '' ? tr('بلا بيان', 'Sans libellé', 'No memo') : row.line.memo}
      </span>
      <div style={{ ...ROW, ...CAPTION }}>
        <button type="button" style={LINK} onClick={onOpenAccount} title={row.accountLabel}>
          <span className="fx-title-ellipsis">{row.accountLabel === '' ? tr('الحساب', 'Compte', 'Account') : row.accountLabel}</span>
          <ExternalLink size={11} aria-hidden />
        </button>
        {row.reference === '' ? null : <span className="fx-mono fx-title-ellipsis">{row.reference}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One candidate
 * ------------------------------------------------------------------ */

interface CandidateCardProps {
  readonly candidate: Candidate;
  readonly currency: Currency;
  readonly picked: boolean;
  readonly busy: ReconcileBusy;
  /** False for a near miss: shown, explained, and not offered. */
  readonly actionable: boolean;
  onPick: () => void;
  onMatch: () => void;
  onOpenAccount: () => void;
}

/**
 * One possible counterpart, with the argument for it.
 *
 * The card is the pick target and the button is the act, which keeps "I am looking at
 * this one" separate from "pair them" — the same separation a mail client makes
 * between opening a message and answering it. `Ctrl+Enter` acts on whatever is
 * picked, so the two gestures meet again at the keyboard.
 */
function CandidateCard({
  candidate,
  currency,
  picked,
  busy,
  actionable,
  onPick,
  onMatch,
  onOpenAccount,
}: CandidateCardProps) {
  const { t, tr, lang } = useApp().locale;
  const gap = Math.abs(candidate.delta);
  const far = candidate.days !== null && candidate.days > NEAR_DAYS;
  return (
    <div
      className="fx-card"
      style={{ ...CARD, outline: picked ? '1px solid var(--fx-accent)' : undefined }}
      onClick={onPick}
    >
      <div style={ROW}>
        <Badge tone={confidenceTone(candidate.confidence)}>{t(CONFIDENCE_LABEL[candidate.confidence])}</Badge>
        <span style={{ flex: 1 }} />
        {isAgreed(gap) ? null : (
          <span className="fx-num" style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-danger)' }}>
            {candidate.delta > 0 ? '+' : '−'}
            {fmt.money(gap, currency, lang)}
          </span>
        )}
      </div>
      <LedgerLine row={candidate.row} currency={currency} onOpenAccount={onOpenAccount} />
      <span style={CAPTION}>
        {candidate.signals.length === 0
          ? tr('لا شيء يربط السطرين.', 'Rien ne relie les deux lignes.', 'Nothing ties the two lines together.')
          : candidate.signals.map((signal) => t(SIGNAL_LABEL[signal])).join(' · ')}
      </span>
      {far ? (
        <span style={{ ...CAPTION, color: 'var(--fx-warning)' }}>
          {tr(
            `${fmt.integer(candidate.days ?? 0, lang)} يومًا من الفرق`,
            `${fmt.integer(candidate.days ?? 0, lang)} jours d’écart`,
            `${fmt.integer(candidate.days ?? 0, lang)} days apart`,
          )}
        </span>
      ) : null}
      {actionable ? (
        <div>
          <Button
            size="sm"
            variant={picked ? 'accent' : undefined}
            icon={Check}
            busy={busy === 'match'}
            onClick={onMatch}
          >
            {tr('مطابقة', 'Rapprocher', 'Match')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * An open line
 * ------------------------------------------------------------------ */

interface OpenDetailProps {
  readonly transaction: BankTransaction;
  readonly candidates: CandidateSet;
  readonly currency: Currency;
  readonly candidateId: string | null;
  readonly busy: ReconcileBusy;
  readonly ledgerLoading: boolean;
  onPick: (lineId: string) => void;
  onMatch: (candidate: Candidate) => void;
  onOpenAccount: (accountId: string) => void;
  onCommand: (id: string) => void;
}

/**
 * The line, what it could be, and what it nearly is.
 *
 * When the list is empty the four server-side rules are stated, because "no
 * candidates" without them reads as a broken app rather than as a book that has not
 * been written yet. They are the actual reasons — amount within a centime, entry
 * posted, line not already reconciled — so the sentence is checkable.
 */
export function OpenDetail({
  transaction,
  candidates,
  currency,
  candidateId,
  busy,
  ledgerLoading,
  onPick,
  onMatch,
  onOpenAccount,
  onCommand,
}: OpenDetailProps) {
  const { tr, lang } = useApp().locale;
  const { matches, near } = candidates;
  return (
    <div style={PANE}>
      <LineHead transaction={transaction} currency={currency} />
      <LineFacts transaction={transaction} />
      <Section
        title={tr('مرشّحون', 'Candidats', 'Candidates')}
        action={
          <span style={CAPTION}>
            {ledgerLoading
              ? tr('جارٍ التحميل…', 'Chargement…', 'Loading…')
              : fmt.integer(matches.length, lang)}
          </span>
        }
      >
        {matches.length === 0 ? (
          <InfoBar tone="info" icon={CircleSlash} title={tr('لا مرشّح مقبول', 'Aucun candidat recevable', 'No candidate the server would take')}>
            {tr(
              'يشترط الخادم مبلغًا مطابقًا في حدود سنتيم، وقيدًا مرحّلًا، وسطرًا غير مطابق سابقًا. لا سطر على هذه الصفحة يحقّق الثلاثة.',
              'Le serveur exige un montant identique à un centime près, une écriture comptabilisée et une ligne non déjà rapprochée. Aucune ligne de cette page ne remplit les trois.',
              'The server insists on an amount equal to within a centime, a posted entry, and a line not already reconciled. Nothing on this page satisfies all three.',
            )}
          </InfoBar>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {matches.map((candidate) => (
              <CandidateCard
                key={candidate.row.line.id}
                candidate={candidate}
                currency={currency}
                picked={candidate.row.line.id === candidateId}
                busy={busy}
                actionable
                onPick={() => onPick(candidate.row.line.id)}
                onMatch={() => onMatch(candidate)}
                onOpenAccount={() => {
                  const accountId = candidate.row.line.accountId;
                  if (accountId !== null) onOpenAccount(accountId);
                }}
              />
            ))}
          </div>
        )}
      </Section>
      {near.length === 0 ? null : (
        <Section title={tr('قريب ولا يُطابق', 'Proches, non rapprochables', 'Close, and not matchable')}>
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={CAPTION}>
              {tr(
                'المبلغ لا يتّفق، والخادم يرفض. الفرق هنا عادةً رسم بنكي لم يُقيَّد.',
                'Les montants divergent et le serveur refuse. L’écart est le plus souvent un frais bancaire non comptabilisé.',
                'The amounts disagree, and the server refuses. A gap like this is usually a bank charge nobody booked.',
              )}
            </span>
            {near.map((candidate) => (
              <CandidateCard
                key={candidate.row.line.id}
                candidate={candidate}
                currency={currency}
                picked={false}
                busy={busy}
                actionable={false}
                onPick={() => undefined}
                onMatch={() => undefined}
                onOpenAccount={() => {
                  const accountId = candidate.row.line.accountId;
                  if (accountId !== null) onOpenAccount(accountId);
                }}
              />
            ))}
          </div>
        </Section>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" icon={ClipboardCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ السطر', 'Copier', 'Copy line')}
        </Button>
        <Button size="sm" icon={BookOpen} onClick={() => onCommand('open-account')}>
          {tr('فتح الدفتر', 'Ouvrir le livre', 'Open Ledger')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A settled line
 * ------------------------------------------------------------------ */

interface SettledDetailProps {
  readonly transaction: BankTransaction;
  readonly counterpart: LedgerRow | null;
  readonly currency: Currency;
  readonly locked: boolean;
  readonly busy: ReconcileBusy;
  onUnmatch: () => void;
  onOpenAccount: (accountId: string) => void;
  onCommand: (id: string) => void;
}

/**
 * What this line was tied to, and the one way back.
 *
 * A locked statement says so before the button is reached rather than after it is
 * pressed: `unmatch_bank_transaction` refuses outright on `LOCKED`, because reversing
 * a match there would restate a reconciliation somebody has already signed off.
 *
 * The counterpart can be absent even on a matched line — the ledger page is capped,
 * and the entry may sit outside it. That is stated as a page limit rather than shown
 * as a missing link, which is a different and much more alarming claim.
 */
export function SettledDetail({
  transaction,
  counterpart,
  currency,
  locked,
  busy,
  onUnmatch,
  onOpenAccount,
  onCommand,
}: SettledDetailProps) {
  const { tr, lang } = useApp().locale;
  const ignored = transaction.state === 'ignored';
  return (
    <div style={PANE}>
      <LineHead transaction={transaction} currency={currency} />
      <LineFacts transaction={transaction} />
      {ignored ? (
        <InfoBar tone="info" icon={CircleSlash} title={tr('سطر مستثنى', 'Ligne écartée', 'Set aside')}>
          {tr(
            'قرّر أحدهم أن هذا السطر لا يحتاج مقابلًا في الدفتر.',
            'Quelqu’un a décidé que cette ligne n’a pas de contrepartie à trouver.',
            'Somebody decided this line needs no counterpart in the book.',
          )}
        </InfoBar>
      ) : (
        <Section
          title={tr('المقابل', 'Contrepartie', 'Counterpart')}
          action={
            transaction.matchedAt === null ? null : <span style={CAPTION}>{fmt.dateTime(transaction.matchedAt, lang)}</span>
          }
        >
          {counterpart === null ? (
            <InfoBar tone="warning" icon={ShieldAlert}>
              {tr(
                'السطر المقابل خارج الصفحة المحمّلة من الدفتر.',
                'La ligne contrepartie est hors de la page chargée du livre.',
                'The matched ledger line is outside the loaded ledger page.',
              )}
            </InfoBar>
          ) : (
            <div className="fx-card" style={CARD}>
              <LedgerLine
                row={counterpart}
                currency={currency}
                onOpenAccount={() => {
                  const accountId = counterpart.line.accountId;
                  if (accountId !== null) onOpenAccount(accountId);
                }}
              />
            </div>
          )}
        </Section>
      )}
      {locked ? (
        <InfoBar tone="warning" icon={Lock} title={tr('كشف مقفل', 'Relevé verrouillé', 'The statement is locked')}>
          {tr(
            'لا يمكن إلغاء المطابقة على كشف مقفل: تمّ التصديق عليه.',
            'Impossible d’annuler un rapprochement sur un relevé verrouillé : il a été validé.',
            'A match on a locked statement cannot be reversed — it has been signed off.',
          )}
        </InfoBar>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="sm"
          icon={Ban}
          busy={busy === 'unmatch'}
          disabled={locked || ignored}
          onClick={onUnmatch}
        >
          {tr('إلغاء المطابقة', 'Annuler', 'Unmatch')}
        </Button>
        <Button size="sm" icon={ClipboardCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ', 'Copier', 'Copy')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Nothing selected
 * ------------------------------------------------------------------ */

interface OverviewProps {
  readonly account: BankAccount | null;
  readonly statement: BankStatement | null;
  readonly summary: Reconciliation;
  readonly ledgerRows: readonly LedgerRow[];
  readonly currency: Currency;
  readonly planCount: number;
}

/**
 * The exercise in four numbers, and the one sentence that names the next move.
 *
 * The difference leads, because it is the answer. Under it sit the two things that
 * explain it — open statement lines and unreconciled book lines — and the count the
 * machine can clear on its own, which is the cheapest thing anybody can do next.
 */
export function Overview({ account, statement, summary, ledgerRows, currency, planCount }: OverviewProps) {
  const { t, tr, lang } = useApp().locale;
  if (account === null) {
    return (
      <div style={PANE}>
        <EmptyState
          icon={Landmark}
          title={tr('لا حساب بنكي', 'Aucun compte bancaire', 'No bank account')}
          description={tr(
            'أضف حسابًا بنكيًا وكشفًا لتبدأ المطابقة.',
            'Ajoutez un compte bancaire et un relevé pour commencer.',
            'Add a bank account and a statement to begin.',
          )}
        />
      </div>
    );
  }
  const loose = ledgerRows.filter(isEligible).length;
  const agreed = isAgreed(summary.difference);
  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600 }}>{account.name}</span>
        <span style={{ ...ROW, ...CAPTION }}>
          {statement === null ? (
            tr('لا كشف', 'Aucun relevé', 'No statement')
          ) : (
            <>
              {fmt.date(statement.date, lang)}
              <Badge tone={statementTone(statement.status)}>{t(STATEMENT_STATUS_LABEL[statement.status])}</Badge>
            </>
          )}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
        <KpiTile
          tone={agreed ? 'success' : 'danger'}
          icon={Scale}
          label={tr('الفرق', 'Écart', 'Difference')}
          value={agreed ? tr('متوازن', 'Rapproché', 'Agreed') : fmt.money(summary.difference, currency, lang)}
          secondary={tr('الكشف ناقص الدفتر', 'Relevé moins livre', 'Statement less book')}
        />
        <KpiTile
          tone={summary.open === 0 ? 'success' : 'warning'}
          icon={CircleSlash}
          label={tr('أسطر معلّقة', 'Lignes en suspens', 'Open lines')}
          value={fmt.integer(summary.open, lang)}
          secondary={summary.open === 0 ? undefined : fmt.money(summary.openValue, currency, lang)}
        />
        <KpiTile
          icon={BookOpen}
          label={tr('في الدفتر', 'Au livre', 'In the ledger')}
          value={fmt.integer(loose, lang)}
          secondary={tr('مرحّل وغير مطابق', 'Comptabilisé, non rapproché', 'Posted, unreconciled')}
        />
        <KpiTile
          tone={planCount === 0 ? 'neutral' : 'success'}
          icon={BadgeCheck}
          label={tr('مطابقة تلقائية', 'Automatique', 'Auto-match')}
          value={fmt.integer(planCount, lang)}
          secondary={
            planCount === 0
              ? tr('لا شيء مؤكد', 'Rien de certain', 'Nothing certain')
              : tr('بضغطة واحدة', 'En un geste', 'One press away')
          }
        />
      </div>
      {statement === null ? null : (
        <div>
          <PropertyRow label={tr('الرصيد الافتتاحي', 'Solde initial', 'Opening')}>
            {fmt.money(statement.opening, currency, lang)}
          </PropertyRow>
          <PropertyRow label={tr('حركة الكشف', 'Mouvement du relevé', 'Statement movement')}>
            {fmt.money(summary.movement, currency, lang)}
          </PropertyRow>
          <PropertyRow label={tr('الرصيد الختامي', 'Solde final', 'Closing')}>
            {fmt.money(statement.closing, currency, lang)}
          </PropertyRow>
          <PropertyRow label={tr('حركة الدفتر', 'Mouvement du livre', 'Book movement')}>
            {fmt.money(summary.bookMovement, currency, lang)}
          </PropertyRow>
        </div>
      )}
      {summary.drift === null || isAgreed(summary.drift) ? null : (
        <InfoBar
          tone="danger"
          icon={ShieldAlert}
          title={tr('الكشف لا يتوازن', 'Le relevé ne s’équilibre pas', 'The statement does not add up')}
        >
          {tr(
            `الافتتاحي زائد الحركة يبعد ${fmt.money(summary.drift, currency, lang)} عن الختامي. هذه مشكلة في بيانات الكشف، ولن تحلّها أي مطابقة.`,
            `Solde initial plus mouvement s’écarte de ${fmt.money(summary.drift, currency, lang)} du solde final. C’est un problème de données du relevé ; aucun rapprochement ne le corrigera.`,
            `Opening plus movement misses closing by ${fmt.money(summary.drift, currency, lang)}. That is a problem with the statement's own figures, and no amount of matching will fix it.`,
          )}
        </InfoBar>
      )}
      {agreed ? (
        <InfoBar tone="success" icon={Wallet}>
          {tr(
            'الجانبان متّفقان. الكشف جاهز للتصديق.',
            'Les deux côtés concordent. Le relevé peut être validé.',
            'Both sides agree. This statement is ready to be signed off.',
          )}
        </InfoBar>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The pane
 * ------------------------------------------------------------------ */

export interface MatchPaneProps {
  readonly transaction: BankTransaction | null;
  readonly candidates: CandidateSet;
  readonly counterpart: LedgerRow | null;
  readonly account: BankAccount | null;
  readonly statement: BankStatement | null;
  readonly summary: Reconciliation;
  readonly ledgerRows: readonly LedgerRow[];
  readonly currency: Currency;
  readonly candidateId: string | null;
  readonly busy: ReconcileBusy;
  readonly ledgerLoading: boolean;
  readonly planCount: number;
  onPick: (lineId: string) => void;
  onMatch: (candidate: Candidate) => void;
  onUnmatch: () => void;
  onOpenAccount: (accountId: string) => void;
  onCommand: (id: string) => void;
}

export function MatchPane({
  transaction,
  candidates,
  counterpart,
  account,
  statement,
  summary,
  ledgerRows,
  currency,
  candidateId,
  busy,
  ledgerLoading,
  planCount,
  onPick,
  onMatch,
  onUnmatch,
  onOpenAccount,
  onCommand,
}: MatchPaneProps) {
  if (transaction === null) {
    return (
      <Overview
        account={account}
        statement={statement}
        summary={summary}
        ledgerRows={ledgerRows}
        currency={currency}
        planCount={planCount}
      />
    );
  }
  if (transaction.state === 'unmatched') {
    return (
      <OpenDetail
        transaction={transaction}
        candidates={candidates}
        currency={currency}
        candidateId={candidateId}
        busy={busy}
        ledgerLoading={ledgerLoading}
        onPick={onPick}
        onMatch={onMatch}
        onOpenAccount={onOpenAccount}
        onCommand={onCommand}
      />
    );
  }
  return (
    <SettledDetail
      transaction={transaction}
      counterpart={counterpart}
      currency={currency}
      locked={statement !== null && statement.status === 'locked'}
      busy={busy}
      onUnmatch={onUnmatch}
      onOpenAccount={onOpenAccount}
      onCommand={onCommand}
    />
  );
}
