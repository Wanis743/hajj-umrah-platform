/**
 * Ledger — the one dialog: an account, created or edited.
 *
 * The same form does both, because `upsert_chart_account` does both. What changes
 * between the two is not the shape but what is still open: on an account that has
 * been posted to, the type is fixed, and the field says so instead of letting the
 * RPC come back with `P0001` after the save button has already been pressed.
 *
 * The primary button is disabled on a blocking problem and on a draft that changed
 * nothing. The second of those is not politeness — `account.update` writes an audit
 * row, and a book whose trail is half "no-op saves" is a trail nobody reads.
 *
 * Warnings never block. "This code starts with a digit other accounts of this type
 * do not use" is worth saying and never worth refusing: it is this chart's habit,
 * not a rule of accounting, and the person filing the account knows which it is.
 */
import { useMemo } from 'react';
import { Checkbox, Dialog, Field, InfoBar, Input, Select, useApp } from '@/platform/sdk';
import {
  type Account,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  accountLabel,
  CURRENCIES,
  type Currency,
  toAccountType,
  toCurrency,
} from '../shared/ledger';
import {
  type AccountDraft,
  blocks,
  type DraftPatch,
  isUnchanged,
  natureOf,
  parentChoices,
  type Problem,
  type ProblemField,
  validateAccount,
} from './form';

export interface AccountDialogProps {
  readonly open: boolean;
  readonly draft: AccountDraft;
  /** The row being edited, so an unchanged draft can be recognised. Null when new. */
  readonly original: Account | null;
  /** The whole page, which is what duplicate codes and cycles are checked against. */
  readonly accounts: readonly Account[];
  readonly busy: boolean;
  readonly onPatch: (patch: DraftPatch) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}

export function AccountDialog({
  open,
  draft,
  original,
  accounts,
  busy,
  onPatch,
  onSubmit,
  onClose,
}: AccountDialogProps) {
  const { t, tr } = useApp().locale;
  const problems = useMemo(() => validateAccount(draft, accounts), [draft, accounts]);
  const parents = useMemo(() => parentChoices(accounts, draft), [accounts, draft]);
  const creating = draft.id === null;
  const unchanged = !creating && isUnchanged(draft, original);
  const errorOf = (...fields: readonly ProblemField[]): string | null => {
    const hit = problems.find((problem) => problem.blocking && fields.includes(problem.field));
    return hit === undefined ? null : t(hit.text);
  };
  return (
    <Dialog
      open={open}
      title={
        creating
          ? tr('حساب جديد', 'Nouveau compte', 'New account')
          : tr('تعديل الحساب', 'Modifier le compte', 'Edit account')
      }
      onClose={onClose}
      width={520}
      primary={{
        label: creating ? tr('إنشاء', 'Créer', 'Create') : tr('حفظ', 'Enregistrer', 'Save'),
        onClick: onSubmit,
        disabled: blocks(problems) || unchanged,
        busy,
      }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <AccountFields draft={draft} parents={parents} creating={creating} onPatch={onPatch} errorOf={errorOf} />
        <ProblemList problems={problems} />
        {!unchanged ? null : (
          <InfoBar title={tr('لا تغيير', 'Aucun changement', 'Nothing changed')}>
            {tr(
              'الحفظ سيكتب سطرًا في سجل التدقيق دون أن يغيّر شيئًا.',
              'Enregistrer écrirait une ligne d’audit sans rien changer.',
              'Saving would write an audit row without changing anything.',
            )}
          </InfoBar>
        )}
      </div>
    </Dialog>
  );
}

interface AccountFieldsProps {
  readonly draft: AccountDraft;
  readonly parents: readonly Account[];
  readonly creating: boolean;
  readonly onPatch: (patch: DraftPatch) => void;
  readonly errorOf: (...fields: readonly ProblemField[]) => string | null;
}

/**
 * Five inputs, in the order the RPC cares about them.
 *
 * The parent list is `parentChoices`, which has already removed the account and
 * everything under it — a cycle is easier to prevent in the options than to explain
 * after the fact, and the SQL only refuses the one-step case anyway.
 */
function AccountFields({ draft, parents, creating, onPatch, errorOf }: AccountFieldsProps) {
  const { t, tr } = useApp().locale;
  const nature = natureOf(draft.type);
  const frozen = draft.frozenType !== null;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 128px', gap: 10 }}>
        <Field label={tr('الرمز', 'Code', 'Code')} required error={errorOf('code', 'duplicate')}>
          <Input
            value={draft.code}
            onChange={(next) => onPatch({ code: next })}
            mono
            autoFocus
            maxLength={24}
            invalid={errorOf('code', 'duplicate') !== null}
            placeholder="4110"
          />
        </Field>
        <Field label={tr('العملة', 'Devise', 'Currency')}>
          <Select
            value={draft.currency}
            onChange={(next) => onPatch({ currency: toCurrency(next) })}
            options={CURRENCIES.map((code: Currency) => ({ value: code, label: code }))}
          />
        </Field>
      </div>
      <Field label={tr('الاسم', 'Nom', 'Name')} required error={errorOf('name')}>
        <Input
          value={draft.name}
          onChange={(next) => onPatch({ name: next })}
          maxLength={160}
          invalid={errorOf('name') !== null}
          placeholder={tr('عملاء – حجّ', 'Clients – Hajj', 'Customers – Hajj')}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field
          label={tr('النوع', 'Nature', 'Type')}
          required
          error={errorOf('retype')}
          hint={
            frozen
              ? tr(
                  'الحساب به حركة، فالنوع مثبّت.',
                  'Le compte a des mouvements : la nature est verrouillée.',
                  'The account has postings, so the type is fixed.',
                )
              : `${
                  nature.debit
                    ? tr('يزيد بالمدين', 'Augmente au débit', 'Increases on debit')
                    : tr('يزيد بالدائن', 'Augmente au crédit', 'Increases on credit')
                } · ${
                  nature.statement === 'balance'
                    ? tr('الميزانية', 'Bilan', 'Balance sheet')
                    : tr('قائمة النتائج', 'Compte de résultat', 'Income statement')
                }`
          }
        >
          <Select
            value={draft.type}
            disabled={frozen}
            onChange={(next) => {
              const type = toAccountType(next);
              if (type !== null) onPatch({ type });
            }}
            options={ACCOUNT_TYPES.map((type) => ({ value: type, label: t(ACCOUNT_TYPE_LABEL[type]) }))}
          />
        </Field>
        <Field label={tr('الحساب الأب', 'Compte parent', 'Parent')} error={errorOf('parent', 'cycle')}>
          <Select
            value={draft.parentId ?? ''}
            onChange={(next) => onPatch({ parentId: next === '' ? null : next })}
            options={[
              { value: '', label: tr('— جذر —', '— Racine —', '— Root —') },
              ...parents.map((account) => ({ value: account.id, label: accountLabel(account) })),
            ]}
          />
        </Field>
      </div>
      {creating ? null : (
        <Checkbox
          checked={draft.active}
          onChange={(next) => onPatch({ active: next })}
          label={tr('مفعّل', 'Actif', 'Active')}
        />
      )}
    </>
  );
}

interface ProblemListProps {
  readonly problems: readonly Problem[];
}

/**
 * The advisory half.
 *
 * Blocking problems are already printed under the field they belong to, so repeating
 * them here would say everything twice. What is left are the habits of this chart —
 * numbering, an inactive parent, a parent that has postings of its own — and each of
 * those is a reason to look again rather than a reason to stop.
 */
function ProblemList({ problems }: ProblemListProps) {
  const { t, tr } = useApp().locale;
  const soft = problems.filter((problem) => !problem.blocking);
  if (soft.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {soft.map((problem) => (
        <InfoBar key={problem.field} tone="warning" title={tr('للتحقق', 'À vérifier', 'Worth a look')}>
          {t(problem.text)}
        </InfoBar>
      ))}
    </div>
  );
}
