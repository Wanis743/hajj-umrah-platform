/**
 * Ledger — the aside: one account in full, or the chart in summary.
 *
 * The general-ledger list is the part worth reading carefully. Lines arrive newest
 * first and capped, then `postingsOf` sorts them oldest-first to accumulate a
 * running balance — which means that when the cap bites, the balance in the list
 * starts from the middle of the account's history and is a window, not a position.
 * The pane says so rather than printing a number that looks like a closing balance.
 */
import { ClipboardCopy, CornerDownRight, Lock, Pencil, Power, PowerOff, Scale } from 'lucide-react';
import {
  Badge,
  BarChart,
  Button,
  InfoBar,
  KpiTile,
  PropertyRow,
  Spinner,
  fmt,
  useApp,
} from '@/platform/sdk';
import {
  type Account,
  ACCOUNT_TYPE_LABEL,
  accountLabel,
  type Currency,
  ENTRY_STATUS_LABEL,
  entryTone,
} from '../shared/ledger';
import type { LedgerBusy } from './actions';
import {
  type ChartTally,
  EPSILON,
  type Posting,
  POSTING_LIMIT,
  type Rollup,
  type TrialTotals,
  type TypeSlice,
} from './accounts';

export interface AccountDetailProps {
  readonly account: Account;
  readonly totals: Rollup;
  readonly parent: Account | null;
  readonly childCount: number;
  readonly postings: readonly Posting[];
  readonly loading: boolean;
  readonly currency: Currency;
  readonly busy: LedgerBusy;
  readonly onEdit: () => void;
  readonly onToggleActive: () => void;
  readonly onNewChild: () => void;
  readonly onCopy: () => void;
}

/**
 * One account: what it is, what it holds, and what has been posted to it.
 *
 * Neither button asks for confirmation. `account.update` is bound to `ledger.post`,
 * which the kernel treats as privileged, so it raises consent of its own before the
 * RPC runs — and a dialog in front of the kernel's own dialog is how people learn
 * to dismiss both without reading either.
 */
export function AccountDetail({
  account,
  totals,
  parent,
  childCount,
  postings,
  loading,
  currency,
  busy,
  onEdit,
  onToggleActive,
  onNewChild,
  onCopy,
}: AccountDetailProps) {
  const { t, tr, lang } = useApp().locale;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span className="fx-mono fx-title-ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
          {account.code}
        </span>
        <Badge tone={account.active ? 'accent' : 'neutral'}>{t(ACCOUNT_TYPE_LABEL[account.type])}</Badge>
      </div>
      <span className="fx-title-ellipsis" style={{ fontSize: 13 }}>
        {account.name}
      </span>

      <AccountFlags account={account} totals={totals} childCount={childCount} />

      <div>
        <PropertyRow label={tr('العملة', 'Devise', 'Currency')} mono>
          {account.currency}
        </PropertyRow>
        <PropertyRow label={tr('الحساب الأب', 'Compte parent', 'Parent')}>
          {parent === null ? tr('جذر', 'Racine', 'Root') : accountLabel(parent)}
        </PropertyRow>
        <PropertyRow label={tr('حسابات فرعية', 'Sous-comptes', 'Children')} mono>
          {fmt.integer(childCount, lang)}
        </PropertyRow>
        <PropertyRow label={tr('مدين', 'Débit', 'Debit')} mono>
          {fmt.money(totals.debit, currency, lang)}
        </PropertyRow>
        <PropertyRow label={tr('دائن', 'Crédit', 'Credit')} mono>
          {fmt.money(totals.credit, currency, lang)}
        </PropertyRow>
        <PropertyRow label={tr('الرصيد الخاص', 'Solde propre', 'Own balance')} mono>
          {fmt.money(totals.own, currency, lang)}
        </PropertyRow>
        {!totals.rolled ? null : (
          <PropertyRow label={tr('رصيد الفرع', 'Solde du sous-arbre', 'Branch balance')} mono>
            {fmt.money(totals.balance, currency, lang)}
          </PropertyRow>
        )}
        <PropertyRow label={tr('عدد الحركات', 'Mouvements', 'Postings')} mono>
          {fmt.integer(totals.lines, lang)}
        </PropertyRow>
      </div>

      <PostingList postings={postings} loading={loading} currency={currency} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Button size="sm" variant="accent" icon={Pencil} onClick={onEdit}>
          {tr('تعديل', 'Modifier', 'Edit')}
        </Button>
        <Button
          size="sm"
          variant={account.active ? 'danger' : 'default'}
          icon={account.active ? PowerOff : Power}
          busy={busy === 'active'}
          onClick={onToggleActive}
        >
          {account.active ? tr('إيقاف', 'Désactiver', 'Deactivate') : tr('تفعيل', 'Réactiver', 'Reactivate')}
        </Button>
        <Button size="sm" icon={CornerDownRight} onClick={onNewChild}>
          {tr('حساب فرعي', 'Sous-compte', 'New child')}
        </Button>
        <Button size="sm" variant="subtle" icon={ClipboardCopy} onClick={onCopy}>
          {tr('نسخ', 'Copier', 'Copy')}
        </Button>
      </div>
    </div>
  );
}

interface AccountFlagsProps {
  readonly account: Account;
  readonly totals: Rollup;
  readonly childCount: number;
}

/** The two facts that change what can be done to this account. */
function AccountFlags({ account, totals, childCount }: AccountFlagsProps) {
  const { tr, lang } = useApp().locale;
  return (
    <>
      {account.active ? null : (
        <InfoBar
          tone="warning"
          icon={PowerOff}
          title={tr('حساب موقوف', 'Compte inactif', 'Inactive account')}
        >
          {tr(
            'يحتفظ بتاريخه ورصيده، ولا يُعرض للاختيار في قيد جديد.',
            'Il garde son historique et son solde, mais n’est plus proposé dans une écriture.',
            'It keeps its history and its balance, but it is no longer offered on a new entry.',
          )}
        </InfoBar>
      )}
      {totals.lines === 0 ? null : (
        <InfoBar tone="info" icon={Lock} title={tr('النوع مثبّت', 'Nature verrouillée', 'Type is locked')}>
          {tr(
            `${fmt.integer(totals.lines, lang)} حركة مسجّلة، فتغيير النوع سيُرفض.`,
            `${fmt.integer(totals.lines, lang)} mouvement(s) enregistrés : changer la nature serait refusé.`,
            `${fmt.integer(totals.lines, lang)} posting(s) recorded, so a change of type would be refused.`,
          )}
        </InfoBar>
      )}
      {childCount === 0 || totals.rolled ? null : (
        <InfoBar tone="info" title={tr('حساب مجمّع', 'Compte de regroupement', 'Grouping account')}>
          {tr(
            'لا حركة عليه ولا على فروعه بعد.',
            'Ni lui ni ses enfants n’ont encore de mouvement.',
            'Neither it nor its children carry a posting yet.',
          )}
        </InfoBar>
      )}
    </>
  );
}

interface PostingListProps {
  readonly postings: readonly Posting[];
  readonly loading: boolean;
  readonly currency: Currency;
}

/**
 * The general ledger behind this account, oldest line first.
 *
 * Oldest first because a running balance printed against a newest-first list has to
 * be read bottom-up, and nobody does. When the page is full the balance is a window
 * into the middle of the account's history, and the bar above says so.
 */
function PostingList({ postings, loading, currency }: PostingListProps) {
  const { t, tr, lang } = useApp().locale;
  if (loading && postings.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
        <Spinner size={14} />
        <span style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}>
          {tr('تحميل الحركات…', 'Chargement des mouvements…', 'Loading postings…')}
        </span>
      </div>
    );
  }
  if (postings.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fx-text-secondary)', padding: '8px 0' }}>
        {tr('لا حركة على هذا الحساب.', 'Aucun mouvement sur ce compte.', 'Nothing has been posted here.')}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
      {postings.length < POSTING_LIMIT ? null : (
        <InfoBar tone="warning" title={tr('نافذة جزئية', 'Fenêtre partielle', 'Partial window')}>
          {tr(
            `أحدث ${String(POSTING_LIMIT)} حركة فقط، فالرصيد الجاري يبدأ من وسط التاريخ.`,
            `Seuls les ${String(POSTING_LIMIT)} derniers mouvements : le solde cumulé part du milieu de l’historique.`,
            `The latest ${String(POSTING_LIMIT)} postings only, so the running balance starts mid-history.`,
          )}
        </InfoBar>
      )}
      <div style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>
        {tr('الأقدم أولًا · الحركة ثم الرصيد', 'Du plus ancien · mouvement puis solde', 'Oldest first · movement, then balance')}
      </div>
      <div className="fx-scroll" style={{ flex: 1, minHeight: 110, overflowY: 'auto' }}>
        {postings.map((posting) => (
          <div
            key={posting.id}
            style={{
              padding: '6px 0',
              borderBottom: '1px solid var(--fx-stroke)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span className="fx-mono" style={{ fontSize: 11, color: 'var(--fx-text-secondary)' }}>
                {posting.date === '' ? '—' : fmt.date(posting.date, lang)}
              </span>
              <span className="fx-title-ellipsis" style={{ flex: 1, fontSize: 12 }}>
                {posting.reference === '' ? posting.description : posting.reference}
              </span>
              <span className="fx-mono fx-num" style={{ fontSize: 12 }}>
                {posting.movement === 0 ? '' : fmt.amount(posting.movement, lang)}
              </span>
              <span
                className="fx-mono fx-num"
                style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}
                title={fmt.money(posting.balance, currency, lang)}
              >
                {fmt.amount(posting.balance, lang)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <Badge tone={entryTone(posting.status)}>{t(ENTRY_STATUS_LABEL[posting.status])}</Badge>
              {posting.memo === '' ? null : (
                <span className="fx-title-ellipsis" style={{ fontSize: 11, color: 'var(--fx-text-secondary)' }}>
                  {posting.memo}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ChartOverviewProps {
  readonly tally: ChartTally;
  readonly slices: readonly TypeSlice[];
  readonly totals: TrialTotals;
  readonly currency: Currency;
}

/**
 * Nothing selected: the shape of the chart, rather than an empty pane.
 *
 * The bars are balances signed by each type's own nature, which is the only reason
 * five of them can share one axis. Raw debit-minus-credit would put revenue and
 * liabilities below the line, and the picture would then be about bookkeeping signs
 * instead of about size.
 */
export function ChartOverview({ tally, slices, totals, currency }: ChartOverviewProps) {
  const { t, tr, lang } = useApp().locale;
  const balanced = Math.abs(totals.difference) < EPSILON;
  const used = slices.filter((slice) => slice.accounts > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        {tr('نظرة على الدليل', 'Vue d’ensemble', 'Chart at a glance')}
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <KpiTile
          label={tr('حسابات محمّلة', 'Comptes chargés', 'Accounts loaded')}
          value={fmt.integer(tally.loaded, lang)}
          secondary={tr(
            `${fmt.integer(tally.loaded - tally.unused, lang)} بها حركة`,
            `${fmt.integer(tally.loaded - tally.unused, lang)} avec mouvements`,
            `${fmt.integer(tally.loaded - tally.unused, lang)} with postings`,
          )}
        />
        <KpiTile
          label={tr('غير مفعّلة', 'Inactifs', 'Inactive')}
          value={fmt.integer(tally.inactive, lang)}
          tone={tally.inactive === 0 ? 'neutral' : 'warning'}
          secondary={tr(
            `${fmt.integer(tally.active, lang)} مفعّل`,
            `${fmt.integer(tally.active, lang)} actifs`,
            `${fmt.integer(tally.active, lang)} active`,
          )}
        />
        <KpiTile
          label={tr('بلا حركة', 'Sans mouvement', 'Never posted to')}
          value={fmt.integer(tally.unused, lang)}
          tone="neutral"
          secondary={tr('يمكن تغيير نوعها', 'Nature encore modifiable', 'Type can still change')}
        />
        <KpiTile
          label={tr('الميزان', 'Balance', 'Trial balance')}
          value={balanced ? tr('متوازن', 'Équilibrée', 'Balanced') : fmt.money(totals.difference, currency, lang)}
          tone={balanced ? 'success' : 'warning'}
          icon={Scale}
          secondary={tr(
            `${fmt.integer(totals.lines, lang)} سطر`,
            `${fmt.integer(totals.lines, lang)} lignes`,
            `${fmt.integer(totals.lines, lang)} lines`,
          )}
        />
      </div>
      {used.length === 0 ? null : (
        <>
          <span style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>
            {tr(
              'الرصيد بحسب النوع · بإشارة طبيعته',
              'Solde par nature · signé par sa nature',
              'Balance by type · signed by its own nature',
            )}
          </span>
          <BarChart
            data={used.map((slice) => ({
              label: t(ACCOUNT_TYPE_LABEL[slice.type]),
              value: slice.balance,
            }))}
            orientation="horizontal"
            height={26 + used.length * 30}
            format={(value) => fmt.amount(value, lang)}
          />
        </>
      )}
      <div style={{ fontSize: 11, color: 'var(--fx-text-secondary)' }}>
        {tr(
          'اختر حسابًا لرؤية حركته ورصيده الجاري.',
          'Choisissez un compte pour voir ses mouvements et son solde cumulé.',
          'Pick an account to see its postings and its running balance.',
        )}
      </div>
    </div>
  );
}
