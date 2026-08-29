/**
 * Modeling — the one dialog.
 *
 * An override is not a write. It replaces a computed number with a typed one for the length
 * of this window's life, and nothing about it reaches the book: no capability, no consent
 * prompt, no row in the ledger. So the dialog says that plainly rather than asking whether
 * the user is sure — there is nothing here to be sure about.
 *
 * The amount is per month, because that is the unit every driver produces and the unit the
 * horizon multiplies. Asking for the horizon total instead would mean the same typed number
 * changed meaning whenever the horizon segment was clicked.
 *
 * What the driver said is shown beside what the typed number will say, and the difference
 * between them is spelled out. An override that lands within a rounding of the model is
 * usually a misunderstanding, and it is cheaper to see it here than in the export.
 */
import { Dialog, Field, fmt, InfoBar, Input, useLocale } from '@/platform/sdk';
import type { ForecastRow, Scenario } from './forecast';

interface OverrideDialogProps {
  readonly open: boolean;
  readonly row: ForecastRow | null;
  readonly scenario: Scenario;
  readonly value: string;
  onValue: (next: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function OverrideDialog(props: OverrideDialogProps) {
  const { open, row, scenario, value, onValue, onConfirm, onClose } = props;
  const { tr } = useLocale();
  const monthly = fmt.parseAmount(value);
  const account = row === null ? '' : `${row.account.code} · ${row.account.name}`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title={tr(`تعيين الرقم — ${account}`, `Fixer le nombre — ${account}`, `Set the number — ${account}`)}
      primary={{
        label: tr('تثبيت', 'Appliquer', 'Apply'),
        onClick: onConfirm,
        disabled: monthly === null,
      }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InfoBar title={tr('لا يمسّ الدفتر', 'Ne touche pas le livre', 'The book is untouched')}>
          {tr(
            'الرقم يبقى في هذه النافذة ويظهر في التصدير كـ«يدوي». لا يُكتب في الدفتر ولا يُحفظ بعد الإغلاق.',
            'Le nombre reste dans cette fenêtre et ressort dans l’export comme « manuel ». Rien n’est écrit dans le livre, rien n’est conservé après fermeture.',
            'The number stays in this window and leaves in the export marked “typed”. Nothing is written to the book, and nothing survives closing it.',
          )}
        </InfoBar>
        <Field
          label={tr('المبلغ الشهري', 'Montant mensuel', 'Amount per month')}
          required
          error={
            value.trim() !== '' && monthly === null
              ? tr('مبلغ غير مقروء', 'Montant illisible', 'Not a readable amount')
              : null
          }
          hint={tr(
            `يُكرَّر على ${scenario.horizon} شهرًا من الأفق، ولا تُضاف إليه زيادة التكاليف.`,
            `Répété sur les ${scenario.horizon} mois de l’horizon, sans inflation des charges.`,
            `Repeated across all ${scenario.horizon} months of the horizon, with no cost uplift added.`,
          )}
        >
          <Input value={value} onChange={onValue} mono inputMode="decimal" autoFocus onEnter={onConfirm} />
        </Field>
        {row === null || monthly === null ? null : (
          <Preview row={row} monthly={monthly} horizon={scenario.horizon} />
        )}
      </div>
    </Dialog>
  );
}
interface PreviewProps {
  readonly row: ForecastRow;
  readonly monthly: number;
  readonly horizon: number;
}

/**
 * The arithmetic, before it is applied.
 *
 * "Now" is whatever the pane is showing — the driver's total, or an earlier override, since
 * `total` already carries one. That makes the last line a straight before-and-after rather
 * than a comparison against a number nobody can see any more.
 */
function Preview({ row, monthly, horizon }: PreviewProps) {
  const { tr, lang } = useLocale();
  const total = monthly * horizon;
  const rows: readonly { readonly label: string; readonly text: string; readonly bold: boolean }[] = [
    {
      label: tr('متوسّط النظر شهريًا', 'Moyenne mensuelle de la fenêtre', 'Window average per month'),
      text: fmt.money(row.average, 'DZD', lang),
      bold: false,
    },
    { label: tr('الآن', 'Actuellement', 'Now'), text: fmt.money(row.total, 'DZD', lang), bold: false },
    { label: tr('بعد التثبيت', 'Après application', 'After applying'), text: fmt.money(total, 'DZD', lang), bold: true },
    {
      label: tr('الفرق', 'Différence', 'Change'),
      text: fmt.money(total - row.total, 'DZD', lang),
      bold: false,
    },
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
