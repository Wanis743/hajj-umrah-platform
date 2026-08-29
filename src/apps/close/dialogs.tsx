/**
 * Period close — the one dialog.
 *
 * Reopening is privileged, so the kernel already asked whether the user means it. This
 * dialog exists for a different reason: `reopen_fiscal_period` refuses to run without a
 * reason, and collecting a required field is the app's job. The text lands on the period
 * and in the audit trail, which is where somebody will read it in eleven months.
 *
 * There is deliberately no dialog in front of the close. The kernel raises consent for
 * `ledger.close`; a second prompt saying the same thing teaches people to click through
 * both.
 */
import { Dialog, Field, InfoBar, TextArea, useLocale } from '@/platform/sdk';
import type { FiscalPeriod } from '../shared/ledger';

interface ReopenDialogProps {
  readonly open: boolean;
  readonly period: FiscalPeriod | null;
  readonly reason: string;
  readonly busy: boolean;
  onReason: (next: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ReopenDialog({ open, period, reason, busy, onReason, onConfirm, onClose }: ReopenDialogProps) {
  const { tr } = useLocale();
  const label = period === null ? '' : period.label;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title={tr(`إعادة فتح ${label}`, `Réouvrir ${label}`, `Reopen ${label}`)}
      primary={{
        label: tr('إعادة الفتح', 'Réouvrir', 'Reopen'),
        onClick: onConfirm,
        disabled: reason.trim() === '',
        busy,
        danger: true,
      }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InfoBar tone="warning" title={tr('أرقام مُبلَّغ عنها', 'Des chiffres déjà publiés', 'Numbers already reported')}>
          {tr(
            'أرقام هذه الفترة نهائية بالنسبة لمن قرأها. إعادة الفتح تسمح بتعديلها، ويُسجَّل السبب.',
            'Pour ceux qui les ont lus, les chiffres de cette période sont définitifs. La réouverture permet de les modifier, et le motif est journalisé.',
            'To everybody who has read them, this period’s numbers are final. Reopening allows them to change, and the reason is logged.',
          )}
        </InfoBar>
        <Field
          label={tr('السبب', 'Motif', 'Reason')}
          required
          hint={tr(
            'يُخزَّن مع الفترة وفي سجل التدقيق.',
            'Conservé avec la période et dans la piste d’audit.',
            'Stored with the period and in the audit trail.',
          )}
        >
          <TextArea
            value={reason}
            onChange={onReason}
            rows={3}
            placeholder={tr(
              'مثال: قيد إطفاء مفقود لشهر مارس.',
              'Ex. : écriture d’amortissement de mars manquante.',
              'e.g. March depreciation entry was missing.',
            )}
          />
        </Field>
      </div>
    </Dialog>
  );
}
