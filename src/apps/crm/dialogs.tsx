/**
 * The eight questions this app stops to ask.
 *
 * `shell.ts` keeps one `CrmDialog | null` and eight commits; `fields.tsx` draws the inputs.
 * This file is the join. Each component below takes the shell and *its own* member of the
 * union, already narrowed by `CrmDialogHost`'s switch, so not one of them has to test which
 * dialog is open. A dialog that read `shell.dialog` for itself would be a second copy of that
 * switch, and the two would eventually disagree about which record is being written.
 *
 * Four rules the whole file keeps.
 *
 * The save is gated on `blocks(problems)` and nothing else. A validator returns both kinds of
 * problem in one list, and `blocks` is the only thing that decides whether the button is live.
 * No dialog re-reads a problem to form its own opinion about it.
 *
 * Every `Notices` is told which keys its own inputs draw. What is left over is a fact about
 * the whole record rather than about one field — `validateSend`'s `lines`, `validateAccept`'s
 * `seats` — and it is drawn above the form rather than dropped for having no box to sit under.
 *
 * A commit is named, never inferred: `shell.busy === 'accept'` spins the accept button alone,
 * so a slow `crm.quote.accept` cannot make the tags dialog look like it is saving.
 *
 * And `secondaryLabel` is passed everywhere. The SDK's default is the English literal
 * `'Cancel'`, which is the right word in exactly one of this app's three languages.
 */
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, fmt, InfoBar, Input, Select, TextArea, useLocale } from '@/platform/sdk';
import type { CrmBusy } from './actions';
import { Entry, FormGrid, Lookup, Notices, RecordForm } from './fields';
import {
  blocks,
  canEdit,
  ENTITY_TITLE,
  paymentMethods,
  type Problem,
  type RecordDraft,
  validateRecord,
} from './form';
import {
  type AcceptDraft,
  asStage,
  type ConvertDraft,
  stageChoices,
  stageLabel,
  stageProbability,
  type StageDraft,
  validateAccept,
  validateConvert,
  validateDecline,
  validateSend,
  validateStage,
} from './lifecycle';
import type { CrmShell } from './shell';

/** A dialog with no validator behind it still has to hand `Entry` a list. */
const NONE: readonly Problem[] = [];

/**
 * Whether one field is the thing being refused.
 *
 * `Entry` already reddens the label and prints the text; this answers the narrower question the
 * box itself asks, and it is deliberately *not* `blocks(problems)`: a validator that refuses the
 * payment amount must not also outline the notes field. `Control` runs the same test in
 * `fields.tsx` for the record editors, over the field list they build themselves.
 */
const bad = (problems: readonly Problem[], field: string): boolean =>
  problems.some((problem) => problem.field === field && problem.blocking);

interface RecordProps {
  readonly shell: CrmShell;
  readonly draft: RecordDraft;
}

/**
 * All eight record editors, and the widest dialog in the app.
 *
 * One component, because `RecordForm` already builds every field from `ENTITY_FIELDS` and the
 * only thing left that varies is the noun in the title. 560px rather than the SDK's 460,
 * because the form is a two-column grid: a lead carries eleven fields and a customer twelve,
 * and at the default width the grid's 200px floor would collapse either into one long column.
 *
 * The locked notice is for activities alone. `canEdit('activity')` is false because the broker
 * exposes no `crm.activity.update` at all — a log whose entries can be rewritten is not a log
 * — and `shell.perform` already declines to open the editor on one. Saying so is better than
 * presenting a form whose save could never land.
 */
function RecordDialog({ shell, draft }: RecordProps) {
  const { t, tr } = useLocale();
  const problems = validateRecord(draft);
  const locked = draft.id !== null && !canEdit(draft.entity);
  const verb = draft.id === null ? tr('جديد', 'Nouveau', 'New') : tr('تعديل', 'Modifier', 'Edit');
  return (
    <Dialog
      open
      title={`${verb} · ${t(ENTITY_TITLE[draft.entity])}`}
      width={560}
      onClose={shell.closeDialog}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: shell.saveRecord,
        disabled: locked || blocks(problems),
        busy: shell.busy === 'save',
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {locked ? (
          <InfoBar
            tone="warning"
            icon={ShieldAlert}
            title={tr(
              'لا يمكن تعديل نشاط',
              'Un échange ne se modifie pas',
              'An activity cannot be edited',
            )}
          >
            {tr(
              'السجل يُضاف إليه، ولا يُعاد كتابته.',
              'Le journal s’ajoute, il ne se réécrit pas.',
              'The log is added to, never rewritten.',
            )}
          </InfoBar>
        ) : null}
        <RecordForm
          draft={draft}
          model={shell.model}
          problems={problems}
          onEdit={shell.editField}
        />
      </div>
    </Dialog>
  );
}

interface AskProps {
  readonly shell: CrmShell;
  readonly title: string;
  /** The verb on the primary button — *'Convert'*, *'Send'*, never *'OK'*. */
  readonly action: string;
  /** The one commit this dialog owns, so a slow sibling cannot make this button spin. */
  readonly commit: CrmBusy;
  readonly onCommit: () => void;
  readonly problems: readonly Problem[];
  /** Declining a quote and losing a deal are refusals, and the button says so in red. */
  readonly danger?: boolean;
  /** 560px, for the two dialogs whose grid holds more than four inputs. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/**
 * The frame the seven lifecycle dialogs share.
 *
 * Everything here is what they have in common and nothing else: one commit, one verb, one
 * validator's verdict. `blocks(problems)` is read in exactly this one place, so no dialog can
 * grow a second opinion about whether its own save is allowed, and `shell.busy === commit`
 * names the command rather than testing for *any* work in flight — `crm.quote.accept` posts a
 * journal and takes its time, and while it does the tags dialog must not look like it is saving.
 *
 * `secondaryLabel` is passed because the SDK's default is the English literal `'Cancel'`, which
 * is the right word in one of this app's three languages.
 */
function Ask({ shell, title, action, commit, onCommit, problems, danger, wide, children }: AskProps) {
  const { tr } = useLocale();
  return (
    <Dialog
      open
      title={title}
      width={wide === true ? 560 : undefined}
      onClose={shell.closeDialog}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: action,
        onClick: onCommit,
        disabled: blocks(problems),
        busy: shell.busy === commit,
        danger,
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </Dialog>
  );
}

/** Every key the convert form draws, so `Notices` knows what is left for it to say. */
const CONVERT_KEYS = ['title', 'packageId', 'travelers', 'expectedValueDzd', 'expectedCloseDate'];

/**
 * Converting a lead, and the opening position of the deal it becomes.
 *
 * `leadId` is the only thing `crm.lead.convert` requires and the only field not asked for: it
 * is the row the command was invoked on, and a picker for it would let a person convert a lead
 * they are not looking at. Everything else is optional — `convertPayload` omits each blank one
 * so the RPC's own defaults apply — which is why `validateConvert` has just the one rule.
 */
function ConvertDialog({ shell, draft }: { readonly shell: CrmShell; readonly draft: ConvertDraft }) {
  const { tr } = useLocale();
  const problems = validateConvert(draft);
  return (
    <Ask
      shell={shell}
      title={tr('تحويل إلى عميل', 'Convertir en client', 'Convert to customer')}
      action={tr('تحويل', 'Convertir', 'Convert')}
      commit="convert"
      onCommit={shell.commitConvert}
      problems={problems}
      wide
    >
      <Notices problems={problems} own={CONVERT_KEYS} />
      <FormGrid>
        <Entry
          label={tr('عنوان الفرصة', 'Intitulé de l’opportunité', 'Deal title')}
          field="title"
          problems={problems}
          wide
        >
          <Input value={draft.title} onChange={(next) => shell.setConvert({ title: next })} />
        </Entry>
        <Entry label={tr('الباقة', 'Forfait', 'Package')} field="packageId" problems={problems}>
          <Lookup
            model={shell.model}
            name="packages"
            value={draft.packageId}
            onChange={(next) => shell.setConvert({ packageId: next })}
          />
        </Entry>
        <Entry
          label={tr('المسافرون', 'Voyageurs', 'Travellers')}
          field="travelers"
          problems={problems}
          required
        >
          <Input
            type="number"
            step="1"
            value={draft.travelers}
            onChange={(next) => shell.setConvert({ travelers: next })}
            invalid={bad(problems, 'travelers')}
          />
        </Entry>
        <Entry
          label={tr('القيمة المتوقعة', 'Valeur attendue', 'Expected value')}
          field="expectedValueDzd"
          problems={problems}
        >
          <Input
            type="number"
            step="0.01"
            value={draft.expectedValueDzd}
            onChange={(next) => shell.setConvert({ expectedValueDzd: next })}
          />
        </Entry>
        <Entry
          label={tr('تاريخ الإغلاق المتوقع', 'Clôture prévue', 'Expected close')}
          field="expectedCloseDate"
          problems={problems}
        >
          <Input
            type="date"
            value={draft.expectedCloseDate}
            onChange={(next) => shell.setConvert({ expectedCloseDate: next })}
          />
        </Entry>
      </FormGrid>
    </Ask>
  );
}

/**
 * The customer's whole tag list, as one box.
 *
 * `crm.customer.tags` replaces the array rather than adding to it, so an empty box is a legal
 * instruction — *'this customer has no tags'* — and the dialog must not treat it as a mistake.
 * That is why there is no validator here and `NONE` is passed instead: nothing about this form
 * can be wrong.
 *
 * `customerId` rides on the dialog state and is read by `commitTags`, so this component never
 * receives it. One `TextArea` rather than a chip editor because `tagsPayload` already splits on
 * commas *and* newlines — a person pasting a column from a spreadsheet gets the same result as
 * a person typing a sentence.
 */
function TagsDialog({ shell, text }: { readonly shell: CrmShell; readonly text: string }) {
  const { tr } = useLocale();
  return (
    <Ask
      shell={shell}
      title={tr('وسوم العميل', 'Étiquettes du client', 'Customer tags')}
      action={tr('حفظ', 'Enregistrer', 'Save')}
      commit="tags"
      onCommit={shell.commitTags}
      problems={NONE}
    >
      <Entry
        label={tr('الوسوم', 'Étiquettes', 'Tags')}
        field="tags"
        problems={NONE}
        hint={tr(
          'تفصل الفواصل والأسطر بين الوسوم، والقائمة الفارغة تمحوها كلها.',
          'Virgules et retours à la ligne séparent ; une liste vide les efface toutes.',
          'Commas and new lines separate; an empty list clears every tag.',
        )}
      >
        <TextArea value={text} onChange={shell.setText} rows={3} />
      </Entry>
    </Ask>
  );
}

/** `from` is drawn read-only and `lostReason` only on the way to LOST, but both are shown. */
const STAGE_KEYS = ['from', 'toStage', 'lostReason', 'note'];

/**
 * Moving a deal along the pipeline.
 *
 * The destinations come from `stageChoices(draft.from)` rather than from the six stages: the
 * ladder is directed, and `crm.opportunity.stage` would refuse a jump backwards anyway. The
 * shell never opens this dialog on a stage with nowhere left to go, so there is no empty-list
 * notice to draw here.
 *
 * Each choice carries its own odds because that is what the move actually changes — the RPC
 * writes `probability` from the stage — except for the two terminal stages, where
 * `stageProbability` is null and a *'· 0%'* beside *'Lost'* would read as a forecast rather
 * than as an outcome.
 *
 * `asStage(next) ?? ''` rather than a cast: `Select` hands back a `string`, `StageDraft.toStage`
 * is `Stage | ''`, and this is the one expression that converts the first into the second
 * without asserting anything. The red primary is for LOST alone, which is a refusal and not
 * merely a step.
 */
function StageDialog({ shell, draft }: { readonly shell: CrmShell; readonly draft: StageDraft }) {
  const { t, tr, lang } = useLocale();
  const problems = validateStage(draft);
  const options = stageChoices(draft.from).map((stage) => {
    const odds = stageProbability(stage);
    const word = t(stageLabel(stage));
    return {
      value: stage,
      label: odds === null ? word : `${word} · ${fmt.percent(odds / 100, lang)}`,
    };
  });
  return (
    <Ask
      shell={shell}
      title={tr('نقل المرحلة', 'Changer d’étape', 'Move stage')}
      action={tr('نقل', 'Déplacer', 'Move')}
      commit="stage"
      onCommit={shell.commitStage}
      problems={problems}
      danger={draft.toStage === 'LOST'}
    >
      <Notices problems={problems} own={STAGE_KEYS} />
      <FormGrid>
        <Entry label={tr('من', 'De', 'From')} field="from" problems={problems}>
          <Input value={t(stageLabel(draft.from))} onChange={() => undefined} readOnly />
        </Entry>
        <Entry label={tr('إلى', 'Vers', 'To')} field="toStage" problems={problems} required>
          <Select
            value={draft.toStage}
            onChange={(next) => shell.setStage({ toStage: asStage(next) ?? '' })}
            options={options}
            placeholder={tr('اختر…', 'Choisir…', 'Select…')}
          />
        </Entry>
        {draft.toStage === 'LOST' ? (
          <Entry
            label={tr('سبب الخسارة', 'Motif de la perte', 'Lost reason')}
            field="lostReason"
            problems={problems}
            required
            wide
          >
            <Input
              value={draft.lostReason}
              onChange={(next) => shell.setStage({ lostReason: next })}
              invalid={bad(problems, 'lostReason')}
            />
          </Entry>
        ) : null}
        <Entry label={tr('ملاحظة', 'Note', 'Note')} field="note" problems={problems} wide>
          <TextArea
            value={draft.note}
            onChange={(next) => shell.setStage({ note: next })}
            rows={3}
          />
        </Entry>
      </FormGrid>
    </Ask>
  );
}

/**
 * Sending a quote, and the only dialog whose blocking problem is about another list entirely.
 *
 * `validateSend` is given `model.quoteLines.length` rather than the lines themselves, because
 * *'a quote needs at least one line'* is a fact about how many there are — and that problem is
 * keyed `lines`, which this form has no box for. `own={['validDays']}` is what routes it above
 * the input as a notice instead of losing it.
 *
 * The box counts days, not a date. `crm.quote.send` computes `valid_until` as
 * `current_date + p_valid_days` so the clock starts when the quote is actually sent, and a blank
 * box leaves the fourteen-day default to the server rather than guessing at it here.
 */
function SendDialog({ shell, validDays }: { readonly shell: CrmShell; readonly validDays: string }) {
  const { tr } = useLocale();
  const problems = validateSend(shell.model.quoteLines.length, validDays);
  return (
    <Ask
      shell={shell}
      title={tr('إرسال العرض', 'Envoyer le devis', 'Send quote')}
      action={tr('إرسال', 'Envoyer', 'Send')}
      commit="send"
      onCommit={shell.commitSend}
      problems={problems}
    >
      <Notices problems={problems} own={['validDays']} />
      <Entry
        label={tr('الصلاحية بالأيام', 'Validité en jours', 'Valid for (days)')}
        field="validDays"
        problems={problems}
        hint={tr(
          'اتركه فارغًا لأربعة عشر يومًا.',
          'Laissez vide pour quatorze jours.',
          'Leave blank for fourteen days.',
        )}
      >
        <Input
          type="number"
          step="1"
          value={validDays}
          onChange={shell.setText}
          invalid={bad(problems, 'validDays')}
        />
      </Entry>
    </Ask>
  );
}

/**
 * Declining a quote. The reason is `not null` on the column, so it is asked for and refused
 * empty — a decline nobody can read teaches the next quote nothing. Red, because this closes
 * the offer rather than amending it.
 */
function DeclineDialog({ shell, reason }: { readonly shell: CrmShell; readonly reason: string }) {
  const { tr } = useLocale();
  const problems = validateDecline(reason);
  return (
    <Ask
      shell={shell}
      title={tr('رفض العرض', 'Refuser le devis', 'Decline quote')}
      action={tr('رفض', 'Refuser', 'Decline')}
      commit="decline"
      onCommit={shell.commitDecline}
      problems={problems}
      danger
    >
      <Notices problems={problems} own={['reason']} />
      <Entry label={tr('السبب', 'Motif', 'Reason')} field="reason" problems={problems} required>
        <TextArea value={reason} onChange={shell.setText} rows={3} />
      </Entry>
    </Ask>
  );
}

/**
 * Closing a follow-up. The note is optional and there is nothing to validate: the command sets
 * `status = 'DONE'` and stamps `completed_at` together, which is exactly why DONE is not on the
 * follow-up editor's own status list.
 */
function CompleteDialog({ shell, note }: { readonly shell: CrmShell; readonly note: string }) {
  const { tr } = useLocale();
  return (
    <Ask
      shell={shell}
      title={tr('إتمام المتابعة', 'Terminer la relance', 'Complete follow-up')}
      action={tr('إتمام', 'Terminer', 'Complete')}
      commit="complete"
      onCommit={shell.commitComplete}
      problems={NONE}
    >
      <Entry
        label={tr('ملاحظة', 'Note', 'Note')}
        field="note"
        problems={NONE}
        hint={tr('اختيارية.', 'Facultative.', 'Optional.')}
      >
        <TextArea value={note} onChange={shell.setText} rows={3} />
      </Entry>
    </Ask>
  );
}

/** The five keys the accept form draws. `seats` is not among them, and that is the point. */
const ACCEPT_KEYS = ['paymentAmount', 'paymentMethod', 'groupId', 'passportNumber', 'notes'];

interface AcceptProps {
  readonly shell: CrmShell;
  readonly draft: AcceptDraft;
  /** The quote's number and customer, as the confirmed-booking notice announces it. */
  readonly label: string;
  readonly travelers: number;
  readonly seatsLeft: number | null;
}

/**
 * Accepting a quote — the seam between this desk and the ledger, and the only dialog here whose
 * command needs `ledger.post`.
 *
 * One amount, not two. The RPC takes `p_payment_amount_dzd` and `p_payment_amount_sar` and
 * refuses both at once, and also refuses the wrong one for the quote; `acceptPayload` reads the
 * quote's own currency and fills the legal slot, so this form asks for a number and there is no
 * way to get that wrong from here. The method list narrows with it — `paymentMethods` drops
 * CHECK, CCP and BARIDIMOB on a quote priced in riyals.
 *
 * A blank amount is an answer. Both parameters default to 0 and the journal is only posted when
 * one is positive, so an empty box books the trip and posts nothing — which is why the validator
 * raises that as an advisory and the primary button stays live.
 *
 * `seats` is the reason `own` lists five keys and not six. The capacity advisory is about a
 * package's remaining places rather than about any box on screen, so `Notices` draws it above
 * the grid; and it is advisory because both numbers came off a cached page — the RPC counts for
 * real and its refusal is the authoritative one.
 */
function AcceptDialog({ shell, draft, label, travelers, seatsLeft }: AcceptProps) {
  const { t, tr, lang } = useLocale();
  const problems = validateAccept(draft, travelers, seatsLeft);
  const money = fmt.money(draft.total, draft.currency === 'SAR' ? 'SAR' : 'DZD', lang);
  const who = `${fmt.integer(travelers, lang)} ${tr('مسافر', 'voyageur(s)', 'traveller(s)')}`;
  return (
    <Ask
      shell={shell}
      title={tr('قبول العرض', 'Accepter le devis', 'Accept quote')}
      action={tr('قبول', 'Accepter', 'Accept')}
      commit="accept"
      onCommit={shell.commitAccept}
      problems={problems}
      wide
    >
      <InfoBar tone="success" icon={CheckCircle2} title={label}>
        {`${money} · ${who}`}
      </InfoBar>
      <Notices problems={problems} own={ACCEPT_KEYS} />
      <FormGrid>
        <Entry
          label={tr('الدفعة', 'Acompte', 'Payment')}
          field="paymentAmount"
          problems={problems}
          hint={tr(
            'اتركه فارغًا للتأكيد دون دفع',
            'Laisser vide pour confirmer sans paiement',
            'Leave blank to confirm without a payment',
          )}
        >
          <Input
            type="number"
            step="0.01"
            value={draft.paymentAmount}
            onChange={(next) => shell.setAccept({ paymentAmount: next })}
            invalid={bad(problems, 'paymentAmount')}
          />
        </Entry>
        <Entry
          label={tr('طريقة الدفع', 'Mode de paiement', 'Method')}
          field="paymentMethod"
          problems={problems}
        >
          <Select
            value={draft.paymentMethod}
            onChange={(next) => shell.setAccept({ paymentMethod: next })}
            options={paymentMethods(draft.currency).map((method) => ({
              value: method.value,
              label: t(method.label),
            }))}
          />
        </Entry>
        <Entry
          label={tr('المجموعة', 'Groupe', 'Group')}
          field="groupId"
          problems={problems}
          hint={tr(
            'معرّف مجموعة السفر، إن وُجدت',
            'Identifiant du groupe de voyage, s’il existe',
            'The travel group’s id, when there is one',
          )}
        >
          <Input
            value={draft.groupId}
            onChange={(next) => shell.setAccept({ groupId: next })}
            mono
          />
        </Entry>
        <Entry
          label={tr('رقم جواز السفر', 'Numéro de passeport', 'Passport number')}
          field="passportNumber"
          problems={problems}
        >
          <Input
            value={draft.passportNumber}
            onChange={(next) => shell.setAccept({ passportNumber: next })}
            mono
          />
        </Entry>
        <Entry label={tr('ملاحظات', 'Notes', 'Notes')} field="notes" problems={problems} wide>
          <TextArea
            value={draft.notes}
            onChange={(next) => shell.setAccept({ notes: next })}
            rows={3}
          />
        </Entry>
      </FormGrid>
    </Ask>
  );
}

/**
 * The one export: whichever dialog the shell says is open, or nothing.
 *
 * An exhaustive `switch` with no `default`, over the same union `shell.ts` declares. That is
 * what makes a ninth dialog a compile error here rather than a window that silently refuses to
 * open — and it is also what lets each branch hand its component the fields that member alone
 * carries, narrowed by the discriminant rather than by an optional prop or a cast.
 *
 * `record` is one branch for eight editors, because `RecordDraft` already names its noun and
 * already knows whether it is a create or an update. Nothing else here needs to.
 *
 * The three draft dialogs get their draft; the four one-box dialogs get their string. Neither
 * `customerId`, `quoteId` nor `followupId` is passed to anything: each commit reads its own key
 * off `shell.dialog`, so a form that never sees a key can never send the wrong one.
 */
export function CrmDialogHost({ shell }: { readonly shell: CrmShell }) {
  const dialog = shell.dialog;
  if (dialog === null) return null;
  switch (dialog.kind) {
    case 'record':
      return <RecordDialog shell={shell} draft={dialog.draft} />;
    case 'convert':
      return <ConvertDialog shell={shell} draft={dialog.draft} />;
    case 'tags':
      return <TagsDialog shell={shell} text={dialog.text} />;
    case 'stage':
      return <StageDialog shell={shell} draft={dialog.draft} />;
    case 'send':
      return <SendDialog shell={shell} validDays={dialog.validDays} />;
    case 'accept':
      return (
        <AcceptDialog
          shell={shell}
          draft={dialog.draft}
          label={dialog.label}
          travelers={dialog.travelers}
          seatsLeft={dialog.seatsLeft}
        />
      );
    case 'decline':
      return <DeclineDialog shell={shell} reason={dialog.reason} />;
    case 'complete':
      return <CompleteDialog shell={shell} note={dialog.note} />;
  }
}
