/**
 * Budgets — the one dialog.
 *
 * `budget.upsert` is privileged (it carries `ledger.post`), so the kernel has already
 * asked whether the user means it. This dialog is not a confirmation and does not repeat
 * the question: it collects the amount, which is the one thing the kernel cannot ask for.
 *
 * Both currency amounts are always written, because `upsert_budget_line` takes both and
 * a dinar-only call would zero the riyal plan. So the riyal field arrives pre-filled with
 * whatever is already on the line, and the hint says why it is there.
 *
 * The variance the save will produce is shown while it is still being typed. It is one
 * subtraction, and it is the number the person is actually reaching for.
 */
import { Dialog, Field, fmt, InfoBar, Input, useLocale } from '@/platform/sdk';
import type { PlanIntent } from './actions';
import type { VarianceRow } from './variance';

interface AmountDialogProps {
  readonly open: boolean;
  readonly row: VarianceRow | null;
  readonly dzd: string;
  readonly sar: string;
  readonly busy: boolean;
  /** `seed` arrives with the dinar field already filled from the posted actual. */
  readonly intent: PlanIntent;
  onDzd: (next: string) => void;
  onSar: (next: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function AmountDialog(props: AmountDialogProps) {
  const { open, row, dzd, sar, busy, intent, onDzd, onSar, onConfirm, onClose } = props;
  const { tr } = useLocale();
  const planned = fmt.parseAmount(dzd);
  const riyal = sar.trim() === '' ? 0 : fmt.parseAmount(sar);
  const valid = planned !== null && riyal !== null;
  const account = row === null ? '' : `${row.account.code} · ${row.account.name}`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title={tr(`تعيين المبلغ — ${account}`, `Définir le montant — ${account}`, `Set the amount — ${account}`)}
      primary={{ label: tr('حفظ', 'Enregistrer', 'Save'), onClick: onConfirm, disabled: !valid, busy }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {intent === 'seed' ? (
          <InfoBar title={tr('مأخوذ من المنفَّذ', 'Repris du réalisé', 'Taken from the actual')}>
            {tr(
              'المبلغ أدناه هو المنفَّذ المرحَّل لهذا الحساب. عدّله قبل الحفظ إن أردت.',
              'Le montant ci-dessous est le réalisé comptabilisé de ce compte. Modifiez-le avant d’enregistrer si besoin.',
              'The amount below is this account’s posted actual. Change it before saving if you mean something else.',
            )}
          </InfoBar>
        ) : null}
        <Field
          label={tr('المبلغ بالدينار', 'Montant en dinars', 'Amount in dinars')}
          required
          error={
            dzd.trim() !== '' && planned === null
              ? tr('مبلغ غير مقروء', 'Montant illisible', 'Not a readable amount')
              : null
          }
          hint={tr(
            'العملة الأساسية للدفتر، وهي التي يُقارَن بها المنفَّذ.',
            'La monnaie de tenue du livre : c’est elle qui se compare au réalisé.',
            'The book’s base currency, and the one the actual is compared against.',
          )}
        >
          <Input value={dzd} onChange={onDzd} mono inputMode="decimal" autoFocus onEnter={onConfirm} />
        </Field>
        <Field
          label={tr('المبلغ بالريال', 'Montant en riyals', 'Amount in riyals')}
          error={
            sar.trim() !== '' && riyal === null
              ? tr('مبلغ غير مقروء', 'Montant illisible', 'Not a readable amount')
              : null
          }
          hint={tr(
            'يُكتب مع كل حفظ. اتركه كما هو للحفاظ عليه — وفراغه يعني صفرًا.',
            'Écrit à chaque enregistrement. Laissez-le tel quel pour le conserver — vide vaut zéro.',
            'Written on every save. Leave it as it is to keep it — empty means zero.',
          )}
        >
          <Input value={sar} onChange={onSar} mono inputMode="decimal" onEnter={onConfirm} />
        </Field>
        {row === null || planned === null ? null : <Preview row={row} planned={planned} />}
      </div>
    </Dialog>
  );
}

/**
 * The arithmetic, before the write.
 *
 * Plan minus actual, in the same order the grid and the export put it, so the number in
 * the dialog is the number that will appear in the row afterwards.
 */
function Preview({ row, planned }: { readonly row: VarianceRow; readonly planned: number }) {
  const { tr, lang } = useLocale();
  const variance = planned - row.actual;
  const rows: readonly { readonly label: string; readonly text: string; readonly bold: boolean }[] = [
    { label: tr('المنفَّذ', 'Réalisé', 'Actual'), text: fmt.money(row.actual, 'DZD', lang), bold: false },
    { label: tr('الفرق بعد الحفظ', 'Écart après enregistrement', 'Variance after saving'), text: fmt.money(variance, 'DZD', lang), bold: true },
  ];
  return (
    <div
      style={{
        background: 'var(--fx-layer-alt)',
        borderRadius: 'var(--fx-radius-control)',
        display: 'grid',
        gap: 4,
        padding: '8px 10px',
      }}
    >
      {rows.map((entry) => (
        <div key={entry.label} style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>{entry.label}</span>
          <span className="fx-num" style={{ fontWeight: entry.bold ? 600 : 400 }}>
            {entry.text}
          </span>
        </div>
      ))}
    </div>
  );
}
