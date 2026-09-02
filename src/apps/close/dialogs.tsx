/**
 * Period close — the four dialogs.
 *
 * Reopening is privileged, so the kernel already asked whether the user means it. This
 * dialog exists for a different reason: `reopen_fiscal_period` refuses to run without a
 * reason, and collecting a required field is the app's job. The text lands on the period
 * and in the audit trail, which is where somebody will read it in eleven months.
 *
 * There is deliberately no dialog in front of the close. The kernel raises consent for
 * `ledger.close`; a second prompt saying the same thing teaches people to click through
 * both.
 *
 * The register's three are here for the same single reason: each of its commands has a
 * field the server will not run without. `controls.upsert` needs a code and
 * `controls.retire` needs a reason. The test form adds one rule of its own — a conclusion
 * that is not a pass has to say what was found — because the server would take that field
 * blank, and a finding nobody can read is not evidence of anything.
 */
import { Dialog, Field, InfoBar, Input, Segmented, Select, TextArea, useLocale } from '@/platform/sdk';
import type { FiscalPeriod } from '../shared/ledger';
import {
  CONTROL_FREQUENCY_LABEL,
  CONTROL_RESULT_LABEL,
  type ControlFrequency,
  type ControlResult,
  type FinancialControl,
} from './controls';
import type { ControlDraft } from './shell';

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

/* ------------------------------------------------------------------ *
 * The register's three
 * ------------------------------------------------------------------ *
 * One draft feeds all three forms, and each one reads only the fields it sends. That is
 * why nothing here spreads the draft into a payload: the retire reason sits in the same
 * object as the test note, and a form that sent everything it was handed would send both.
 */

/** Ordered as a schedule reads, most often to least — not alphabetically. */
const FREQUENCIES: readonly ControlFrequency[] = ['monthly', 'quarterly', 'annual', 'ad_hoc'];

/** A pass first, because most tests pass and the common answer should be the near one. */
const RESULTS: readonly ControlResult[] = ['passed', 'partial', 'failed'];

/**
 * The `Select` hands back a string; the draft holds the union.
 *
 * The fallback is the column's own default and not the current value: a select whose value
 * is none of its options is a projection that has changed shape, and `monthly` is what the
 * database would have chosen anyway.
 */
function asFrequency(value: string): ControlFrequency {
  return FREQUENCIES.find((entry) => entry === value) ?? 'monthly';
}

interface ControlFormDialogProps {
  readonly open: boolean;
  /** Null for a control that does not exist yet — the same form, a different title. */
  readonly target: FinancialControl | null;
  readonly draft: ControlDraft;
  readonly busy: boolean;
  onDraft: (patch: Partial<ControlDraft>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * New and edit are one form, because `controls.upsert` is one command.
 *
 * It is a PUT: all four columns are written every time. So the form opens on the row when
 * there is one — a description blanked by somebody who only meant to change the frequency
 * is an erasure, and it would not look like one in the trail afterwards.
 */
export function ControlFormDialog({ open, target, draft, busy, onDraft, onConfirm, onClose }: ControlFormDialogProps) {
  const { t, tr } = useLocale();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title={
        target === null
          ? tr('رقابة جديدة', 'Nouveau contrôle', 'New control')
          : tr(`تعديل ${target.code}`, `Modifier ${target.code}`, `Edit ${target.code}`)
      }
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: onConfirm,
        disabled: draft.code.trim() === '',
        busy,
      }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {target === null ? null : (
          <InfoBar title={tr('كل الحقول تُكتب', 'Tous les champs sont écrits', 'Every field is written')}>
            {tr(
              'يُحفظ النموذج كما هو: حقل تُفرّغه هنا يُفرَّغ على السجل.',
              'Le formulaire est enregistré tel quel : un champ que vous videz ici est vidé sur la fiche.',
              'The form is saved as it stands: a field you empty here is emptied on the record.',
            )}
          </InfoBar>
        )}
        <Field label={tr('الرمز', 'Code', 'Code')} required>
          <Input
            value={draft.code}
            onChange={(code) => onDraft({ code })}
            onEnter={onConfirm}
            mono
            placeholder={tr('مثال: CTL-BANK-01', 'Ex. : CTL-BANK-01', 'e.g. CTL-BANK-01')}
          />
        </Field>
        <Field label={tr('الوصف', 'Description', 'Description')}>
          <TextArea
            value={draft.description}
            onChange={(description) => onDraft({ description })}
            rows={3}
            placeholder={tr(
              'ما تؤكّده هذه الرقابة، بجملة واحدة.',
              'Ce que ce contrôle assure, en une phrase.',
              'What this control assures, in one sentence.',
            )}
          />
        </Field>
        <Field
          label={tr('المسؤول', 'Responsable', 'Owner')}
          hint={tr(
            'اتركه فارغًا إن لم يُعيَّن أحد بعد.',
            'Laissez vide si personne n’est encore désigné.',
            'Leave it empty when nobody is assigned yet.',
          )}
        >
          <Input
            value={draft.ownerRole}
            onChange={(ownerRole) => onDraft({ ownerRole })}
            placeholder={tr('مثال: المدير المالي', 'Ex. : Directeur financier', 'e.g. Finance manager')}
          />
        </Field>
        <Field
          label={tr('التواتر', 'Fréquence', 'Frequency')}
          hint={tr(
            'يحدّد متى تُعَدّ الرقابة متأخرة: شهر، ربع، سنة — أو أبدًا عند الحاجة.',
            'Décide quand le contrôle est en retard : un mois, un trimestre, un an — jamais pour un contrôle ponctuel.',
            'Decides when the control reads as overdue: a month, a quarter, a year — never, for an ad hoc one.',
          )}
        >
          <Select
            value={draft.frequency}
            onChange={(next) => onDraft({ frequency: asFrequency(next) })}
            options={FREQUENCIES.map((value) => ({ value, label: t(CONTROL_FREQUENCY_LABEL[value]) }))}
            width={240}
          />
        </Field>
      </div>
    </Dialog>
  );
}

interface ControlTestDialogProps {
  readonly open: boolean;
  /**
   * Nullable to match the shell's one draft, but a test without a control cannot be sent:
   * `recordTest` returns early, and the title falls back to nothing rather than guessing.
   */
  readonly target: FinancialControl | null;
  readonly draft: ControlDraft;
  readonly busy: boolean;
  onDraft: (patch: Partial<ControlDraft>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Recording a test, which is the one form here that writes evidence rather than a setting.
 *
 * It opens empty every time, deliberately. Last month's population and exceptions are
 * evidence of last month's test, and a form that carried them forward would be inviting
 * somebody to sign an assurance for work nobody did.
 */
export function ControlTestDialog({ open, target, draft, busy, onDraft, onConfirm, onClose }: ControlTestDialogProps) {
  const { t, tr } = useLocale();
  const code = target === null ? '' : target.code;
  // The server takes a blank `exceptions`; a finding that says nothing does not.
  const owed = draft.result !== 'passed' && draft.exceptions.trim() === '';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title={tr(`اختبار ${code}`, `Tester ${code}`, `Test ${code}`)}
      primary={{
        label: tr('تسجيل الاختبار', 'Enregistrer le test', 'Record the test'),
        onClick: onConfirm,
        disabled: target === null || owed,
        busy,
      }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InfoBar title={tr('يُسجَّل باسمك', 'Enregistré en votre nom', 'Recorded in your name')}>
          {tr(
            'يُخزَّن الاختبار بوقته وباسم من سجّله، ولا يُعدَّل بعد ذلك.',
            'Le test est conservé avec son horodatage et le nom de qui l’a enregistré, et ne se modifie pas ensuite.',
            'The test is kept with its timestamp and the name of whoever recorded it, and is not edited afterwards.',
          )}
        </InfoBar>
        <Field label={tr('النتيجة', 'Résultat', 'Result')} required>
          <Segmented
            value={draft.result}
            onChange={(result: ControlResult) => onDraft({ result })}
            options={RESULTS.map((value) => ({ value, label: t(CONTROL_RESULT_LABEL[value]) }))}
          />
        </Field>
        <Field
          label={tr('العيّنة', 'Population', 'Population')}
          hint={tr(
            'ما جرى فحصه فعلًا — لا ما كان يمكن فحصه.',
            'Ce qui a réellement été examiné — pas ce qui aurait pu l’être.',
            'What was actually examined — not what could have been.',
          )}
        >
          <Input
            value={draft.population}
            onChange={(population) => onDraft({ population })}
            placeholder={tr('مثال: 40 من 312 قيدًا', 'Ex. : 40 écritures sur 312', 'e.g. 40 of 312 entries')}
          />
        </Field>
        <Field
          label={tr('الاستثناءات', 'Exceptions', 'Exceptions')}
          required={draft.result !== 'passed'}
          hint={
            draft.result === 'passed'
              ? tr('اتركه فارغًا إن لم يُوجد شيء.', 'Laissez vide si rien n’a été relevé.', 'Leave it empty if nothing was found.')
              : tr(
                  'نتيجة ليست ناجحة يجب أن تقول ما وُجد.',
                  'Un résultat qui n’est pas une réussite doit dire ce qui a été trouvé.',
                  'A result that is not a pass has to say what was found.',
                )
          }
        >
          <TextArea
            value={draft.exceptions}
            onChange={(exceptions) => onDraft({ exceptions })}
            rows={2}
            placeholder={tr('مثال: قيدان بلا مستند.', 'Ex. : deux écritures sans pièce.', 'e.g. two entries with no document.')}
          />
        </Field>
        <Field label={tr('ملاحظة', 'Note', 'Note')}>
          <TextArea value={draft.note} onChange={(note) => onDraft({ note })} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

interface ControlRetireDialogProps {
  readonly open: boolean;
  readonly target: FinancialControl | null;
  readonly reason: string;
  readonly busy: boolean;
  onReason: (next: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Retiring a control, which is the register's only irreversible act from here.
 *
 * Like the reopen, this is not a confirmation — the kernel already raised consent for
 * `ledger.close`. It is here because `retire_financial_control_command` refuses to run
 * without a reason, and because a second control retired for the same reason as the first
 * is the sort of thing an auditor notices when the reason is written down.
 */
export function ControlRetireDialog({ open, target, reason, busy, onReason, onConfirm, onClose }: ControlRetireDialogProps) {
  const { tr } = useLocale();
  const code = target === null ? '' : target.code;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title={tr(`إيقاف ${code}`, `Retirer ${code}`, `Retire ${code}`)}
      primary={{
        label: tr('الإيقاف', 'Retirer', 'Retire'),
        onClick: onConfirm,
        disabled: target === null || reason.trim() === '',
        busy,
        danger: true,
      }}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InfoBar tone="warning" title={tr('السجل يبقى', 'L’historique reste', 'The history stays')}>
          {tr(
            'الإيقاف ليس حذفًا: تبقى الاختبارات المسجّلة كما هي، وتتوقّف الرقابة عن الاستحقاق.',
            'Retirer n’est pas supprimer : les tests enregistrés restent tels quels et le contrôle cesse d’échoir.',
            'Retiring is not deleting: the recorded tests stay as they are, and the control stops coming due.',
          )}
        </InfoBar>
        <Field
          label={tr('السبب', 'Motif', 'Reason')}
          required
          hint={tr(
            'يُخزَّن مع الرقابة وفي سجل التدقيق.',
            'Conservé avec le contrôle et dans la piste d’audit.',
            'Stored with the control and in the audit trail.',
          )}
        >
          <TextArea
            value={reason}
            onChange={onReason}
            rows={3}
            placeholder={tr(
              'مثال: حلّت محلّها مطابقة آلية في مارس.',
              'Ex. : remplacé par un rapprochement automatique en mars.',
              'e.g. superseded by the automated reconciliation in March.',
            )}
          />
        </Field>
      </div>
    </Dialog>
  );
}
