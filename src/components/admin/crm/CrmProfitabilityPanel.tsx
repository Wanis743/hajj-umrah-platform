/**
 * Customer profitability, with its own caveat printed next to it.
 *
 * get_crm_customer_profitability builds each row from the customer's bookings, the
 * payments collected against them, and the customer's share of their group's
 * POSTED expense lines -- cost_basis GROUP_EXPENSE_PER_TRAVELLER. That share is
 * the only assumption in the figure, and it is the server's, not this screen's.
 *
 * cost_dzd, margin_dzd and margin_pct go null together whenever a customer's
 * groups carry no posted expense lines. They render as an em dash: an unknown cost
 * is not a zero cost, and a zero cost would print a 100% margin on every customer
 * whose group expenses have not been booked yet.
 *
 * cost_coverage_pct is the honesty column. Below 100 it means only part of the
 * booked value had ledger cost behind it, so the margin beside it is provisional.
 * The screen says so per row and again under the table, because a margin read as
 * final when it is partial is worse than no margin at all.
 */
import { useMemo, useState } from 'react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { crmAnalytics } from '@/services/crmAnalytics';
import type { CrmCustomerProfitability, CrmCustomerProfitabilityRow } from '@/types/crm';
import { Panel, Pill, Tile } from './atoms';
import { DASH, fmtDate, fmtInt, fmtMoney, fmtPct, isoDaysAgo, isoToday, toneForStatus, useCrmI18n, useCrmRead } from './crmFormat';

const LIMITS: readonly number[] = [25, 50, 100, 200];

/** Coverage decides how a margin may be read: complete, partial, or absent. */
function coverageTone(pct: number | null): 'good' | 'warn' | 'neutral' {
  if (pct === null) return 'neutral';
  if (pct >= 100) return 'good';
  return 'warn';
}

export function CrmProfitabilityPanel() {
  const { t } = useCrmI18n();
  const [from, setFrom] = useState(isoDaysAgo(365));
  const [to, setTo] = useState(isoToday());
  const [limit, setLimit] = useState(50);
  const view = useCrmRead<CrmCustomerProfitability>(
    () => crmAnalytics.customerProfitability(from, to, limit),
    [from, to, limit],
  );

  // Memoised for identity, not for cost: `?? []` would hand the reducer below a
  // fresh array on every render and the memo under it would never hold.
  const rows = useMemo(() => view.data?.customers ?? [], [view.data]);

  // Sums over the rows on screen, in one currency. Nothing derived: no aggregate
  // margin percentage is printed, because the rows with a null cost cannot be
  // added to the ones without breaking what the total would mean.
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    booked: acc.booked + r.booked_dzd,
    collected: acc.collected + r.collected_dzd,
    outstanding: acc.outstanding + r.outstanding_dzd,
    covered: acc.covered + ((r.cost_coverage_pct ?? 0) >= 100 ? 1 : 0),
    costed: acc.costed + (r.cost_dzd === null ? 0 : 1),
  }), { booked: 0, collected: 0, outstanding: 0, covered: 0, costed: 0 }), [rows]);

  return (
    <Panel
      title={t('ربحية العملاء', 'Rentabilité clients', 'Customer profitability')}
      subtitle={t(
        'الكلفة = نصيب العميل من مصاريف مجموعته المُرحَّلة في دفتر الأستاذ',
        'Coût = part du client dans les dépenses comptabilisées de son groupe',
        'Cost is the customer’s share of their group’s posted ledger expenses',
      )}
      actions={(
        <>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input w-auto"
            aria-label={t('من', 'Du', 'From')}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input w-auto"
            aria-label={t('إلى', 'Au', 'To')}
          />
          <Select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="input w-auto"
            aria-label={t('عدد الأسطر', 'Nombre de lignes', 'Row limit')}
          >
            {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { view.reload(); }}>
            {t('تحديث', 'Rafraîchir', 'Refresh')}
          </button>
        </>
      )}
    >
      {view.error && <ErrorBanner message={view.error} onRetry={() => { view.reload(); }} />}

      {view.loading && view.data === null ? (
        <Spinner className="p-6" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا عملاء في هذه الفترة', 'Aucun client sur la période', 'No customers in this window')}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={t('محجوز (دج)', 'Réservé (DZD)', 'Booked (DZD)')}
              value={fmtMoney(totals.booked)}
              hint={t(
                `${rows.length} عميلاً معروضاً`,
                `${rows.length} clients affichés`,
                `${rows.length} customers shown`,
              )}
            />
            <Tile
              label={t('محصَّل (دج)', 'Encaissé (DZD)', 'Collected (DZD)')}
              value={fmtMoney(totals.collected)}
            />
            <Tile
              label={t('متبقٍ (دج)', 'Reste (DZD)', 'Outstanding (DZD)')}
              value={fmtMoney(totals.outstanding)}
              tone={totals.outstanding > 0 ? 'warn' : 'good'}
            />
            <Tile
              label={t('تغطية الكلفة', 'Couverture des coûts', 'Cost coverage')}
              value={`${fmtInt(totals.covered)} / ${fmtInt(rows.length)}`}
              hint={t(
                `${fmtInt(totals.costed)} سطراً له كلفة مسجَّلة`,
                `${fmtInt(totals.costed)} lignes avec un coût enregistré`,
                `${fmtInt(totals.costed)} rows carry a recorded cost`,
              )}
              tone={totals.covered === rows.length ? 'good' : 'warn'}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="table min-w-[1020px]">
              <thead>
                <tr>
                  <th>{t('العميل', 'Client', 'Customer')}</th>
                  <th>{t('أول بيع', 'Première vente', 'First won')}</th>
                  <th className="end">{t('حجوزات', 'Rés.', 'Bookings')}</th>
                  <th className="end">{t('معتمرون', 'Pèlerins', 'Travellers')}</th>
                  <th className="end">{t('محجوز', 'Réservé', 'Booked')}</th>
                  <th className="end">{t('محصَّل', 'Encaissé', 'Collected')}</th>
                  <th className="end">{t('متبقٍ', 'Reste', 'Outstanding')}</th>
                  <th className="end">{t('الكلفة', 'Coût', 'Cost')}</th>
                  <th className="end">{t('الهامش', 'Marge', 'Margin')}</th>
                  <th className="end">{t('التغطية', 'Couverture', 'Coverage')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <ProfitRow key={r.customer_id} row={r} />)}
              </tbody>
            </table>
          </div>

          <BasisNote payload={view.data} />
        </div>
      )}
    </Panel>
  );
}

/** One customer. The margin cell has three states, not two: a figure, a figure
 *  marked provisional, or an em dash when no posted cost exists for the groups the
 *  customer travelled with. The third state is not a zero margin. */
function ProfitRow({ row }: { row: CrmCustomerProfitabilityRow }) {
  const { t } = useCrmI18n();
  const known = row.cost_dzd !== null && row.margin_dzd !== null;
  const partial = known && (row.cost_coverage_pct ?? 0) < 100;
  const negative = known && (row.margin_dzd ?? 0) < 0;

  return (
    <tr>
      <td>
        <span className="block">{row.full_name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className="tabular">{row.code}</span>
          <span>{row.customer_type}</span>
          <Pill tone={toneForStatus(row.status)}>{row.status}</Pill>
          {row.phone && <span className="tabular">{row.phone}</span>}
        </span>
      </td>
      <td className="whitespace-nowrap text-[12px]">{fmtDate(row.first_won_at)}</td>
      <td className="end tabular text-end">{fmtInt(row.bookings)}</td>
      <td className="end tabular text-end">{fmtInt(row.travelers)}</td>
      <td className="end tabular text-end">{fmtMoney(row.booked_dzd)}</td>
      <td className="end tabular text-end">{fmtMoney(row.collected_dzd)}</td>
      <td className={`end tabular text-end ${row.outstanding_dzd > 0 ? 'text-[var(--warning)]' : ''}`}>
        {fmtMoney(row.outstanding_dzd)}
      </td>
      <td className="end tabular text-end">{fmtMoney(row.cost_dzd)}</td>
      <td className="end text-end">
        <span className={`tabular ${negative ? 'text-[var(--danger)]' : ''}`}>{fmtMoney(row.margin_dzd)}</span>
        <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
          {known
            ? fmtPct(row.margin_pct)
            : t('لا كلفة مُرحَّلة', 'Aucun coût comptabilisé', 'no posted cost')}
        </span>
      </td>
      <td className="end text-end">
        <Pill
          tone={coverageTone(row.cost_coverage_pct)}
          title={partial
            ? t('الهامش مؤقَّت', 'Marge provisoire', 'The margin is provisional')
            : undefined}
        >
          {fmtPct(row.cost_coverage_pct)}
        </Pill>
        {partial && (
          <span className="mt-0.5 block text-[11px] text-[var(--warning)]">
            {t('مؤقَّت', 'provisoire', 'provisional')}
          </span>
        )}
      </td>
    </tr>
  );
}

/** The basis, and the two ways a figure here can be incomplete. Printed under the
 *  table because a margin without its cost basis is a number, not information. */
function BasisNote({ payload }: { payload: CrmCustomerProfitability | null }) {
  const { t } = useCrmI18n();
  if (payload === null) return null;
  return (
    <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
      {t(
        `الفترة ${fmtDate(payload.from)} — ${fmtDate(payload.to)}، أعلى ${payload.limit} عميلاً. `
        + `أساس الكلفة: ${payload.cost_basis} بعملة ${payload.cost_currency}. `
        + `التغطية دون 100٪ تعني أن جزءاً من القيمة المحجوزة فقط له مصاريف مُرحَّلة، فالهامش مؤقَّت. `
        + `و${DASH} في عمود الكلفة تعني غياب أي مصروف مُرحَّل، لا كلفة صفراً.`,
        `Période ${fmtDate(payload.from)} — ${fmtDate(payload.to)}, top ${payload.limit} clients. `
        + `Base de coût : ${payload.cost_basis} en ${payload.cost_currency}. `
        + 'Une couverture inférieure à 100 % signifie qu’une partie seulement de la valeur réservée '
        + `porte des dépenses comptabilisées : la marge est provisoire. Un ${DASH} en colonne coût `
        + 'signifie aucune dépense comptabilisée, pas un coût nul.',
        `Window ${fmtDate(payload.from)} — ${fmtDate(payload.to)}, top ${payload.limit} customers. `
        + `Cost basis: ${payload.cost_basis} in ${payload.cost_currency}. `
        + 'Coverage below 100% means only part of the booked value had posted expenses behind it, so the '
        + `margin beside it is provisional. A ${DASH} in the cost column means no posted expense at all, `
        + 'not a zero cost.',
      )}
    </p>
  );
}

