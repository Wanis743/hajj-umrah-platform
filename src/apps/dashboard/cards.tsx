/**
 * Dashboard — the money pages: overview, position, performance.
 *
 * Every figure on these three pages comes from the trial balance, which the broker
 * aggregates over the posted lines of the whole book. That has two consequences the
 * pages are built around rather than around which they are drawn:
 *
 *   • No date dimension, so no comparatives. There is no "vs last month" arrow on any
 *     tile here, because there is no last month to compare to without a second query
 *     the schema cannot answer. A delta invented from nothing is worse than no delta.
 *   • One `currency_code` per account. When the page holds more than one, the totals
 *     above added currencies together without a rate, and an info bar says so instead
 *     of letting a confident number stand.
 *
 * The account tables show the largest balances rather than all of them: the whole
 * chart is Ledger's window, one button away, and a dashboard that renders five hundred
 * rows is a dashboard that scrolls instead of answering.
 */
import type { CSSProperties } from 'react';
import {
  ArrowRight,
  Clock,
  Landmark,
  ListChecks,
  PiggyBank,
  Scale,
  Sigma,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  BarChart,
  type BarDatum,
  Button,
  Card,
  type Column,
  colorAt,
  DataGrid,
  DonutChart,
  type DonutSlice,
  EmptyState,
  fmt,
  InfoBar,
  KpiTile,
  LineChart,
  ProgressBar,
  PropertyRow,
  StackedBar,
  useApp,
  Waterfall,
  type WaterfallStep,
} from '@/platform/sdk';
import {
  type AccountType,
  ACCOUNT_TYPE_LABEL,
  EPSILON,
  toCurrency,
  type TrialRow,
} from '../shared/ledger';
import {
  accountDestination,
  type Destination,
  type Formatters,
  type Snapshot,
  TO_APPROVALS,
  TO_CHECKLIST,
  TO_POSTED,
  TO_TRIAL,
  topBalances,
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

/** The natures that make up the balance sheet, in statement order. */
const BALANCE_TYPES: readonly AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY'];
const INCOME_TYPES: readonly AccountType[] = ['REVENUE', 'EXPENSE'];

/** How many accounts a table on this window shows before deferring to Ledger. */
const TABLE_ROWS = 12;

/** Says out loud that the totals above added two currencies without a rate. */
function MixedCurrencyBar({ currencies }: { readonly currencies: readonly string[] }) {
  const { tr } = useApp().locale;
  if (currencies.length <= 1) return null;
  return (
    <InfoBar
      tone="warning"
      icon={Sigma}
      title={tr('عملات مختلطة', 'Devises mélangées', 'Mixed currencies')}
    >
      {tr(
        `يضم الميزان حسابات بـ ${currencies.join(' و ')}. المجاميع أعلاه جمعتها دون سعر صرف.`,
        `La balance contient des comptes en ${currencies.join(' et ')}. Les totaux ci-dessus les ont additionnés sans taux de change.`,
        `The balance holds accounts in ${currencies.join(' and ')}. The totals above added them without an exchange rate.`,
      )}
    </InfoBar>
  );
}

interface AccountTableProps {
  readonly rows: readonly TrialRow[];
  readonly types: readonly AccountType[];
  onOpen: (destination: Destination) => void;
}

/**
 * The largest balances of a few natures.
 *
 * Each amount is written in its own account's currency rather than the book's, because
 * that is what the row actually holds — the totals above are where the mixing happens,
 * and this table is where a person checks it. Double-click opens the account in Ledger.
 */
function AccountTable({ rows, types, onOpen }: AccountTableProps) {
  const { t, tr, lang } = useApp().locale;
  const shown = rows
    .filter((row) => types.includes(row.type) && Math.abs(row.balance) >= EPSILON)
    .slice()
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, TABLE_ROWS);
  const money = (value: number, row: TrialRow): string => fmt.money(value, toCurrency(row.currency), lang);
  const columns: readonly Column<TrialRow>[] = [
    {
      id: 'code',
      header: tr('رمز', 'Code', 'Code'),
      width: 96,
      mono: true,
      render: (row) => row.code,
      sort: (a, b) => a.code.localeCompare(b.code),
    },
    {
      id: 'name',
      header: tr('الحساب', 'Compte', 'Account'),
      render: (row) => row.name,
      sort: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'type',
      header: tr('الطبيعة', 'Nature', 'Nature'),
      width: 118,
      render: (row) => <Badge>{t(ACCOUNT_TYPE_LABEL[row.type])}</Badge>,
    },
    {
      id: 'lines',
      header: tr('سطور', 'Lignes', 'Lines'),
      width: 78,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.lines, lang),
      sort: (a, b) => a.lines - b.lines,
    },
    {
      id: 'balance',
      header: tr('الرصيد', 'Solde', 'Balance'),
      width: 148,
      align: 'end',
      mono: true,
      render: (row) => money(row.balance, row),
      sort: (a, b) => Math.abs(a.balance) - Math.abs(b.balance),
    },
  ];
  if (shown.length === 0) {
    return (
      <EmptyState
        compact
        icon={Sigma}
        title={tr('لا أرصدة', 'Aucun solde', 'No balances')}
        description={tr(
          'لا يوجد سطر معتمد على حسابات هذه الطبيعة بعد.',
          'Aucune ligne comptabilisée sur des comptes de cette nature.',
          'No posted line has landed on an account of this nature yet.',
        )}
      />
    );
  }
  return (
    <DataGrid
      rows={shown}
      columns={columns}
      rowKey={(row) => row.accountId}
      density="compact"
      onActivate={(row) => onOpen(accountDestination(row.accountId))}
    />
  );
}

export interface PageProps {
  readonly snap: Snapshot;
  /** Locale-aware formatting, shared with the status bar and the clipboard summary. */
  readonly f: Formatters;
  onOpen: (destination: Destination) => void;
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

/**
 * The four numbers somebody wants before their first meeting, and three pictures.
 *
 * The tiles that lead somewhere are clickable and the ones that do not are not: assets
 * open the trial balance, the result opens the posted entries, the backlog opens the
 * approvals queue. Cash has no window of its own in this suite yet, so it stays inert
 * rather than pretending.
 */
export function OverviewPage({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const p = snap.position;
  const waiting = snap.activity.waiting.length;
  return (
    <div style={PAGE}>
      <MixedCurrencyBar currencies={p.currencies} />
      <div style={KPI_GRID}>
        <KpiTile
          label={t(ACCOUNT_TYPE_LABEL.ASSET)}
          value={f.money(p.assets)}
          secondary={tr('حتى تاريخه', 'À ce jour', 'Book to date')}
          icon={Landmark}
          onClick={() => onOpen(TO_TRIAL)}
        />
        <KpiTile
          label={tr('النتيجة', 'Résultat', 'Result')}
          value={f.money(p.result)}
          secondary={
            p.margin === null
              ? tr('لا إيراد بعد', 'Aucun produit', 'Nothing earned yet')
              : tr(`الهامش ${f.percent(p.margin)}`, `Marge ${f.percent(p.margin)}`, `${f.percent(p.margin)} margin`)
          }
          icon={p.result >= 0 ? TrendingUp : TrendingDown}
          tone={p.result >= 0 ? 'success' : 'danger'}
          onClick={() => onOpen(TO_POSTED)}
        />
        <KpiTile
          label={tr('النقد', 'Trésorerie', 'Cash')}
          value={f.money(snap.cash.total)}
          secondary={tr(
            `${f.integer(snap.cash.accounts)} حساب بنكي`,
            `${f.integer(snap.cash.accounts)} comptes bancaires`,
            `${f.integer(snap.cash.accounts)} bank accounts`,
          )}
          icon={Wallet}
        />
        <KpiTile
          label={tr('في انتظار الاعتماد', 'En attente', 'Waiting on approval')}
          value={f.integer(waiting)}
          secondary={tr('في النطاق المحدّد', 'Dans la portée', 'In the current range')}
          icon={Clock}
          tone={waiting === 0 ? 'success' : 'warning'}
          onClick={() => onOpen(TO_APPROVALS)}
        />
      </div>
      <OverviewCharts snap={snap} f={f} onOpen={onOpen} />
    </div>
  );
}

/**
 * The three pictures under the tiles.
 *
 * The trend is labelled *volume*, and it counts entries rather than adding up money,
 * because `journal_lines` carries no date: a revenue-by-month series would have to
 * join four thousand lines to five hundred entries in the browser and would still be
 * wrong for anything older than the page the broker returned. Counting entries is
 * something the entries themselves can answer exactly.
 */
function OverviewCharts({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const p = snap.position;
  const months = snap.activity.months;
  const slices: readonly DonutSlice[] = p.byType
    .filter((total) => BALANCE_TYPES.includes(total.type) && Math.abs(total.total) >= EPSILON)
    .map((total, index) => ({
      label: t(ACCOUNT_TYPE_LABEL[total.type]),
      value: Math.abs(total.total),
      color: colorAt(index),
    }));
  return (
    <>
      <div style={CARD_GRID}>
        <Card
          title={tr('الميزانية بالطبيعة', 'Bilan par nature', 'Balance sheet by nature')}
          subtitle={tr('حتى تاريخه', 'À ce jour', 'Book to date')}
          icon={Scale}
        >
          {slices.length === 0 ? (
            <EmptyState
              compact
              icon={Scale}
              title={tr('لا أرصدة', 'Aucun solde', 'No balances')}
              description={tr(
                'لا قيود معتمدة على حسابات الميزانية بعد.',
                'Aucune écriture comptabilisée sur les comptes de bilan.',
                'Nothing has been posted to a balance-sheet account yet.',
              )}
            />
          ) : (
            <DonutChart
              slices={slices}
              size={168}
              thickness={20}
              format={f.money}
              center={
                <div style={{ textAlign: 'center' }}>
                  <div className="fx-mono" style={{ fontWeight: 600 }}>
                    {f.money(p.assets)}
                  </div>
                  <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
                    {t(ACCOUNT_TYPE_LABEL.ASSET)}
                  </div>
                </div>
              }
            />
          )}
        </Card>
        <Card
          title={tr('حجم الترحيل', 'Volume d’écritures', 'Posting volume')}
          subtitle={tr('عدد القيود بالشهر', 'Nombre d’écritures par mois', 'Entries per month, not money')}
          icon={TrendingUp}
        >
          {months.length < 2 ? (
            <EmptyState
              compact
              icon={TrendingUp}
              title={tr('لا يكفي للرسم', 'Pas assez de données', 'Not enough to draw')}
              description={tr(
                'يحتاج الرسم إلى شهرين على الأقل داخل النطاق.',
                'Il faut au moins deux mois dans la portée.',
                'A trend needs at least two months inside the range.',
              )}
            />
          ) : (
            <LineChart
              categories={months.map((point) => point.label)}
              series={[
                { label: tr('قيود', 'Écritures', 'Entries'), values: months.map((point) => point.count) },
                {
                  label: tr('معتمدة', 'Comptabilisées', 'Posted'),
                  values: months.map((point) => point.posted),
                  color: colorAt(1),
                },
              ]}
              height={196}
              format={f.integer}
            />
          )}
        </Card>
      </div>
      <CloseGlance snap={snap} f={f} onOpen={onOpen} />
    </>
  );
}

/** The checklist in one bar, because the close is the one deadline on this window. */
function CloseGlance({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const close = snap.close;
  if (close.total === 0) return null;
  const done = close.certified === close.total;
  return (
    <Card
      title={tr('الإقفال', 'Clôture', 'The close')}
      subtitle={`${f.integer(close.certified)} / ${f.integer(close.total)} · ${f.percent(close.ratio)}`}
      icon={ListChecks}
      actions={
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_CHECKLIST)}>
          {t(TO_CHECKLIST.label)}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <ProgressBar value={close.ratio} tone={done ? 'success' : 'accent'} height={6} />
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-secondary)',
          }}
        >
          {close.next === null ? (
            <span>
              {done
                ? tr('كل الخطوات مصدّقة.', 'Toutes les étapes sont certifiées.', 'Every step is certified.')
                : tr('لا خطوة جاهزة الآن.', 'Aucune étape prête.', 'No step is ready right now.')}
            </span>
          ) : (
            <span>
              {tr('التالية', 'Suivante', 'Next')}: <strong>{close.next.task.name}</strong>
            </span>
          )}
          {close.blocked.length === 0 ? null : (
            <span>
              {tr('متعطّلة', 'Bloquées', 'Blocked')}: {f.integer(close.blocked.length)}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Position
 * ------------------------------------------------------------------ */

/**
 * The balance sheet, as far as a trial balance can state one.
 *
 * The fourth tile is the drift — assets less everything that funds them — and it sits
 * up here with the other three rather than in the status bar alone, because it is the
 * one figure that invalidates the rest of the page. When it is not zero the tile turns
 * red and the identity card below shows which side is short.
 */
export function PositionPage({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const p = snap.position;
  return (
    <div style={PAGE}>
      <MixedCurrencyBar currencies={p.currencies} />
      <div style={KPI_GRID}>
        <KpiTile
          label={t(ACCOUNT_TYPE_LABEL.ASSET)}
          value={f.money(p.assets)}
          secondary={tr(
            `${f.integer(p.accounts)} حساب في الميزان`,
            `${f.integer(p.accounts)} comptes dans la balance`,
            `${f.integer(p.accounts)} accounts in the balance`,
          )}
          icon={Landmark}
          onClick={() => onOpen(TO_TRIAL)}
        />
        <KpiTile
          label={t(ACCOUNT_TYPE_LABEL.LIABILITY)}
          value={f.money(p.liabilities)}
          secondary={tr('ما على الدفتر', 'Ce que le livre doit', 'What the book owes')}
          icon={Scale}
        />
        <KpiTile
          label={t(ACCOUNT_TYPE_LABEL.EQUITY)}
          value={f.money(p.equity)}
          secondary={tr(
            `والنتيجة ${f.money(p.result)}`,
            `plus résultat ${f.money(p.result)}`,
            `plus ${f.money(p.result)} of result`,
          )}
          icon={PiggyBank}
        />
        <DriftTile snap={snap} f={f} onOpen={onOpen} />
      </div>
      <PositionCards snap={snap} f={f} onOpen={onOpen} />
    </div>
  );
}

/** Assets less what funds them: zero on a healthy book, and loud when it is not. */
function DriftTile({ snap, f, onOpen }: PageProps) {
  const { tr } = useApp().locale;
  const p = snap.position;
  const off = p.accounts > 0 && !p.balanced;
  return (
    <KpiTile
      label={tr('الفرق', 'Écart', 'Drift')}
      value={f.money(p.drift)}
      secondary={
        off
          ? tr('الأصول لا تساوي تمويلها', 'L’actif n’égale pas son financement', 'Assets do not equal their funding')
          : tr('الميزان متوازن', 'La balance est équilibrée', 'The balance adds up')
      }
      icon={Sigma}
      tone={off ? 'danger' : 'success'}
      onClick={off ? () => onOpen(TO_POSTED) : undefined}
    />
  );
}

/**
 * The identity, the cash, and the largest balances.
 *
 * The waterfall is the accounting identity drawn as a walk: assets, then each thing
 * that funds them subtracted, and whatever survives is the drift. On a book that adds
 * up the last bar is a hairline, which is exactly the point — a person reads the
 * picture and does not have to trust the tile.
 */
function PositionCards({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const p = snap.position;
  const steps: readonly WaterfallStep[] = [
    { label: t(ACCOUNT_TYPE_LABEL.ASSET), value: p.assets, kind: 'total' },
    { label: t(ACCOUNT_TYPE_LABEL.LIABILITY), value: -p.liabilities },
    { label: t(ACCOUNT_TYPE_LABEL.EQUITY), value: -p.equity },
    { label: tr('النتيجة', 'Résultat', 'Result'), value: -p.result },
    { label: tr('الفرق', 'Écart', 'Drift'), value: p.drift, kind: 'total' },
  ];
  const split: readonly BarDatum[] = [
    { label: tr('مدين', 'Débit', 'Debits'), value: p.debits, color: colorAt(0) },
    { label: tr('دائن', 'Crédit', 'Credits'), value: p.credits, color: colorAt(1) },
  ];
  return (
    <>
      <div style={CARD_GRID}>
        <Card
          title={tr('المعادلة', 'L’identité', 'The identity')}
          subtitle={tr('الأصول ناقص تمويلها', 'Actif moins son financement', 'Assets less their funding')}
          icon={Scale}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <Waterfall steps={steps} height={188} format={f.money} />
            <div style={{ display: 'grid', gap: 2 }}>
              <PropertyRow label={tr('مدين', 'Débit', 'Debits')} mono>
                {f.money(p.debits)}
              </PropertyRow>
              <PropertyRow label={tr('دائن', 'Crédit', 'Credits')} mono>
                {f.money(p.credits)}
              </PropertyRow>
            </div>
            <StackedBar segments={split} height={8} format={f.money} />
          </div>
        </Card>
        <CashCard snap={snap} f={f} onOpen={onOpen} />
      </div>
      <BalanceTableCard snap={snap} f={f} onOpen={onOpen} />
    </>
  );
}

/** How many bank accounts the cash card names before it stops. */
const CASH_ROWS = 5;

/**
 * Cash, one line per currency, then the largest accounts.
 *
 * Nothing here is converted. A book with a SAR account and a DZD account gets two
 * lines, each written in its own currency, and the tile on the overview says which
 * one of them it is showing. Adding them would need a rate this app does not have.
 */
function CashCard({ snap, f }: PageProps) {
  const { tr, lang } = useApp().locale;
  const cash = snap.cash;
  const money = (value: number, currency: string): string => fmt.money(value, toCurrency(currency), lang);
  return (
    <Card
      title={tr('النقد', 'Trésorerie', 'Cash')}
      subtitle={tr(
        `${f.integer(cash.accounts)} حساب نشط`,
        `${f.integer(cash.accounts)} comptes actifs`,
        `${f.integer(cash.accounts)} active accounts`,
      )}
      icon={Wallet}
    >
      {cash.rows.length === 0 ? (
        <EmptyState
          compact
          icon={Wallet}
          title={tr('لا حساب بنكي', 'Aucun compte bancaire', 'No bank account')}
          description={tr(
            'لا حساب بنكي نشط على هذا الدفتر.',
            'Aucun compte bancaire actif sur ce livre.',
            'This book has no active bank account.',
          )}
        />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            {cash.byCurrency.map((total) => (
              <PropertyRow key={total.currency} label={`${total.currency} · ${f.integer(total.accounts)}`} mono>
                {money(total.total, total.currency)}
              </PropertyRow>
            ))}
          </div>
          <CashRows snap={snap} f={f} />
        </div>
      )}
    </Card>
  );
}

interface CashRowsProps {
  readonly snap: Snapshot;
  readonly f: Formatters;
}

/** The five largest bank accounts, each in the currency it is kept in. */
function CashRows({ snap, f }: CashRowsProps) {
  const { tr, lang } = useApp().locale;
  const rows = snap.cash.rows;
  const hidden = rows.length - CASH_ROWS;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.slice(0, CASH_ROWS).map((account) => (
        <div key={account.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span
            style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={`${account.name} · ${account.institution}`}
          >
            {account.name}
          </span>
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {account.institution}
          </span>
          <span className="fx-mono" style={{ marginInlineStart: 'auto', whiteSpace: 'nowrap' }}>
            {fmt.money(account.current, toCurrency(account.currency), lang)}
          </span>
        </div>
      ))}
      {hidden <= 0 ? null : (
        <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
          {tr(
            `و${f.integer(hidden)} حسابًا آخر`,
            `et ${f.integer(hidden)} autres comptes`,
            `and ${f.integer(hidden)} more accounts`,
          )}
        </span>
      )}
    </div>
  );
}

/** The largest balance-sheet accounts, with the door to the whole trial balance. */
function BalanceTableCard({ snap, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  return (
    <Card
      title={tr('أكبر الأرصدة', 'Les plus gros soldes', 'Largest balances')}
      subtitle={tr(
        `أعلى ${TABLE_ROWS} حسابًا من الأصول والخصوم ورأس المال`,
        `Les ${TABLE_ROWS} premiers comptes d’actif, de passif et de capitaux propres`,
        `Top ${TABLE_ROWS} asset, liability and equity accounts`,
      )}
      icon={Landmark}
      actions={
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_TRIAL)}>
          {t(TO_TRIAL.label)}
        </Button>
      }
      padded={false}
    >
      <AccountTable rows={snap.trial} types={BALANCE_TYPES} onOpen={onOpen} />
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Performance
 * ------------------------------------------------------------------ */

/**
 * What the book earned and what it spent doing so.
 *
 * The margin is null rather than zero when nothing has been earned yet, and the tile
 * writes an em dash instead of "0.0 %" — a margin on no revenue is not a margin, and
 * a zero there reads as a business that sold something and made nothing.
 */
export function PerformancePage({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const p = snap.position;
  const earning = p.revenue > EPSILON;
  return (
    <div style={PAGE}>
      <MixedCurrencyBar currencies={p.currencies} />
      <div style={KPI_GRID}>
        <KpiTile
          label={t(ACCOUNT_TYPE_LABEL.REVENUE)}
          value={f.money(p.revenue)}
          secondary={tr('حتى تاريخه', 'À ce jour', 'Book to date')}
          icon={TrendingUp}
          onClick={() => onOpen(TO_POSTED)}
        />
        <KpiTile
          label={t(ACCOUNT_TYPE_LABEL.EXPENSE)}
          value={f.money(p.expense)}
          secondary={
            earning
              ? tr(
                  `${f.percent(p.expense / p.revenue)} من الإيراد`,
                  `${f.percent(p.expense / p.revenue)} du produit`,
                  `${f.percent(p.expense / p.revenue)} of revenue`,
                )
              : tr('لا إيراد للمقارنة', 'Aucun produit à comparer', 'No revenue to compare against')
          }
          icon={TrendingDown}
        />
        <KpiTile
          label={tr('النتيجة', 'Résultat', 'Result')}
          value={f.money(p.result)}
          secondary={tr('الإيراد ناقص المصروف', 'Produits moins charges', 'Revenue less expense')}
          icon={p.result >= 0 ? TrendingUp : TrendingDown}
          tone={p.result >= 0 ? 'success' : 'danger'}
        />
        <MarginTile snap={snap} f={f} onOpen={onOpen} />
      </div>
      <PerformanceCards snap={snap} f={f} onOpen={onOpen} />
    </div>
  );
}

/** The margin, or an em dash when there is no revenue for one to be a share of. */
function MarginTile({ snap, f }: PageProps) {
  const { tr } = useApp().locale;
  const margin = snap.position.margin;
  return (
    <KpiTile
      label={tr('الهامش', 'Marge', 'Margin')}
      value={margin === null ? '—' : f.percent(margin)}
      secondary={
        margin === null
          ? tr('لا إيراد بعد', 'Aucun produit', 'Nothing earned yet')
          : tr('النتيجة ÷ الإيراد', 'Résultat ÷ produits', 'Result over revenue')
      }
      icon={Sigma}
      tone={margin === null ? 'neutral' : margin >= 0 ? 'success' : 'danger'}
    />
  );
}

/**
 * Revenue to result as a walk, then where each side of it comes from.
 *
 * The two bar charts are horizontal because account names are long and a rotated label
 * is a label nobody reads. They are drawn from absolute balances: a revenue account is
 * credit-natured and an expense account is debit-natured, so plotting the raw signed
 * figure would put the two charts on opposite sides of zero for no reason.
 */
function PerformanceCards({ snap, f, onOpen }: PageProps) {
  const { t, tr } = useApp().locale;
  const p = snap.position;
  const steps: readonly WaterfallStep[] = [
    { label: t(ACCOUNT_TYPE_LABEL.REVENUE), value: p.revenue, kind: 'total' },
    { label: t(ACCOUNT_TYPE_LABEL.EXPENSE), value: -p.expense },
    { label: tr('النتيجة', 'Résultat', 'Result'), value: p.result, kind: 'total' },
  ];
  return (
    <>
      <div style={CARD_GRID}>
        <Card
          title={tr('من الإيراد إلى النتيجة', 'Du produit au résultat', 'Revenue to result')}
          subtitle={tr('حتى تاريخه', 'À ce jour', 'Book to date')}
          icon={Sigma}
        >
          <Waterfall steps={steps} height={196} format={f.money} />
        </Card>
        <Card
          title={tr('أكبر الإيرادات', 'Principaux produits', 'Largest revenue')}
          subtitle={tr('بالقيمة المطلقة', 'En valeur absolue', 'By absolute balance')}
          icon={TrendingUp}
        >
          <NatureBars rows={snap.trial} type="REVENUE" f={f} />
        </Card>
        <Card
          title={tr('أكبر المصروفات', 'Principales charges', 'Largest expenses')}
          subtitle={tr('بالقيمة المطلقة', 'En valeur absolue', 'By absolute balance')}
          icon={TrendingDown}
        >
          <NatureBars rows={snap.trial} type="EXPENSE" f={f} />
        </Card>
      </div>
      <Card
        title={tr('حسابات النتيجة', 'Comptes de résultat', 'Income accounts')}
        subtitle={tr(
          `أعلى ${TABLE_ROWS} حسابًا من الإيرادات والمصروفات`,
          `Les ${TABLE_ROWS} premiers comptes de produits et de charges`,
          `Top ${TABLE_ROWS} revenue and expense accounts`,
        )}
        icon={Sigma}
        actions={
          <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_TRIAL)}>
            {t(TO_TRIAL.label)}
          </Button>
        }
        padded={false}
      >
        <AccountTable rows={snap.trial} types={INCOME_TYPES} onOpen={onOpen} />
      </Card>
    </>
  );
}

interface NatureBarsProps {
  readonly rows: readonly TrialRow[];
  readonly type: AccountType;
  readonly f: Formatters;
}

/** The largest accounts of one nature, one colour, largest first. */
function NatureBars({ rows, type, f }: NatureBarsProps) {
  const { t, tr } = useApp().locale;
  const top = topBalances(rows, type);
  if (top.length === 0) {
    return (
      <EmptyState
        compact
        icon={Sigma}
        title={tr('لا حركة', 'Aucun mouvement', 'Nothing here yet')}
        description={tr(
          `لا سطر معتمد على حسابات ${t(ACCOUNT_TYPE_LABEL[type])}.`,
          `Aucune ligne comptabilisée sur les comptes de ${t(ACCOUNT_TYPE_LABEL[type])}.`,
          `No posted line has landed on a ${t(ACCOUNT_TYPE_LABEL[type]).toLowerCase()} account.`,
        )}
      />
    );
  }
  const color = type === 'REVENUE' ? colorAt(0) : colorAt(1);
  const data: readonly BarDatum[] = top.map((row) => ({
    label: row.name,
    value: Math.abs(row.balance),
    color,
  }));
  return <BarChart data={data} orientation="horizontal" height={196} format={f.money} />;
}
