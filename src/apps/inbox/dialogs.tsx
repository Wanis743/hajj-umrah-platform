/**
 * Inbox — the four dialogs.
 *
 * None of them is a confirmation. Approving, certifying and accepting act on the
 * first press, because a queue whose every act asks "are you sure?" is a queue
 * people stop reading. What is here exists for a reason the server gives:
 *
 *   • `void_journal_entry` refuses without `p_reason`, so a rejection must collect
 *     one. The dialog also says what the refusal will do, which is not the same act
 *     for a draft as for something already posted.
 *   • `decline_spine_handoff_command` refuses without a note, and a declined handoff
 *     is finished — nobody reopens it. So the note is the whole of what the asking
 *     department gets back, and the dialog names the desk that will read it.
 *   • A note on an approval is optional and lands in `details.reason`, the only
 *     place a later reader finds out why something was waved through. Optional, so
 *     it is a separate act rather than a gate in front of the common one.
 *   • The sweep reports once, at the end. Twelve toasts is not a report.
 */
import { AlertTriangle, Ban, Check, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge, Dialog, Field, fmt, InfoBar, TextArea, useApp } from '@/platform/sdk';
import { STAGE_LABEL } from '../shared/spine';
import type { SweepReport } from './actions';
import type { WorkItem } from './queue';

/* ------------------------------------------------------------------ *
 * Reject
 * ------------------------------------------------------------------ */

export interface RejectDialogProps {
  readonly item: WorkItem;
  readonly busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * The reason the RPC requires, and what it will be used for.
 *
 * A draft is refused outright: its status becomes VOID and the reason is appended to
 * its description, where it stays legible for good. Anything already posted cannot
 * be un-posted, so the same call writes a mirrored reversal instead — a different
 * act, on a different date, and worth saying before the button is pressed.
 */
export function RejectDialog({ item, busy, onCancel, onConfirm }: RejectDialogProps) {
  const { t, tr } = useApp().locale;
  const [reason, setReason] = useState('');
  const posted = item.entry !== null && item.entry.status === 'posted';
  return (
    <Dialog
      open
      title={tr('رفض القيد', 'Refuser l’écriture', 'Reject entry')}
      onClose={onCancel}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      width={480}
      primary={{
        label: tr('رفض', 'Refuser', 'Reject'),
        onClick: () => onConfirm(reason),
        disabled: reason.trim() === '',
        busy,
        danger: true,
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="fx-mono fx-title-ellipsis" style={{ fontWeight: 600 }}>
            {item.title}
          </span>
          <Badge tone={item.tone}>{t(item.badge)}</Badge>
        </div>
        <InfoBar tone={posted ? 'warning' : 'info'} icon={posted ? AlertTriangle : Ban}>
          {posted
            ? tr(
                'القيد مرحّل، فسيُكتب قيد معاكس بتاريخ اليوم بدل حذفه — وهذا يتطلّب فترة مفتوحة.',
                'L’écriture est comptabilisée : une contre-passation sera écrite à la date du jour, ce qui exige une période ouverte.',
                'This entry is posted, so a mirrored reversal is written at today’s date instead — which needs an open period.',
              )
            : tr(
                'ستصبح حالة القيد «ملغى» ويُضاف السبب إلى وصفه.',
                'L’écriture passera à « annulée » et le motif sera ajouté à son libellé.',
                'The entry becomes void and the reason is appended to its description.',
              )}
        </InfoBar>
        <Field
          label={tr('السبب', 'Motif', 'Reason')}
          required
          hint={tr(
            'يُحفظ في سجل التدقيق وفي وصف القيد.',
            'Conservé dans le journal d’audit et dans le libellé.',
            'Kept in the audit trail and in the entry’s description.',
          )}
        >
          <TextArea
            value={reason}
            onChange={setReason}
            rows={3}
            placeholder={tr(
              'مثال: مرفق ناقص، يُعاد بعد إضافة الفاتورة.',
              'Ex. : pièce manquante, à représenter avec la facture.',
              'e.g. missing document; resubmit with the invoice attached.',
            )}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Decline a handoff
 * ------------------------------------------------------------------ */

/**
 * The note that is not bookkeeping.
 *
 * `decline_spine_handoff_command` requires it — `private.spine_decline_handoff`
 * trims what it is handed and refuses an empty string — so the button stays disabled
 * until there is something to send. That is the server's rule mirrored rather than a
 * stricter guess of our own: `note.trim() === ''` is the same test the function
 * makes, and nobody should be able to press a button whose only outcome is a refusal
 * from the database.
 *
 * The requirement is not what makes the field matter. A declined handoff is finished
 * — nothing reopens it, so the department that asked has to open a new one — and
 * this note is the entire answer they get. "No" leaves them guessing what to fix;
 * "no, the passport scan is unreadable" tells them what to send. So the dialog names
 * the desk that will read it, and the hint says it is an answer and not a record.
 */
export function DeclineDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly item: WorkItem;
  readonly busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const { t, tr } = useApp().locale;
  const [note, setNote] = useState('');
  // The stage the handoff came *from* is the desk waiting on the answer. Null only
  // if something opened this dialog on a row that is not a handoff, and then the
  // copy says "the department that asked" rather than naming the wrong one.
  const asking = item.handoff === null ? null : t(STAGE_LABEL[item.handoff.fromStage]);
  return (
    <Dialog
      open
      title={tr('رفض التحويل', 'Refuser la transmission', 'Decline handoff')}
      onClose={onCancel}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      width={480}
      primary={{
        label: tr('رفض', 'Refuser', 'Decline'),
        onClick: () => onConfirm(note),
        disabled: note.trim() === '',
        busy,
        danger: true,
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="fx-mono fx-title-ellipsis" style={{ fontWeight: 600 }}>
            {item.title}
          </span>
          <Badge tone={item.tone}>{t(item.badge)}</Badge>
        </div>
        <InfoBar tone="warning" icon={AlertTriangle}>
          {asking === null
            ? tr(
                'الرفض يُعيد سببك إلى القسم الذي طلب، وهو ينتظر الجواب. التحويل المرفوض منتهٍ: إن لزم أن يعود العمل فعلى القسم أن يطلب من جديد.',
                'Refuser renvoie votre motif au service demandeur, qui attend cette réponse. Une transmission refusée est close : si le travail doit revenir, le service devra le demander à nouveau.',
                'Declining sends your reason back to the department that asked, which is waiting on it. A declined handoff is finished: if the work has to come back, that desk must ask again.',
              )
            : tr(
                // «قسم» carries the agreement so the sentence reads for all twelve
                // labels: some are feminine («المحاسبة»), some masculine («التدقيق»).
                `الرفض يُعيد سببك إلى قسم ${asking}، وهو ينتظر الجواب. التحويل المرفوض منتهٍ: إن لزم أن يعود العمل فعلى القسم أن يطلب من جديد.`,
                `Refuser renvoie votre motif au service ${asking}, qui attend cette réponse. Une transmission refusée est close : si le travail doit revenir, le service devra le demander à nouveau.`,
                `Declining sends your reason back to the ${asking} desk, which is waiting on it. A declined handoff is finished: if the work has to come back, that desk must ask again.`,
              )}
        </InfoBar>
        <Field
          label={tr('السبب', 'Motif', 'Reason')}
          required
          hint={tr(
            'إلزامي. هذا هو الجواب الذي يقرأه القسم الطالب، لا ملاحظة للأرشيف.',
            'Obligatoire. C’est la réponse que lira le service demandeur, pas une note de classement.',
            'Required. This is the answer the asking desk reads, not a note for the file.',
          )}
        >
          <TextArea
            value={note}
            onChange={setNote}
            rows={3}
            placeholder={tr(
              'مثال: صورة جواز السفر غير مقروءة؛ افتحوا تحويلًا جديدًا بنسخة أوضح.',
              'Ex. : scan du passeport illisible ; ouvrez une nouvelle transmission avec une copie nette.',
              'e.g. the passport scan is unreadable; open a new handoff with a clearer copy.',
            )}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Approve with a note
 * ------------------------------------------------------------------ */

export interface NoteDialogProps {
  readonly item: WorkItem;
  readonly busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

/** An approval with something to say. Empty is allowed, and stays absent. */
export function NoteDialog({ item, busy, onCancel, onConfirm }: NoteDialogProps) {
  const { tr } = useApp().locale;
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      title={tr('اعتماد مع ملاحظة', 'Approuver avec une note', 'Approve with a note')}
      onClose={onCancel}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      width={480}
      primary={{ label: tr('اعتماد', 'Approuver', 'Approve'), onClick: () => onConfirm(note), busy }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <span className="fx-mono fx-title-ellipsis" style={{ fontWeight: 600 }}>
          {item.title}
        </span>
        <Field
          label={tr('الملاحظة', 'Note', 'Note')}
          hint={tr(
            'اختيارية. تُحفظ في سجل التدقيق كسبب الاعتماد.',
            'Facultative. Conservée dans le journal d’audit comme motif.',
            'Optional. Stored in the audit trail as the approval’s reason.',
          )}
        >
          <TextArea
            value={note}
            onChange={setNote}
            rows={3}
            placeholder={tr(
              'مثال: تحقّقت من الفاتورة مع المورّد.',
              'Ex. : facture vérifiée auprès du fournisseur.',
              'e.g. invoice checked against the supplier’s copy.',
            )}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Sweep report
 * ------------------------------------------------------------------ */

export interface SweepDialogProps {
  readonly report: SweepReport;
  onClose: () => void;
}

/**
 * What the batch actually did.
 *
 * A run that stopped is reported as stopped rather than as a pile of failures: the
 * kernel refused consent, every remaining entry would have been refused the same
 * way, and the count of what was not attempted is the useful number.
 */
export function SweepDialog({ report, onClose }: SweepDialogProps) {
  const { tr, lang } = useApp().locale;
  const nothing = report.approved === 0 && report.failed === 0;
  return (
    <Dialog
      open
      title={tr('نتيجة الدفعة', 'Résultat du lot', 'Batch result')}
      onClose={onClose}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
      width={440}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {nothing ? (
          <InfoBar tone="info">
            {tr('لم يُعتمد شيء.', 'Rien n’a été approuvé.', 'Nothing was approved.')}
          </InfoBar>
        ) : (
          <div style={{ display: 'grid', gap: 6, fontSize: 'var(--fx-body)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} aria-hidden style={{ color: 'var(--fx-success)' }} />
              {tr(
                `${fmt.integer(report.approved, lang)} قيدًا اعتُمد`,
                `${fmt.integer(report.approved, lang)} écritures approuvées`,
                `${fmt.integer(report.approved, lang)} approved`,
              )}
            </span>
            {report.failed === 0 ? null : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} aria-hidden style={{ color: 'var(--fx-warning)' }} />
                {tr(
                  `${fmt.integer(report.failed, lang)} تعذّر`,
                  `${fmt.integer(report.failed, lang)} en échec`,
                  `${fmt.integer(report.failed, lang)} failed`,
                )}
              </span>
            )}
          </div>
        )}
        {report.stopped ? (
          <InfoBar
            tone="warning"
            icon={ShieldAlert}
            title={tr('توقّفت الدفعة', 'Lot interrompu', 'The batch stopped')}
          >
            {tr(
              'النظام لم يمنح الصلاحية، فلم تُحاول البنود الباقية.',
              'Le système n’a pas accordé le privilège ; le reste n’a pas été tenté.',
              'The system did not grant the privilege, so the rest was never attempted.',
            )}
          </InfoBar>
        ) : null}
        {report.firstError === null ? null : (
          <InfoBar tone="danger" icon={Ban} title={tr('أول خطأ', 'Première erreur', 'First error')}>
            {report.firstError}
          </InfoBar>
        )}
      </div>
    </Dialog>
  );
}
