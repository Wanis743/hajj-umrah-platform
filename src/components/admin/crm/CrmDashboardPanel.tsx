import { useState } from 'react';
import { AlertTriangle, CalendarClock, Flame, Megaphone, Target, UserPlus, Users } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { crmAnalytics } from '@/services/crmAnalytics';
import type { CrmDashboard } from '@/types/crm';
import { Meter, Panel, Pill, Tile } from './atoms';
import { DASH, fmtDate, fmtDateTime, fmtInt, fmtMoney, fmtPct, STAGE_TONE, toneForStatus, useCrmI18n, useCrmRead } from './crmFormat';

const WINDOWS = [30, 90, 180, 365] as const;

/**
 * CRM home. One RPC call (get_crm_dashboard) composes the pipeline, the funnel,
 * the forecast, the counters, the due follow-ups, the recent activity and the
 * largest open opportunities, so every number on this screen was derived by the
 * same query against the same rows -- a tile and the table below it cannot
 * disagree. Rates arrive as null when their denominator is zero and render as an
 * em dash rather than 0%.
 */
export function CrmDashboardPanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const { t } = useCrmI18n();
  const [days, setDays] = useState<number>(90);
  const { data, loading, error, reload } = useCrmRead<CrmDashboard>(
    () => crmAnalytics.dashboard(days),
    [days],
  );

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--text-muted)]">
          {data
            ? `${t('النافذة', 'Fenêtre', 'Window')}: ${fmtDate(data.from)} → ${fmtDate(data.to)}`
            : DASH}
        </p>
        <Select
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          className="input w-auto"
          aria-label={t('نطاق التحليل', 'Période', 'Analysis window')}
        >
          {WINDOWS.map((w) => (
            <option key={w} value={w}>{t(`آخر ${w} يوم`, `${w} derniers jours`, `Last ${w} days`)}</option>
          ))}
        </Select>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <Tile label={t('عملاء محتملون مفتوحون', 'Prospects ouverts', 'Open leads')}
              value={fmtInt(data.counters.open_leads)} onClick={() => onOpenTab?.('leads')} />
            <Tile label={t('العملاء', 'Clients', 'Customers')}
              value={fmtInt(data.counters.customers)} onClick={() => onOpenTab?.('customers')} />
            <Tile label={t('فرص مفتوحة', 'Opportunités', 'Open opportunities')}
              value={fmtInt(data.counters.open_opportunities)} onClick={() => onOpenTab?.('pipeline')} />
            <Tile label={t('عروض بانتظار رد', 'Devis en attente', 'Quotes awaiting reply')}
              value={fmtInt(data.counters.quotes_awaiting_reply)} onClick={() => onOpenTab?.('quotes')} />
            <Tile label={t('متابعات متأخرة', 'Suivis en retard', 'Overdue follow-ups')}
              value={fmtInt(data.counters.overdue_followups)} tone={data.counters.overdue_followups > 0 ? 'bad' : 'good'}
              onClick={() => onOpenTab?.('followups')} />
            <Tile label={t('متابعات اليوم', "Suivis aujourd'hui", 'Due today')}
              value={fmtInt(data.counters.due_today_followups)} onClick={() => onOpenTab?.('followups')} />
            <Tile label={t('حملات نشطة', 'Campagnes actives', 'Active campaigns')}
              value={fmtInt(data.counters.active_campaigns)} onClick={() => onOpenTab?.('campaigns')} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel
              title={t('خط الأنابيب', 'Pipeline', 'Pipeline')}
              subtitle={t(
                'المرجح = القيمة × احتمال المرحلة، محسوب في قاعدة البيانات',
                'Pondéré = valeur × probabilité, calculé en base',
                'Weighted = value × stage probability, computed in the database',
              )}
            >
              <PipelineTable data={data} />
            </Panel>

            <Panel title={t('مسار التحويل', 'Entonnoir', 'Conversion funnel')}>
              <FunnelBlock data={data} />
            </Panel>
          </div>

          <Panel
            title={t('التوقعات الشهرية', 'Prévisions mensuelles', 'Monthly forecast')}
            subtitle={t(
              'الشهر مأخوذ من تاريخ الإغلاق المتوقع؛ المكسوب من الفرص المكسوبة فعلاً',
              'Mois = date de clôture prévue ; gagné = opportunités réellement gagnées',
              'Month is the expected close date; won is opportunities actually won',
            )}
          >
            <ForecastTable data={data} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title={t('أكبر الفرص المفتوحة', 'Plus grandes opportunités', 'Largest open opportunities')}>
              {data.top_open_opportunities.length === 0 ? (
                <Empty text={t('لا فرص مفتوحة', 'Aucune opportunité', 'No open opportunities')} />
              ) : (
                <ul className="divided text-[13px]">
                  {data.top_open_opportunities.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--text-primary)]">{o.title}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {o.reference} · {fmtInt(o.travelers)} {t('معتمر', 'pèlerins', 'travellers')}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="tabular font-semibold text-[var(--text-primary)]">{fmtMoney(o.expected_value_dzd)}</p>
                        <Pill tone={STAGE_TONE[o.stage]}>{o.stage} · {fmtPct(o.probability)}</Pill>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('متابعات مستحقة', 'Suivis dus', 'Due follow-ups')}>
              {data.due_followups.length === 0 ? (
                <Empty text={t('لا متابعات مستحقة', 'Aucun suivi dû', 'Nothing due')} />
              ) : (
                <ul className="divided text-[13px]">
                  {data.due_followups.map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--text-primary)]">{f.title}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{fmtDateTime(f.due_at)}</p>
                      </div>
                      <Pill tone={f.priority === 'URGENT' ? 'bad' : f.priority === 'HIGH' ? 'warn' : 'neutral'}>
                        {f.priority}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('آخر الأنشطة', 'Activité récente', 'Recent activity')}>
              {data.recent_activities.length === 0 ? (
                <Empty text={t('لا أنشطة', 'Aucune activité', 'No activity')} />
              ) : (
                <ul className="divided text-[13px]">
                  {data.recent_activities.map((a) => (
                    <li key={a.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate font-medium text-[var(--text-primary)]">{a.subject}</p>
                        <Pill tone={toneForStatus(a.outcome)}>{a.activity_type}</Pill>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">{fmtDateTime(a.occurred_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">{text}</p>;
}

function PipelineTable({ data }: { data: CrmDashboard }) {
  const { t } = useCrmI18n();
  const max = Math.max(0, ...data.pipeline.map((s) => s.value_dzd));
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[520px]">
        <thead>
          <tr>
            <th>{t('المرحلة', 'Étape', 'Stage')}</th>
            <th className="end">{t('العدد', 'Nb', 'Count')}</th>
            <th className="end">{t('القيمة', 'Valeur', 'Value')}</th>
            <th className="end">{t('المرجح', 'Pondéré', 'Weighted')}</th>
            <th className="end">{t('معتمرون', 'Pèlerins', 'Travellers')}</th>
          </tr>
        </thead>
        <tbody>
          {data.pipeline.map((s) => (
            <tr key={s.stage}>
              <td>
                <div className="flex items-center gap-2">
                  <Pill tone={STAGE_TONE[s.stage]}>{s.stage}</Pill>
                </div>
                <div className="mt-1.5 w-28">
                  <Meter value={s.value_dzd} max={max} tone={STAGE_TONE[s.stage]} label={`${s.stage} value`} />
                </div>
              </td>
              <td className="end tabular text-end">{fmtInt(s.opportunity_count)}</td>
              <td className="end tabular text-end">{fmtMoney(s.value_dzd)}</td>
              <td className="end tabular text-end">{fmtMoney(s.weighted_dzd)}</td>
              <td className="end tabular text-end">{fmtInt(s.travelers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FunnelBlock({ data }: { data: CrmDashboard }) {
  const { t } = useCrmI18n();
  const max = Math.max(0, ...data.funnel.stages.map((s) => s.count));
  const rates: ReadonlyArray<{ label: string; value: number | null; icon: typeof Target }> = [
    { label: t('نسبة الاتصال', 'Taux de contact', 'Contact rate'), value: data.funnel.rates.contact_rate, icon: UserPlus },
    { label: t('نسبة التأهيل', 'Taux de qualification', 'Qualification rate'), value: data.funnel.rates.qualification_rate, icon: Users },
    { label: t('تحويل العملاء', 'Conversion prospects', 'Lead conversion'), value: data.funnel.rates.lead_conversion_rate, icon: Target },
    { label: t('تغطية العروض', 'Couverture devis', 'Quote coverage'), value: data.funnel.rates.quote_coverage_rate, icon: CalendarClock },
    { label: t('نسبة الفوز', 'Taux de gain', 'Win rate'), value: data.funnel.rates.win_rate, icon: Flame },
  ];
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {data.funnel.stages.map((s) => (
          <li key={s.key}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-[var(--text-secondary)]">{s.label}</span>
              <span className="tabular font-semibold text-[var(--text-primary)]">{fmtInt(s.count)}</span>
            </div>
            <Meter value={s.count} max={max} tone="info" label={s.label} />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rates.map((r) => (
          <div key={r.label} className="rounded-lg border border-[var(--border)] p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <r.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {r.label}
            </p>
            <p className="tabular mt-0.5 text-sm font-semibold text-[var(--text-primary)]">{fmtPct(r.value)}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t('مفقود', 'Perdu', 'Lost')}: {fmtInt(data.funnel.lost.leads)} {t('عميل محتمل', 'prospects', 'leads')} ·
          {' '}{fmtInt(data.funnel.lost.opportunities)} {t('فرصة', 'opportunités', 'opportunities')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
          {t('قيمة الفوز', 'Valeur gagnée', 'Won value')}: {fmtMoney(data.funnel.won_value_dzd)}
        </span>
      </div>
    </div>
  );
}

function ForecastTable({ data }: { data: CrmDashboard }) {
  const { t } = useCrmI18n();
  const max = Math.max(0, ...data.forecast.map((m) => Math.max(m.pipeline_dzd, m.won_dzd)));
  if (data.forecast.length === 0) return <Empty text={t('لا توقعات', 'Aucune prévision', 'No forecast rows')} />;
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[640px]">
        <thead>
          <tr>
            <th>{t('الشهر', 'Mois', 'Month')}</th>
            <th className="end">{t('الفرص', 'Opportunités', 'Opportunities')}</th>
            <th className="end">{t('خط الأنابيب', 'Pipeline', 'Pipeline')}</th>
            <th className="end">{t('المرجح', 'Pondéré', 'Weighted')}</th>
            <th className="end">{t('مكسوب', 'Gagné', 'Won')}</th>
            <th className="end">{t('مفقود', 'Perdu', 'Lost')}</th>
            <th>{t('التوزيع', 'Répartition', 'Mix')}</th>
          </tr>
        </thead>
        <tbody>
          {data.forecast.map((m) => (
            <tr key={m.month}>
              <td className="whitespace-nowrap">{fmtDate(m.month)}</td>
              <td className="end tabular text-end">{fmtInt(m.opportunity_count)}</td>
              <td className="end tabular text-end">{fmtMoney(m.pipeline_dzd)}</td>
              <td className="end tabular text-end">{fmtMoney(m.weighted_dzd)}</td>
              <td className="end tabular text-end">{fmtMoney(m.won_dzd)}</td>
              <td className="end tabular text-end">{fmtMoney(m.lost_dzd)}</td>
              <td className="w-40">
                <Meter value={m.pipeline_dzd} max={max} tone="info" label={`${m.month} pipeline`} />
                <div className="mt-1">
                  <Meter value={m.won_dzd} max={max} tone="good" label={`${m.month} won`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
