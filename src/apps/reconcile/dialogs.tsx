/**
 * Reconciliation — the one dialog.
 *
 * The sweep is the only act here that does many things at once, so it is the only
 * one that has to report back. Everything else is a single pairing whose result is
 * visible in the grid a moment later, and a modal for that would be a modal for
 * nothing.
 *
 * There is deliberately no confirmation dialog in front of the sweep. `reconcile.match`
 * carries `ledger.post`, which is a privileged capability, so the kernel raises its own
 * consent prompt before the first call lands. A second prompt written by the app would
 * teach people to dismiss both.
 */
import { AlertTriangle, BadgeCheck, CheckCheck, ShieldAlert } from 'lucide-react';
import { Dialog, InfoBar, PropertyRow, fmt, useApp } from '@/platform/sdk';
import type { SweepReport } from './actions';

export interface SweepDialogProps {
  readonly report: SweepReport | null;
  readonly onClose: () => void;
}

/**
 * What the sweep actually did.
 *
 * `stopped` is the case worth the words: the batch does not push on past a refused
 * privilege, so a run that ends early has left the remaining pairings *untried* rather
 * than failed. Saying so is the difference between "nothing else could be matched" and
 * "nothing else was attempted", and only one of those is true.
 */
export function SweepDialog({ report, onClose }: SweepDialogProps) {
  const { tr, lang } = useApp().locale;
  if (report === null) return null;
  const clean = report.failed === 0 && !report.stopped;
  return (
    <Dialog
      open
      title={tr('نتيجة المطابقة التلقائية', 'Résultat du rapprochement automatique', 'Auto-match result')}
      onClose={onClose}
      width={460}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {clean ? (
          <InfoBar
            tone={report.matched === 0 ? 'info' : 'success'}
            icon={report.matched === 0 ? CheckCheck : BadgeCheck}
            title={
              report.matched === 0
                ? tr('لا شيء مؤكد', 'Rien de certain', 'Nothing certain')
                : tr('تمّت المطابقة', 'Rapprochement effectué', 'Matched')
            }
          >
            {report.matched === 0
              ? tr(
                  'لا سطر يستوفي شرط اليقين: مبلغ مطابق، اتجاه واحد، ومرشّح واحد لا ثاني له.',
                  'Aucune ligne ne remplit la condition de certitude : montant exact, même sens, un seul candidat.',
                  'No line met the certainty rule: exact amount, same direction, and no second candidate.',
                )
              : tr(
                  `${fmt.integer(report.matched, lang)} سطرًا رُبط بمقابله في الدفتر.`,
                  `${fmt.integer(report.matched, lang)} lignes ont été liées à leur contrepartie au livre.`,
                  `${fmt.integer(report.matched, lang)} lines were tied to their counterpart in the book.`,
                )}
          </InfoBar>
        ) : null}
        <div>
          <PropertyRow label={tr('مُطابَق', 'Rapprochées', 'Matched')}>
            {fmt.integer(report.matched, lang)}
          </PropertyRow>
          <PropertyRow label={tr('مرفوض', 'Refusées', 'Refused')}>{fmt.integer(report.failed, lang)}</PropertyRow>
        </div>
        {report.stopped ? (
          <InfoBar
            tone="warning"
            icon={ShieldAlert}
            title={tr('توقّفت الدفعة', 'Le lot s’est arrêté', 'The batch stopped')}
          >
            {tr(
              'لم يُمنح النظام الصلاحية المطلوبة، فلم تُجرَّب بقية الأسطر أصلًا. أعد المحاولة واقبل الطلب لإتمامها.',
              'Le privilège demandé n’a pas été accordé : les lignes restantes n’ont pas même été tentées. Relancez et acceptez la demande pour les terminer.',
              'The privilege was not granted, so the remaining lines were never attempted. Run it again and accept the prompt to finish them.',
            )}
          </InfoBar>
        ) : null}
        {report.firstError === null ? null : (
          <InfoBar
            tone="danger"
            icon={AlertTriangle}
            title={tr('أول رفض', 'Premier refus', 'First refusal')}
          >
            {report.firstError}
          </InfoBar>
        )}
      </div>
    </Dialog>
  );
}
