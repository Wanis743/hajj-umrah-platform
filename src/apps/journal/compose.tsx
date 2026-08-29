/**
 * Journal — the compose dialog and the void-reason dialog.
 *
 * The compose dialog is a view over `draft.ts` and holds no state of its own: it
 * takes a draft, reports the next one, and shows what is still wrong with it. All
 * the arithmetic is upstream, in integer centimes, which is why the difference
 * shown here is the same number the server will compare.
 *
 * Every problem is listed at once rather than one at a time. Fixing a reference,
 * being shown the date, fixing the date, being shown a missing account is how a
 * form wastes an afternoon; the primary button stays disabled until the list is
 * empty, and the list says what would have to change.
 *
 * The void dialog is not a confirmation — `void_journal_entry` requires a reason,
 * and this is where that sentence is typed. The kernel raises consent for the
 * privileged capability on its own.
 */
import { Plus, Save, Scale, Trash2, Undo2 } from 'lucide-react';
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Select,
  TextArea,
  fmt,
  useApp,
} from '@/platform/sdk';
import { type Account, CURRENCIES, type Currency, type JournalEntry, accountLabel } from '../shared/ledger';
import type { JournalBusy } from './actions';
import {
  type Draft,
  type DraftLine,
  MAX_LINES,
  MIN_LINES,
  autoBalance,
  addLine,
  draftTotals,
  minorOf,
  patchLine,
  removeLine,
  validateDraft,
  withField,
} from './draft';

export interface ComposeDialogProps {
  readonly open: boolean;
  readonly draft: Draft;
  readonly onDraft: (next: Draft) => void;
  readonly accounts: readonly Account[];
  readonly busy: JournalBusy;
  readonly onClose: () => void;
  readonly onCreate: () => void;
  readonly onSaveFile: () => void;
}

export function ComposeDialog({
  open,
  draft,
  onDraft,
  accounts,
  busy,
  onClose,
  onCreate,
  onSaveFile,
}: ComposeDialogProps) {
  const { t, tr, lang } = useApp().locale;
  const totals = draftTotals(draft);
  const problems = validateDraft(draft);
  const currency: Currency = draft.currency === 'SAR' ? 'SAR' : 'DZD';
  const options = accounts.map((account) => ({
    value: account.id,
    label: accountLabel(account),
    disabled: !account.active,
  }));

  return (
    <Dialog
      open={open}
      width={900}
      onClose={onClose}
      title={
        draft.path === null
          ? tr('قيد يومية جديد', 'Nouvelle écriture', 'New journal entry')
          : tr('مسودة من ملف', 'Brouillon ouvert', 'Draft from a file')
      }
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: tr('إنشاء القيد', 'Créer l’écriture', 'Create entry'),
        onClick: onCreate,
        disabled: problems.length > 0,
        busy: busy === 'create',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <DraftHeader draft={draft} onDraft={onDraft} />

        <div
          className="fx-scroll"
          style={{
            maxHeight: 268,
            overflowY: 'auto',
            border: '1px solid var(--fx-stroke)',
            borderRadius: 6,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 200px 118px 118px 64px',
              gap: 6,
              padding: '6px 8px',
              position: 'sticky',
              top: 0,
              background: 'var(--fx-layer-alt)',
              backdropFilter: 'blur(20px)',
              fontSize: 11,
              color: 'var(--fx-text-secondary)',
            }}
          >
            <span>{tr('الحساب', 'Compte', 'Account')}</span>
            <span>{tr('البيان', 'Note', 'Memo')}</span>
            <span style={{ textAlign: 'end' }}>{tr('مدين', 'Débit', 'Debit')}</span>
            <span style={{ textAlign: 'end' }}>{tr('دائن', 'Crédit', 'Credit')}</span>
            <span />
          </div>
          {draft.lines.map((line) => (
            <DraftRow
              key={line.key}
              line={line}
              options={options}
              canRemove={draft.lines.length > MIN_LINES}
              onPatch={(patch) => onDraft(patchLine(draft, line.key, patch))}
              onBalance={() => onDraft(autoBalance(draft, line.key))}
              onRemove={() => onDraft(removeLine(draft, line.key))}
            />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            icon={Plus}
            disabled={draft.lines.length >= MAX_LINES}
            onClick={() => onDraft(addLine(draft))}
            title={
              draft.lines.length >= MAX_LINES
                ? tr(
                    `الحد ${String(MAX_LINES)} سطرًا للقيد الواحد.`,
                    `Limite de ${String(MAX_LINES)} lignes par écriture.`,
                    `The limit is ${String(MAX_LINES)} lines per entry.`,
                  )
                : undefined
            }
          >
            {tr('سطر جديد', 'Ajouter une ligne', 'Add line')}
          </Button>
          <Button size="sm" variant="subtle" icon={Save} busy={busy === 'save'} onClick={onSaveFile}>
            {tr('حفظ كمسودة…', 'Enregistrer le brouillon…', 'Save draft to file…')}
          </Button>
          <div style={{ flex: 1 }} />
          <span className="fx-mono" style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}>
            {tr('مدين', 'Débit', 'Debit')} {fmt.money(totals.debit, currency, lang)}
          </span>
          <span className="fx-mono" style={{ fontSize: 12, color: 'var(--fx-text-secondary)' }}>
            {tr('دائن', 'Crédit', 'Credit')} {fmt.money(totals.credit, currency, lang)}
          </span>
          <span
            className="fx-mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              color: totals.difference === 0 ? 'var(--fx-success)' : 'var(--fx-danger)',
            }}
          >
            <Scale size={13} />
            {totals.difference === 0
              ? tr('متوازن', 'Équilibré', 'Balanced')
              : `${tr('الفرق', 'Écart', 'Off by')} ${fmt.money(Math.abs(totals.difference), currency, lang)}`}
          </span>
        </div>

        {problems.length === 0 ? null : (
          <ul
            style={{
              margin: 0,
              paddingInlineStart: 20,
              fontSize: 12,
              color: 'var(--fx-danger)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {problems.map((problem) => (
              <li key={problem.field}>{t(problem.text)}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

interface DraftHeaderProps {
  readonly draft: Draft;
  readonly onDraft: (next: Draft) => void;
}

/**
 * The four fields that describe the entry rather than its lines.
 *
 * The reference is marked invalid while it is empty rather than after a failed
 * submit: it is the one field a person cannot guess the requirement for, and the
 * problem list below already explains why the button is disabled.
 */
function DraftHeader({ draft, onDraft }: DraftHeaderProps) {
  const { tr } = useApp().locale;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ width: 200 }}>
        <Field label={tr('المرجع', 'Référence', 'Reference')} required>
          <Input
            value={draft.reference}
            onChange={(next) => onDraft(withField(draft, 'reference', next))}
            mono
            placeholder="JV-2026-0001"
            invalid={draft.reference.trim() === ''}
          />
        </Field>
      </div>
      <div style={{ width: 170 }}>
        <Field label={tr('التاريخ', 'Date', 'Date')} required>
          <Input
            type="date"
            value={draft.date}
            onChange={(next) => onDraft(withField(draft, 'date', next))}
          />
        </Field>
      </div>
      <div style={{ width: 130 }}>
        <Field label={tr('العملة', 'Devise', 'Currency')}>
          <Select
            value={draft.currency}
            onChange={(next) => onDraft(withField(draft, 'currency', next))}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <Field
          label={tr('الوصف', 'Libellé', 'Description')}
          hint={tr('يظهر في الدفتر', 'Apparaît au journal', 'Shown in the book')}
        >
          <Input
            value={draft.description}
            onChange={(next) => onDraft(withField(draft, 'description', next))}
          />
        </Field>
      </div>
    </div>
  );
}

interface DraftRowProps {
  readonly line: DraftLine;
  readonly options: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[];
  readonly canRemove: boolean;
  readonly onPatch: (patch: Partial<Omit<DraftLine, 'key'>>) => void;
  readonly onBalance: () => void;
  readonly onRemove: () => void;
}

/**
 * One line of the draft.
 *
 * The amount fields are text and stay text — reformatting a number while it is
 * being typed is how a field becomes untypable — so `invalid` is the only
 * feedback until the value parses. `minorOf` returning null is what unreadable
 * means, here and on the way to the server.
 */
function DraftRow({ line, options, canRemove, onPatch, onBalance, onRemove }: DraftRowProps) {
  const { tr } = useApp().locale;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px 118px 118px 64px',
        gap: 6,
        padding: '4px 8px',
        alignItems: 'center',
      }}
    >
      <Select
        value={line.accountId}
        onChange={(next) => onPatch({ accountId: next })}
        options={options}
        placeholder={tr('اختر حسابًا', 'Choisir un compte', 'Pick an account')}
      />
      <Input value={line.memo} onChange={(next) => onPatch({ memo: next })} />
      <Input
        value={line.debit}
        onChange={(next) => onPatch({ debit: next })}
        mono
        invalid={minorOf(line.debit) === null}
        inputMode="decimal"
        style={{ textAlign: 'end' }}
      />
      <Input
        value={line.credit}
        onChange={(next) => onPatch({ credit: next })}
        mono
        invalid={minorOf(line.credit) === null}
        inputMode="decimal"
        style={{ textAlign: 'end' }}
      />
      <span style={{ display: 'inline-flex', gap: 2 }}>
        <IconButton
          icon={Scale}
          size={28}
          onClick={onBalance}
          label={tr('وازن هذا السطر', 'Équilibrer sur cette ligne', 'Balance on this line')}
        />
        <IconButton
          icon={Trash2}
          size={28}
          tone="danger"
          disabled={!canRemove}
          onClick={onRemove}
          label={tr('حذف السطر', 'Supprimer la ligne', 'Remove line')}
        />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Void
 * ------------------------------------------------------------------ */

export interface VoidDialogProps {
  readonly entry: JournalEntry | null;
  readonly reason: string;
  readonly onReason: (next: string) => void;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

/**
 * Collects the reason the RPC demands.
 *
 * A reversal without a stated cause is an audit trail that records what happened
 * and not why, so the button stays disabled until something is written. This is
 * not the consent prompt: the kernel raises that one for `ledger.post`.
 */
export function VoidDialog({ entry, reason, onReason, busy, onClose, onConfirm }: VoidDialogProps) {
  const { tr, lang } = useApp().locale;
  return (
    <Dialog
      open={entry !== null}
      width={520}
      onClose={onClose}
      title={tr('إلغاء القيد بقيد معاكس', 'Annuler par contre-passation', 'Void with a reversal')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: tr('إلغاء القيد', 'Annuler l’écriture', 'Void the entry'),
        onClick: onConfirm,
        disabled: reason.trim() === '',
        danger: true,
        busy,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fx-text-secondary)' }}>
          {entry === null
            ? null
            : tr(
                `القيد ${entry.reference} بتاريخ ${fmt.date(entry.date, lang)} سيُعكس. الأصل يبقى في الدفاتر.`,
                `L’écriture ${entry.reference} du ${fmt.date(entry.date, lang)} sera contre-passée. L’original reste au journal.`,
                `Entry ${entry.reference} of ${fmt.date(entry.date, lang)} will be reversed. The original stays in the books.`,
              )}
        </p>
        <Field
          label={tr('السبب', 'Motif', 'Reason')}
          required
          hint={tr('يُكتب في سجل التدقيق.', 'Consigné dans la piste d’audit.', 'Written into the audit trail.')}
        >
          <TextArea
            value={reason}
            onChange={onReason}
            rows={3}
            placeholder={tr('خطأ في الحساب…', 'Erreur d’imputation…', 'Posted to the wrong account…')}
          />
        </Field>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fx-text-secondary)' }}>
          <Undo2 size={13} />
          {tr(
            'الإلغاء لا يحذف شيئًا؛ يضيف قيدًا معاكسًا.',
            'L’annulation ne supprime rien : elle ajoute une écriture inverse.',
            'Voiding deletes nothing; it adds the opposite entry.',
          )}
        </span>
      </div>
    </Dialog>
  );
}
