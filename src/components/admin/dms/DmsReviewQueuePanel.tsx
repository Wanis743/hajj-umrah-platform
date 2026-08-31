/**
 * The reviewer's inbox: every document still waiting on a human decision, longest
 * wait first.
 *
 * `waiting_hours` is measured from submitted_at, not created_at, so a document that
 * sat in DRAFT for a month is not reported as having waited on a reviewer for a
 * month. The server does that arithmetic (get_dms_review_queue), which is why the
 * age in a row and the age in the counters above it cannot disagree.
 *
 * The argument to the RPC is a row cap, not a window: the queue is everything still
 * PENDING_REVIEW, UNDER_REVIEW or CHANGES_REQUESTED, however old, and the cap only
 * decides how much of it comes back.
 *
 * Decisions are taken inline. The buttons are gated by DMS_REVIEW_TRANSITIONS, so a
 * move the state machine would refuse is not offered, and approve is additionally
 * greyed out for the account that submitted the document -- the server raises 42501
 * for that (`The account that submitted a document cannot approve it`), and 42501 is
 * not one of the SQLSTATEs whose text is surfaced verbatim, so explaining it here is
 * the only way the reviewer learns why rather than reading "not authorized".
 */
import { useMemo, useState } from 'react';
import { Check, FileSearch, Pencil, Play, ShieldAlert, X } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { useAuth } from '@/lib/auth';
import { dmsAnalytics } from '@/services/dmsAnalytics';
import { dmsCommands } from '@/services/domainCommands';
import { DMS_REVIEW_TRANSITIONS, type DmsReviewQueueRow, type DmsReviewStatus } from '@/types/dms';
import { NoticeBar, Panel, Pill, Tile } from './atoms';
import { ReasonForm } from './DmsDocumentForms';
import { DmsDocumentPanel } from './DmsDocumentPanel';
import {
  CONFIDENTIALITY_TONE, DASH, REVIEW_TONE, actorLabel, daysUntil, expiryTone, fmtBytes,
  fmtDateTime, fmtHours, fmtInt, useDmsI18n, useDmsLabels, useDmsRead, type Tone,
} from './dmsFormat';
import { useDmsCommand } from './useDmsCommand';

const CAPS = [25, 50, 100, 200] as const;

/** The three states the RPC selects, in the order a reviewer works them. */
const QUEUE_STATES: readonly DmsReviewStatus[] = ['PENDING_REVIEW', 'UNDER_REVIEW', 'CHANGES_REQUESTED'];

/** Queue age as a tone. A day is fine, three days is not -- and null means the row
 *  has no submitted_at at all, which is neither good nor bad. */
function waitTone(hours: number | null): Tone {
  if (hours === null) return 'neutral';
  if (hours >= 72) return 'bad';
  if (hours >= 24) return 'warn';
  return 'good';
}

export function DmsReviewQueuePanel() {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const cmd = useDmsCommand();
  const { session, staffProfile } = useAuth();
  const [cap, setCap] = useState<number>(50);
  const [filter, setFilter] = useState<DmsReviewStatus | 'ALL'>('ALL');
  const [reason, setReason] = useState<{ id: string; kind: 'REJECT' | 'CHANGES' } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const view = useDmsRead(() => dmsAnalytics.reviewQueue(cap), [cap]);
  // Memoised for identity, not for cost: `?? []` would hand the filters below a new
  // empty array every render and defeat their own memos.
  const rows = useMemo(() => view.data ?? [], [view.data]);

  // The SoD rule as the server states it: the submitter cannot approve, unless the
  // reviewer is an ADMIN.
  const myId = session?.user?.id ?? null;
  const isAdmin = staffProfile?.role === 'ADMIN';
  const selfSubmitted = (row: DmsReviewQueueRow) =>
    !isAdmin && row.submitted_by !== null && row.submitted_by === myId;

  const shown = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.review_status === filter)),
    [rows, filter],
  );

  const counts = useMemo(() => {
    const byState = (s: DmsReviewStatus) => rows.filter((r) => r.review_status === s).length;
    const waits = rows.map((r) => r.waiting_hours).filter((h): h is number => h !== null);
    return {
      total: rows.length,
      pending: byState('PENDING_REVIEW'),
      under: byState('UNDER_REVIEW'),
      changes: byState('CHANGES_REQUESTED'),
      // Null rather than 0 when nothing in the queue carries a submitted_at.
      oldest: waits.length > 0 ? Math.max(...waits) : null,
      unverified: rows.filter((r) => !r.has_verified_bytes).length,
    };
  }, [rows]);

  const after = async () => { view.reload(); };
  const moved = (row: DmsReviewQueueRow, to: DmsReviewStatus) =>
    `${row.document_number ?? row.title}: ${labels.review[row.review_status]} → ${labels.review[to]}`;

  const decide = (row: DmsReviewQueueRow, to: 'UNDER_REVIEW' | 'APPROVED') => {
    void cmd.run(
      () => (to === 'APPROVED' ? dmsCommands.approve(row.id) : dmsCommands.startReview(row.id)),
      { notice: moved(row, to), onSuccess: after },
    );
  };

  if (view.loading && view.data === null) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {view.error && <ErrorBanner message={view.error} onRetry={view.reload} />}
      {cmd.error && <ErrorBanner message={cmd.error} />}
      {cmd.notice && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t('في القائمة', 'Dans la file', 'In the queue')} value={fmtInt(counts.total)}
          tone={counts.total > 0 ? 'warn' : 'good'} />
        <Tile label={labels.review.PENDING_REVIEW} value={fmtInt(counts.pending)} tone="info"
          onClick={() => setFilter(filter === 'PENDING_REVIEW' ? 'ALL' : 'PENDING_REVIEW')} />
        <Tile label={labels.review.UNDER_REVIEW} value={fmtInt(counts.under)} tone="progress"
          onClick={() => setFilter(filter === 'UNDER_REVIEW' ? 'ALL' : 'UNDER_REVIEW')} />
        <Tile label={labels.review.CHANGES_REQUESTED} value={fmtInt(counts.changes)} tone="warn"
          onClick={() => setFilter(filter === 'CHANGES_REQUESTED' ? 'ALL' : 'CHANGES_REQUESTED')} />
        <Tile label={t('أطول انتظار', 'Attente la plus longue', 'Longest wait')}
          value={fmtHours(counts.oldest)} tone={waitTone(counts.oldest)}
          hint={t('من وقت الإرسال', 'Depuis la soumission', 'Since it was submitted')} />
        <Tile label={t('بدون بايتات مؤكدة', 'Sans octets vérifiés', 'No verified bytes')}
          value={fmtInt(counts.unverified)} tone={counts.unverified > 0 ? 'bad' : 'good'}
          hint={t('لا يمكن اعتمادها', 'Non approuvables', 'Cannot be approved')} />
      </div>

      <Panel
        title={t('قائمة المراجعة', 'File de révision', 'Review queue')}
        subtitle={t(
          'الأطول انتظاراً أولاً — والانتظار يُحسب من وقت الإرسال',
          'La plus longue attente d’abord — comptée depuis la soumission',
          'Longest wait first, measured from when it was submitted',
        )}
        actions={
          <>
            <Select value={filter} className="input w-auto"
              onChange={(e) => setFilter(e.target.value as DmsReviewStatus | 'ALL')}
              aria-label={t('حالة المراجعة', 'Statut de révision', 'Review status')}>
              <option value="ALL">{t('كل القائمة', 'Toute la file', 'Whole queue')}</option>
              {QUEUE_STATES.map((s) => <option key={s} value={s}>{labels.review[s]}</option>)}
            </Select>
            <Select value={String(cap)} className="input w-auto"
              onChange={(e) => setCap(Number(e.target.value))}
              aria-label={t('عدد الصفوف', 'Nombre de lignes', 'Row cap')}>
              {CAPS.map((c) => (
                <option key={c} value={c}>{t(`${c} صف`, `${c} lignes`, `${c} rows`)}</option>
              ))}
            </Select>
          </>
        }
      >
        {shown.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {rows.length === 0
              ? t('لا شيء ينتظر المراجعة', 'Rien en attente de révision', 'Nothing is waiting on a review')
              : t('لا صفوف بهذه الحالة', 'Aucune ligne dans cet état', 'No rows in that state')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[1040px]">
              <thead>
                <tr>
                  <th>{t('الوثيقة', 'Document', 'Document')}</th>
                  <th>{t('الحالة', 'État', 'State')}</th>
                  <th className="end">{t('الانتظار', 'Attente', 'Waiting')}</th>
                  <th>{t('أُرسلت', 'Soumis', 'Submitted')}</th>
                  <th>{t('المراجع', 'Réviseur', 'Reviewer')}</th>
                  <th>{t('الملف', 'Fichier', 'File')}</th>
                  <th>{t('الانتهاء', 'Expiration', 'Expires')}</th>
                  <th className="end">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <QueueRow
                    key={row.id}
                    row={row}
                    busy={cmd.busy}
                    open={row.id === selectedId}
                    blockedBySod={selfSubmitted(row)}
                    onOpen={() => setSelectedId(row.id === selectedId ? null : row.id)}
                    onStart={() => decide(row, 'UNDER_REVIEW')}
                    onApprove={() => decide(row, 'APPROVED')}
                    onReject={() => setReason({ id: row.id, kind: 'REJECT' })}
                    onChanges={() => setReason({ id: row.id, kind: 'CHANGES' })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {reason && (
        <ReasonForm
          kind={reason.kind}
          busy={cmd.busy}
          onCancel={() => setReason(null)}
          onConfirm={async (text) => {
            const row = rows.find((r) => r.id === reason.id);
            if (!row) { setReason(null); return; }
            const ok = await cmd.run(
              () => (reason.kind === 'REJECT'
                ? dmsCommands.reject(row.id, text)
                : dmsCommands.requestChanges(row.id, text)),
              {
                notice: moved(row, reason.kind === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED'),
                onSuccess: after,
              },
            );
            if (ok) setReason(null);
          }}
        />
      )}

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
 * One queue row. Split out so the panel above it stays readable, and because the
 * action set is a function of the row's own state: `targets` is the legal-move list
 * from DMS_REVIEW_TRANSITIONS, and a button that is not in it is not rendered at all
 * rather than rendered disabled -- an illegal move is not a move the reviewer failed
 * to earn, it is one that does not exist from here.
 */
function QueueRow({ row, busy, open, blockedBySod, onOpen, onStart, onApprove, onReject, onChanges }: {
  row: DmsReviewQueueRow;
  busy: boolean;
  open: boolean;
  /** The submitter cannot approve their own document unless they are an ADMIN. */
  blockedBySod: boolean;
  onOpen: () => void;
  onStart: () => void;
  onApprove: () => void;
  onReject: () => void;
  onChanges: () => void;
}) {
  const { t } = useDmsI18n();
  const labels = useDmsLabels();
  const targets = DMS_REVIEW_TRANSITIONS[row.review_status];
  const remaining = daysUntil(row.expires_on);
  const sodTitle = t(
    'لا يمكن لمن أرسل الوثيقة أن يعتمدها',
    "L'auteur de la soumission ne peut pas approuver",
    'The account that submitted it cannot approve it',
  );

  return (
    <tr className={open ? 'bg-[var(--bg-hover)]' : undefined}>
      <td>
        <p className="font-medium text-[var(--text-primary)]">{row.title}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] tabular">
          {row.document_number ?? DASH} · {row.document_type}
          <Pill tone={CONFIDENTIALITY_TONE[row.confidentiality]}>
            {labels.confidentiality[row.confidentiality]}
          </Pill>
        </p>
      </td>
      <td><Pill tone={REVIEW_TONE[row.review_status]}>{labels.review[row.review_status]}</Pill></td>
      <td className="end text-end">
        <Pill tone={waitTone(row.waiting_hours)}>{fmtHours(row.waiting_hours)}</Pill>
      </td>
      <td className="whitespace-nowrap text-[12px]">
        {row.submitted_at ? (
          <>
            <p>{fmtDateTime(row.submitted_at)}</p>
            <p className="font-mono text-[11px] text-[var(--text-muted)]" title={row.submitted_by ?? undefined}>
              {actorLabel(row.submitted_by)}
            </p>
          </>
        ) : DASH}
      </td>
      <td className="whitespace-nowrap text-[12px]">
        {row.reviewer_id ? (
          <>
            <p className="font-mono" title={row.reviewer_id}>{actorLabel(row.reviewer_id)}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{fmtDateTime(row.review_started_at)}</p>
          </>
        ) : DASH}
      </td>
      <td className="text-[12px]">
        <p className="text-[var(--text-secondary)]">{row.mime_type ?? DASH}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] tabular">
          {fmtBytes(row.size_bytes)} · {fmtInt(row.version_count)}v
          {!row.has_verified_bytes && (
            <Pill tone="bad">{t('بلا بصمة', 'Sans empreinte', 'No digest')}</Pill>
          )}
        </p>
      </td>
      <td className="whitespace-nowrap text-[12px]">
        {row.expires_on ? (
          <span className="flex items-center gap-1.5">
            {fmtDateTime(row.expires_on)}
            <Pill tone={expiryTone(remaining)}>
              {remaining !== null && remaining < 0 ? t('منتهي', 'Expiré', 'Overdue') : `${remaining}d`}
            </Pill>
          </span>
        ) : DASH}
      </td>
      <td className="end">
        <div className="flex items-center justify-end gap-1.5">
          {targets.includes('UNDER_REVIEW') && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={onStart}
              aria-label={`${t('بدء المراجعة', 'Commencer', 'Start review')} ${row.title}`}
              title={t('بدء المراجعة', 'Commencer la révision', 'Start review')}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {targets.includes('APPROVED') && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || blockedBySod}
              onClick={onApprove} title={blockedBySod ? sodTitle : t('اعتماد', 'Approuver', 'Approve')}
              aria-label={`${t('اعتماد', 'Approuver', 'Approve')} ${row.title}`}>
              {blockedBySod
                ? <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          )}
          {targets.includes('CHANGES_REQUESTED') && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={onChanges}
              aria-label={`${t('طلب تعديلات', 'Demander des modifications', 'Request changes')} ${row.title}`}
              title={t('طلب تعديلات', 'Demander des modifications', 'Request changes')}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {targets.includes('REJECTED') && (
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onReject}
              aria-label={`${t('رفض', 'Rejeter', 'Reject')} ${row.title}`}
              title={t('رفض', 'Rejeter', 'Reject')}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onOpen}
            aria-label={`${open ? t('إغلاق', 'Fermer', 'Close') : t('فتح', 'Ouvrir', 'Open')} ${row.title}`}>
            <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
            {open ? t('إغلاق', 'Fermer', 'Close') : t('فتح', 'Ouvrir', 'Open')}
          </button>
        </div>
      </td>
    </tr>
  );
}
