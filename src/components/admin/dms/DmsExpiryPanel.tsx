/**
 * What is about to stop being valid, and the sweep that acts on it.
 *
 * Two different populations on one screen, deliberately labelled as such: the buckets
 * count every non-archived document in scope, including the ones with no expiry date
 * at all, while the table below is only the horizon -- documents whose expires_on
 * falls on or before today + N. A bucket total larger than the row count is not a
 * disagreement, it is the difference between "the library" and "the next N days".
 *
 * The sweep is the one write here, and it decides by the calendar rather than by who
 * pressed it: private.dms_expire_due_documents moves APPROVED documents whose date
 * has passed to EXPIRED and stamps expiry_notified_at on the APPROVED ones inside
 * their own notice window. It touches nothing in any other state -- a DRAFT that went
 * stale was never valid to begin with, so there is nothing to expire.
 */
import { useMemo, useState } from 'react';
import { BellRing, FileSearch, RotateCw } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { dmsAnalytics } from '@/services/dmsAnalytics';
import { dmsCommands } from '@/services/domainCommands';
import type { DmsExpiryReport } from '@/types/dms';
import { Meter, NoticeBar, Panel, Pill, Tile } from './atoms';
import { DmsDocumentPanel } from './DmsDocumentPanel';
import {
  DASH, REVIEW_TONE, expiryTone, fmtDate, fmtDateTime, fmtInt,
  useDmsI18n, useDmsLabels, useDmsRead,
} from './dmsFormat';
import { useDmsCommand } from './useDmsCommand';

const HORIZONS = [30, 60, 90, 180, 365] as const;

type ExpiryRow = DmsExpiryReport['documents'][number];
type Lens = 'ALL' | 'OVERDUE' | 'NOTICE' | 'LATER';

/** The lens is applied to the horizon rows the server already returned, not to a new
 *  query: everything needed to sort them into overdue / inside the notice window /
 *  later is in the row itself. */
function inLens(row: ExpiryRow, lens: Lens): boolean {
  if (lens === 'ALL') return true;
  if (lens === 'OVERDUE') return row.days_remaining < 0;
  if (lens === 'NOTICE') return row.days_remaining >= 0 && row.days_remaining <= row.expiry_notice_days;
  return row.days_remaining > row.expiry_notice_days;
}

export function DmsExpiryPanel() {
  const { t } = useDmsI18n();
  const cmd = useDmsCommand();
  const [horizon, setHorizon] = useState<number>(90);
  const [lens, setLens] = useState<Lens>('ALL');
  const [confirmSweep, setConfirmSweep] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const view = useDmsRead(() => dmsAnalytics.expiry(horizon), [horizon]);
  const report = view.data;
  const rows = useMemo(
    () => (report?.documents ?? []).filter((r) => inLens(r, lens)),
    [report, lens],
  );

  const sweep = () => {
    void cmd.run(() => dmsCommands.runExpirySweep(), {
      onSuccess: (data) => {
        setConfirmSweep(false);
        cmd.setNotice(data
          ? t(
            `المسح: ${data.expired} انتهت، ${data.notified} تنبيه`,
            `Balayage : ${data.expired} expiré(s), ${data.notified} préavis`,
            `Sweep: ${data.expired} expired, ${data.notified} notified`,
          )
          : t('تم المسح', 'Balayage effectué', 'Sweep completed'));
        view.reload();
      },
    });
  };

  if (view.loading && report === null) return <Spinner className="p-10" />;

  const buckets = report?.buckets;
  const maxBucket = buckets
    ? Math.max(1, buckets.expired, buckets.within_7, buckets.within_30, buckets.within_90, buckets.beyond)
    : 1;

  return (
    <div className="space-y-4">
      {view.error && <ErrorBanner message={view.error} onRetry={view.reload} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      {buckets && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={t('منتهية', 'Expirés', 'Expired')} value={fmtInt(buckets.expired)}
              tone={buckets.expired > 0 ? 'bad' : 'good'}
              onClick={() => setLens(lens === 'OVERDUE' ? 'ALL' : 'OVERDUE')} />
            <Tile label={t('خلال 7 أيام', 'Sous 7 jours', 'Within 7 days')} value={fmtInt(buckets.within_7)}
              tone={buckets.within_7 > 0 ? 'bad' : 'good'} />
            <Tile label={t('خلال 30 يوماً', 'Sous 30 jours', 'Within 30 days')} value={fmtInt(buckets.within_30)}
              tone={buckets.within_30 > 0 ? 'warn' : 'good'} />
            <Tile label={t('خلال 90 يوماً', 'Sous 90 jours', 'Within 90 days')} value={fmtInt(buckets.within_90)}
              tone="info" />
            <Tile label={t('بعد ذلك', 'Au-delà', 'Beyond')} value={fmtInt(buckets.beyond)} />
            <Tile label={t('بلا تاريخ انتهاء', 'Sans expiration', 'No expiry date')}
              value={fmtInt(buckets.no_expiry)}
              hint={t('لا يشملها المسح', 'Hors balayage', 'Never swept')} />
          </div>

          <Panel
            title={t('توزيع الانتهاء', 'Répartition des expirations', 'Expiry distribution')}
            subtitle={t(
              'على كل الوثائق غير المؤرشفة، لا على النافذة وحدها',
              'Sur tous les documents non archivés, pas seulement la fenêtre',
              'Over every non-archived document in scope, not just the horizon',
            )}
          >
            <ul className="space-y-2.5">
              {([
                ['expired', t('منتهية', 'Expirés', 'Expired'), buckets.expired, 'bad'],
                ['within_7', t('خلال 7', 'Sous 7 j', 'Within 7'), buckets.within_7, 'bad'],
                ['within_30', t('خلال 30', 'Sous 30 j', 'Within 30'), buckets.within_30, 'warn'],
                ['within_90', t('خلال 90', 'Sous 90 j', 'Within 90'), buckets.within_90, 'info'],
                ['beyond', t('بعد ذلك', 'Au-delà', 'Beyond'), buckets.beyond, 'good'],
              ] as const).map(([key, label, value, tone]) => (
                <li key={key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                    <span className="text-[var(--text-secondary)]">{label}</span>
                    <span className="tabular text-[var(--text-primary)]">{fmtInt(value)}</span>
                  </div>
                  <Meter value={value} max={maxBucket} tone={tone} label={label} />
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <Panel
        title={t('الوثائق المعنية', 'Documents concernés', 'Documents in the horizon')}
        subtitle={report
          ? t(
            `حتى ${report.horizon_days} يوماً من الآن`,
            `Jusqu’à ${report.horizon_days} jours`,
            `Up to ${report.horizon_days} days out`,
          )
          : undefined}
        actions={
          <>
            <Select value={lens} className="input w-auto"
              onChange={(e) => setLens(e.target.value as Lens)}
              aria-label={t('التصفية', 'Filtre', 'Filter')}>
              <option value="ALL">{t('الكل', 'Tous', 'All')}</option>
              <option value="OVERDUE">{t('منتهية', 'Expirés', 'Overdue')}</option>
              <option value="NOTICE">{t('داخل نافذة التنبيه', 'Dans le préavis', 'Inside the notice window')}</option>
              <option value="LATER">{t('لاحقاً', 'Plus tard', 'Later')}</option>
            </Select>
            <Select value={String(horizon)} className="input w-auto"
              onChange={(e) => setHorizon(Number(e.target.value))}
              aria-label={t('الأفق الزمني', 'Horizon', 'Horizon')}>
              {HORIZONS.map((h) => (
                <option key={h} value={h}>{t(`${h} يوماً`, `${h} jours`, `${h} days`)}</option>
              ))}
            </Select>
            {/* Two clicks, not window.confirm: the sweep can move many documents to
                EXPIRED at once, so the second click is the confirmation. */}
            <button type="button" className={`btn btn-sm ${confirmSweep ? 'btn-danger' : ''}`}
              disabled={cmd.busy}
              title={t(
                'يُنهي المعتمدة التي مضى تاريخها ويسجل التنبيهات',
                'Expire les documents approuvés échus et pose les préavis',
                'Expires approved documents past their date and stamps the notices',
              )}
              onClick={() => { if (confirmSweep) { sweep(); return; } setConfirmSweep(true); }}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              {confirmSweep
                ? t('تأكيد المسح', 'Confirmer', 'Confirm sweep')
                : t('تشغيل المسح', 'Lancer le balayage', 'Run sweep')}
            </button>
          </>
        }
      >
        {rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا شيء ينتهي في هذه النافذة', 'Rien n’expire dans cette fenêtre', 'Nothing expires in this window')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[1000px]">
              <thead>
                <tr>
                  <th>{t('الوثيقة', 'Document', 'Document')}</th>
                  <th>{t('المراجعة', 'Révision', 'Review')}</th>
                  <th>{t('الإصدار', 'Émis le', 'Issued')}</th>
                  <th>{t('الانتهاء', 'Expiration', 'Expires')}</th>
                  <th className="end">{t('المتبقي', 'Restant', 'Remaining')}</th>
                  <th>{t('التنبيه', 'Préavis', 'Notice')}</th>
                  <th>{t('مرتبطة بـ', 'Liée à', 'Linked to')}</th>
                  <th className="end">{/* actions */}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ExpiryRowView key={row.id} row={row}
                    open={row.id === selectedId}
                    onOpen={() => setSelectedId(row.id === selectedId ? null : row.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selectedId && (
        <DmsDocumentPanel
          documentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => view.reload()}
        />
      )}
    </div>
  );
}

/**
 * One horizon row. `days_remaining` is the server's arithmetic against current_date,
 * so it agrees with the bucket the same document was counted in; recomputing it from
 * the date string in the browser would drift by a timezone.
 *
 * expiry_notified_at is shown rather than inferred: a document inside its notice
 * window with no stamp means the sweep has not run since it entered the window, which
 * is exactly the thing the button above fixes.
 */
function ExpiryRowView({ row, open, onOpen }: { row: ExpiryRow; open: boolean; onOpen: () => void }) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const inNotice = row.days_remaining >= 0 && row.days_remaining <= row.expiry_notice_days;

  return (
    <tr className={open ? 'bg-[var(--bg-hover)]' : undefined}>
      <td>
        <p className="font-medium text-[var(--text-primary)]">{row.title}</p>
        <p className="text-[11px] text-[var(--text-muted)] tabular">
          {row.document_number ?? DASH} · {row.document_type}
        </p>
      </td>
      <td><Pill tone={REVIEW_TONE[row.review_status]}>{labels.review[row.review_status]}</Pill></td>
      <td className="whitespace-nowrap text-[12px]">{fmtDate(row.issued_on)}</td>
      <td className="whitespace-nowrap text-[12px]">{fmtDate(row.expires_on)}</td>
      <td className="end text-end">
        <Pill tone={expiryTone(row.days_remaining)}>
          {row.days_remaining < 0
            ? t(`متأخرة ${-row.days_remaining}d`, `${-row.days_remaining}d de retard`, `${-row.days_remaining}d overdue`)
            : `${row.days_remaining}d`}
        </Pill>
      </td>
      <td className="whitespace-nowrap text-[12px]">
        <p className="text-[var(--text-secondary)]">
          {t(`قبل ${row.expiry_notice_days} يوماً`, `${row.expiry_notice_days} j avant`, `${row.expiry_notice_days}d before`)}
        </p>
        {row.expiry_notified_at ? (
          <p className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <BellRing className="h-3 w-3" aria-hidden="true" />
            {fmtDateTime(row.expiry_notified_at)}
          </p>
        ) : inNotice ? (
          <Pill tone="warn">{t('لم يُنبَّه', 'Sans préavis', 'Not notified')}</Pill>
        ) : null}
      </td>
      <td className="text-[12px]">
        {row.linked_entity_types.length === 0 ? DASH : (
          <span className="flex flex-wrap gap-1">
            {row.linked_entity_types.map((k) => <Pill key={k}>{labels.linkEntity[k]}</Pill>)}
          </span>
        )}
      </td>
      <td className="end">
        <button type="button" className="btn btn-sm" onClick={onOpen}
          aria-label={`${open ? t('إغلاق', 'Fermer', 'Close') : t('فتح', 'Ouvrir', 'Open')} ${row.title}`}>
          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
          {open ? t('إغلاق', 'Fermer', 'Close') : t('فتح', 'Ouvrir', 'Open')}
        </button>
      </td>
    </tr>
  );
}
