import { useState, type ReactNode } from 'react';
import { Archive, CalendarClock, FileStack, FileText, Inbox, Layers } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { dmsAnalytics } from '@/services/dmsAnalytics';
import type { DmsDashboard } from '@/types/dms';
import { Meter, Panel, Pill, Tile } from './atoms';
import {
  CONFIDENTIALITY_TONE, DASH, REVIEW_TONE, fmtDate, fmtInt, fmtPct,
  useDmsI18n, useDmsLabels, useDmsRead,
} from './dmsFormat';

const WINDOWS = [7, 30, 90, 365] as const;

/**
 * DMS home. One RPC call (get_dms_dashboard) composes the counters, the three
 * breakdowns and the day-by-day activity series, so every number here was derived
 * by the same query against the same rows -- a tile and the table below it cannot
 * disagree.
 *
 * The status breakdown left-joins an eight-row list of the states themselves, so a
 * state nobody has used shows a zero instead of vanishing from the chart. Reading
 * "no REJECTED row" is different from reading "REJECTED is missing".
 */
export function DmsDashboardPanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const [days, setDays] = useState<number>(30);
  const { data, loading, error, reload } = useDmsRead<DmsDashboard>(
    () => dmsAnalytics.dashboard(days),
    [days],
  );

  if (loading && !data) return <Spinner className="p-10" />;

  const maxStatus = Math.max(1, ...(data?.by_status ?? []).map((r) => r.document_count));
  const maxType = Math.max(1, ...(data?.by_type ?? []).map((r) => r.document_count));
  const maxActivity = Math.max(
    1,
    ...(data?.activity ?? []).map((r) => r.uploads + r.approvals + r.returns),
  );

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--text-muted)]">
          {data
            ? t(
              `النشاط لآخر ${data.window_days} يوم`,
              `Activité des ${data.window_days} derniers jours`,
              `Activity over the last ${data.window_days} days`,
            )
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
            <Tile label={t('الوثائق', 'Documents', 'Documents')}
              value={fmtInt(data.totals.documents)} onClick={() => onOpenTab?.('library')} />
            <Tile label={t('معتمدة', 'Approuvés', 'Approved')}
              value={fmtInt(data.totals.approved)} tone="good" onClick={() => onOpenTab?.('library')} />
            <Tile label={t('بانتظار المراجعة', 'En attente', 'Awaiting review')}
              value={fmtInt(data.totals.awaiting_review)}
              tone={data.totals.awaiting_review > 0 ? 'warn' : 'good'}
              onClick={() => onOpenTab?.('review')} />
            <Tile label={t('تنتهي قريباً', 'Bientôt expirés', 'Expiring soon')}
              value={fmtInt(data.totals.expiring_soon)}
              tone={data.totals.expiring_soon > 0 ? 'warn' : 'good'}
              onClick={() => onOpenTab?.('expiry')} />
            <Tile label={t('منتهية', 'Expirés', 'Expired')}
              value={fmtInt(data.totals.expired)}
              tone={data.totals.expired > 0 ? 'bad' : 'good'}
              onClick={() => onOpenTab?.('expiry')} />
            <Tile label={t('النسخ', 'Versions', 'Versions')} value={fmtInt(data.totals.versions)} />
            <Tile label={t('مؤرشفة', 'Archivés', 'Archived')} value={fmtInt(data.totals.archived)} />
            <Tile label={t('جديدة في النافذة', 'Créés', 'Created in window')}
              value={fmtInt(data.totals.created_in_window)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title={t('حسب حالة المراجعة', 'Par état de révision', 'By review status')}
              subtitle={t(
                'الثمانية كلها معروضة، حتى ما لم يُستخدم بعد',
                'Les huit états, y compris ceux jamais utilisés',
                'All eight states, including the ones never used',
              )}
            >
              <ul className="space-y-2.5">
                {data.by_status.map((row) => (
                  <li key={row.review_status}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                        <Pill tone={REVIEW_TONE[row.review_status]}>{labels.review[row.review_status]}</Pill>
                      </span>
                      <span className="text-[13px] tabular text-[var(--text-primary)]">{fmtInt(row.document_count)}</span>
                    </div>
                    <Meter
                      value={row.document_count}
                      max={maxStatus}
                      tone={REVIEW_TONE[row.review_status]}
                      label={labels.review[row.review_status]}
                    />
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              title={t('حسب السرية', 'Par confidentialité', 'By confidentiality')}
              subtitle={t(
                'مستوى السرية يحدد من يرى الوثيقة، لا من يعتمدها',
                "Le niveau décide qui voit, pas qui approuve",
                'The level decides who can see it, not who approves it',
              )}
            >
              <ul className="space-y-2.5">
                {data.by_confidentiality.map((row) => (
                  <li key={row.confidentiality}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Pill tone={CONFIDENTIALITY_TONE[row.confidentiality]}>
                        {labels.confidentiality[row.confidentiality]}
                      </Pill>
                      <span className="text-[13px] tabular text-[var(--text-primary)]">{fmtInt(row.document_count)}</span>
                    </div>
                    <Meter
                      value={row.document_count}
                      max={Math.max(1, ...data.by_confidentiality.map((r) => r.document_count))}
                      tone={CONFIDENTIALITY_TONE[row.confidentiality]}
                      label={labels.confidentiality[row.confidentiality]}
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel
            title={t('حسب النوع', 'Par type', 'By document type')}
            subtitle={t(
              'نسبة الاعتماد لكل نوع: كم منها اجتاز المراجعة فعلاً',
              'Taux d’approbation par type',
              'Approval share per type: how many actually cleared review'
            )}
          >
            {data.by_type.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
                {t('لا توجد وثائق بعد', 'Aucun document', 'No documents yet')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{t('النوع', 'Type', 'Type')}</th>
                      <th className="end">{t('العدد', 'Nombre', 'Documents')}</th>
                      <th className="end">{t('معتمدة', 'Approuvés', 'Approved')}</th>
                      <th className="end">{t('نسبة الاعتماد', 'Taux', 'Approved %')}</th>
                      <th>{/* meter */}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_type.map((row) => (
                      <tr key={row.document_type}>
                        <td className="font-medium text-[var(--text-primary)]">{row.document_type}</td>
                        <td className="end tabular">{fmtInt(row.document_count)}</td>
                        <td className="end tabular">{fmtInt(row.approved_count)}</td>
                        <td className="end tabular">
                          {/* Null, not 0%, when the type has no documents at all. */}
                          {fmtPct(row.document_count > 0
                            ? Math.round((row.approved_count / row.document_count) * 100)
                            : null)}
                        </td>
                        <td className="w-32">
                          <Meter value={row.document_count} max={maxType} tone="info" label={row.document_type} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title={t('النشاط اليومي', 'Activité quotidienne', 'Daily activity')}
            subtitle={t(
              'رفع مقابل اعتماد مقابل إرجاع — من سجل الأحداث نفسه',
              'Téléversements, approbations, retours — depuis le journal',
              'Uploads vs approvals vs returns, straight off the event ledger',
            )}
          >
            <div className="overflow-x-auto">
              <div className="flex min-w-[560px] items-end gap-1" role="img"
                aria-label={t('النشاط اليومي', 'Activité quotidienne', 'Daily activity')}>
                {data.activity.map((day) => {
                  const total = day.uploads + day.approvals + day.returns;
                  const h = (n: number) => `${Math.round((n / maxActivity) * 72)}px`;
                  return (
                    <div key={day.day} className="flex flex-1 flex-col items-center gap-1"
                      title={`${fmtDate(day.day)} — ${day.uploads} / ${day.approvals} / ${day.returns}`}>
                      <div className="flex h-[76px] w-full flex-col justify-end gap-px">
                        {day.returns > 0 && <span className="block w-full rounded-t bg-rose-400/80" style={{ height: h(day.returns) }} />}
                        {day.approvals > 0 && <span className="block w-full bg-emerald-400/80" style={{ height: h(day.approvals) }} />}
                        {day.uploads > 0 && <span className="block w-full bg-blue-400/80" style={{ height: h(day.uploads) }} />}
                        {total === 0 && <span className="block h-px w-full bg-[var(--border)]" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-blue-400" />{t('رفع', 'Téléversements', 'Uploads')}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400" />{t('اعتماد', 'Approbations', 'Approvals')}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-rose-400" />{t('إرجاع', 'Retours', 'Returns')}</span>
            </div>
          </Panel>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <ShortcutCard icon={<FileText className="h-4 w-4" />} label={t('المكتبة', 'Bibliothèque', 'Library')} onClick={() => onOpenTab?.('library')} />
            <ShortcutCard icon={<Inbox className="h-4 w-4" />} label={t('قائمة المراجعة', 'File de révision', 'Review queue')} onClick={() => onOpenTab?.('review')} />
            <ShortcutCard icon={<CalendarClock className="h-4 w-4" />} label={t('الانتهاء', 'Expirations', 'Expiry')} onClick={() => onOpenTab?.('expiry')} />
            <ShortcutCard icon={<Layers className="h-4 w-4" />} label={t('الاستخراج', 'Extraction', 'Extraction')} onClick={() => onOpenTab?.('extraction')} />
            <ShortcutCard icon={<FileStack className="h-4 w-4" />} label={t('حزم الأدلة', 'Dossiers de preuve', 'Evidence')} onClick={() => onOpenTab?.('packages')} />
            <ShortcutCard icon={<Archive className="h-4 w-4" />} label={t('مؤرشفة', 'Archivés', 'Archived')} onClick={() => onOpenTab?.('library')} />
          </div>
        </>
      )}
    </div>
  );
}

function ShortcutCard({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="card flex items-center gap-2 p-3 text-start text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]">
      <span className="text-[var(--accent)]">{icon}</span>
      {label}
    </button>
  );
}
