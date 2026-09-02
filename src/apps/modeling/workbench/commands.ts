/**
 * Modeling workbench — the fourteen verbs.
 *
 * `useLedgerCommand().run` takes `{ command, payload }` where `payload` is
 * `Readonly<Record<string, unknown>>` — an untyped bag, and necessarily so: one syscall carries
 * every command in the system and no single interface could describe all of them. The cost is
 * that `scenarioKey` misspelt `scenarioId` compiles perfectly and fails at the broker with
 * `INVALID_ARGUMENT`, in the browser, after the click.
 *
 * This file is where that cost is paid back. Every wrapper below takes named arguments and
 * builds the bag itself, so the fourteen payload contracts the broker enforces at run time are
 * enforced here at compile time instead. Nothing else in the workbench spells a payload key.
 *
 * Two details are load-bearing rather than decorative:
 *
 * `low` and `high` are `number | null` and the null is *sent*, not omitted. The broker reads a
 * present null as "clear this bound" and an absent key as "leave it alone", which are different
 * acts; an optional field would have made the second one unreachable.
 *
 * `recordCertificate` takes the engine's own `Certificate` and takes nothing else. Every field
 * the command stores — the grade, the hashes, the target, the counts — is read off the object
 * the engine produced, so no call site can pair a grade with a target it was not measured
 * against. That is the browser half of the guarantee the ABI states: neither side can quietly
 * award a better grade than was measured.
 */
import { useCallback, useMemo } from 'react';
import { type Localized, type ModelCommandName, useLedgerCommand, useLocale } from '@/platform/sdk';
import type { AssumptionUnit, Certificate } from '../engine';

/* ------------------------------------------------------------------ *
 * What each verb says when it lands
 * ------------------------------------------------------------------ */

/** One sentence for the toast on success, one for the toast on refusal. */
interface Said {
  readonly ok: Localized;
  readonly no: Localized;
}

/**
 * The fourteen, total over the ABI's own union.
 *
 * `ModelCommandName` comes from `@/platform/sdk` rather than being spelled out here, which is
 * the entire point: a fifteenth model command added to the ABI breaks this record, and whoever
 * added it is told that two sentences in three languages are owed before the verb can ship.
 */
const SAID: Readonly<Record<ModelCommandName, Said>> = {
  'model.create': {
    ok: { ar: 'تم إنشاء النموذج.', fr: 'Modèle créé.', en: 'Model created.' },
    no: { ar: 'تعذّر إنشاء النموذج.', fr: 'Création impossible.', en: 'Could not create the model.' },
  },
  'model.update': {
    ok: { ar: 'تم حفظ النموذج.', fr: 'Modèle enregistré.', en: 'Model saved.' },
    no: { ar: 'تعذّر الحفظ.', fr: 'Enregistrement impossible.', en: 'Could not save.' },
  },
  'model.publish': {
    ok: { ar: 'تم نشر النموذج.', fr: 'Modèle publié.', en: 'Model published.' },
    no: { ar: 'تعذّر النشر.', fr: 'Publication impossible.', en: 'Could not publish.' },
  },
  'model.revise': {
    ok: { ar: 'عاد النموذج إلى مسوّدة.', fr: 'Modèle repassé en brouillon.', en: 'Model back to draft.' },
    no: { ar: 'تعذّرت العودة إلى مسوّدة.', fr: 'Retour au brouillon impossible.', en: 'Could not reopen as draft.' },
  },
  'model.archive': {
    ok: { ar: 'تم أرشفة النموذج.', fr: 'Modèle archivé.', en: 'Model archived.' },
    no: { ar: 'تعذّرت الأرشفة.', fr: 'Archivage impossible.', en: 'Could not archive.' },
  },
  'model.assumption.upsert': {
    ok: { ar: 'تم حفظ الافتراض.', fr: 'Hypothèse enregistrée.', en: 'Assumption saved.' },
    no: { ar: 'تعذّر حفظ الافتراض.', fr: 'Enregistrement impossible.', en: 'Could not save the assumption.' },
  },
  'model.assumption.delete': {
    ok: { ar: 'تم حذف الافتراض.', fr: 'Hypothèse supprimée.', en: 'Assumption deleted.' },
    no: { ar: 'تعذّر الحذف.', fr: 'Suppression impossible.', en: 'Could not delete.' },
  },
  'model.row.upsert': {
    ok: { ar: 'تم حفظ السطر.', fr: 'Ligne enregistrée.', en: 'Row saved.' },
    no: { ar: 'تعذّر حفظ السطر.', fr: 'Enregistrement impossible.', en: 'Could not save the row.' },
  },
  'model.row.delete': {
    ok: { ar: 'تم حذف السطر.', fr: 'Ligne supprimée.', en: 'Row deleted.' },
    no: { ar: 'تعذّر الحذف.', fr: 'Suppression impossible.', en: 'Could not delete.' },
  },
  'model.scenario.upsert': {
    ok: { ar: 'تم حفظ السيناريو.', fr: 'Scénario enregistré.', en: 'Scenario saved.' },
    no: { ar: 'تعذّر حفظ السيناريو.', fr: 'Enregistrement impossible.', en: 'Could not save the scenario.' },
  },
  'model.scenario.delete': {
    ok: { ar: 'تم حذف السيناريو.', fr: 'Scénario supprimé.', en: 'Scenario deleted.' },
    no: { ar: 'تعذّر الحذف.', fr: 'Suppression impossible.', en: 'Could not delete.' },
  },
  'model.override.set': {
    ok: { ar: 'تم تثبيت التعديل.', fr: 'Ajustement appliqué.', en: 'Override set.' },
    no: { ar: 'تعذّر التعديل.', fr: 'Ajustement impossible.', en: 'Could not set the override.' },
  },
  'model.override.clear': {
    ok: { ar: 'عاد الافتراض إلى قيمته الأصلية.', fr: 'Hypothèse revenue à sa valeur de base.', en: 'Assumption back to its base value.' },
    no: { ar: 'تعذّر الإلغاء.', fr: 'Annulation impossible.', en: 'Could not clear the override.' },
  },
  'model.certificate.record': {
    ok: { ar: 'تم تسجيل الشهادة.', fr: 'Certificat enregistré.', en: 'Certificate recorded.' },
    no: { ar: 'تعذّر تسجيل الشهادة.', fr: 'Enregistrement impossible.', en: 'Could not record the certificate.' },
  },
};

/**
 * The one act the ABI does not have a name for.
 *
 * `model.archive` carries two directions — `archived: true` files a model away, `archived: false`
 * brings it back — so the record above, which is keyed on command names, cannot hold words for
 * both. Rather than loosen it to something that is no longer total over the union, the second
 * direction gets its own pair, sitting here where a reader can see why it is not in the table.
 */
const RESTORED: Said = {
  ok: { ar: 'أُعيد النموذج من الأرشيف.', fr: 'Modèle sorti de l’archive.', en: 'Model restored.' },
  no: { ar: 'تعذّرت الإعادة.', fr: 'Restauration impossible.', en: 'Could not restore.' },
};
/* ------------------------------------------------------------------ *
 * What each verb takes
 * ------------------------------------------------------------------ */

/** A new model: a unique key somebody typed, a name, and an axis. */
export interface NewModel {
  readonly key: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly description?: string;
  /** At least one period, at most six hundred — the table's own bounds. */
  readonly periods: readonly string[];
}

/** The header, edited. Everything the create form asks for except the key, which is fixed. */
export interface ModelEdit {
  readonly name: string;
  readonly nameAr?: string;
  readonly description?: string;
  readonly periods: readonly string[];
}

/**
 * An assumption, edited.
 *
 * `low` and `high` are required and nullable rather than optional. The broker distinguishes a
 * present null (clear this bound) from an absent key (leave it as it was), and an editor that
 * cannot express the first cannot let anybody undo a range they typed by mistake.
 */
export interface AssumptionEdit {
  readonly key: string;
  readonly label: string;
  readonly labelAr?: string;
  readonly unit: AssumptionUnit;
  readonly value: number;
  readonly low: number | null;
  readonly high: number | null;
  readonly note?: string;
  readonly sortOrder?: number;
}

/**
 * A row is computed or it is typed in, never both and never neither.
 *
 * The broker refuses both-or-neither with `INVALID_ARGUMENT`, which is the right answer to a
 * malformed request but a poor way to find out. A tagged union makes the malformed request
 * unspellable: there is no value of this type that carries a formula and a series at once.
 */
export type RowBody =
  | { readonly kind: 'COMPUTED'; readonly formula: string }
  | { readonly kind: 'GIVEN'; readonly given: readonly number[] };

export interface RowEdit {
  readonly key: string;
  readonly label: string;
  readonly labelAr?: string;
  readonly unit: AssumptionUnit;
  readonly body: RowBody;
  readonly note?: string;
  readonly sortOrder?: number;
}

/**
 * A scenario, edited.
 *
 * `baseKey` is nullable for the same reason `low` is: a scenario that inherited from another and
 * now inherits from nothing has to be able to say so, and an optional field would only have been
 * able to say "unchanged".
 */
export interface ScenarioEdit {
  readonly key: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly baseKey: string | null;
  readonly note?: string;
  readonly sortOrder?: number;
}
/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

/**
 * Every verb the workbench has, and the two facts the toolbar needs about them.
 *
 * Each returns `Promise<boolean>` rather than firing and forgetting, which is where this departs
 * from `journal/actions.ts`'s `void run()`. A journal posting has nowhere to go afterwards; a
 * row editor has a dialog open, and a dialog that closes on a refusal has just thrown away
 * whatever the person typed. So the answer comes back and the caller decides.
 */
export interface ModelCommands {
  readonly create: (input: NewModel) => Promise<boolean>;
  readonly update: (input: ModelEdit) => Promise<boolean>;
  /** The `fullHash` of the compiled model, which is what the reader will be quoting. */
  readonly publish: (fullHash: string) => Promise<boolean>;
  readonly revise: () => Promise<boolean>;
  readonly archive: () => Promise<boolean>;
  readonly restore: () => Promise<boolean>;
  readonly saveAssumption: (input: AssumptionEdit) => Promise<boolean>;
  readonly deleteAssumption: (key: string) => Promise<boolean>;
  readonly saveRow: (input: RowEdit) => Promise<boolean>;
  readonly deleteRow: (key: string) => Promise<boolean>;
  readonly saveScenario: (input: ScenarioEdit) => Promise<boolean>;
  readonly deleteScenario: (key: string) => Promise<boolean>;
  readonly setOverride: (scenarioKey: string, assumptionKey: string, value: number, note?: string) => Promise<boolean>;
  readonly clearOverride: (scenarioKey: string, assumptionKey: string) => Promise<boolean>;
  /** Stores what the engine measured. Takes the certificate and nothing else, on purpose. */
  readonly certify: (certificate: Certificate) => Promise<boolean>;
  readonly running: boolean;
  readonly error: string | null;
}

/**
 * Drops keys whose value is `undefined`, and keeps every `null`.
 *
 * The distinction is the whole reason this exists. `note: undefined` means the caller had nothing
 * to say about the note and the stored one should stand; `low: null` means clear the bound. Both
 * are falsy, both would vanish under a `?? omit` or a truthiness test, and they ask the broker
 * for opposite things.
 */
function defined(bag: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
/**
 * The verbs, bound to one model.
 *
 * `modelId` is taken once here rather than at thirteen call sites, and it is nullable because the
 * workbench renders before anything is open. The twelve commands that need it answer `false`
 * without a round trip when it is null — a single refusal, stated once, instead of a guard the
 * next editor added to the workbench might forget.
 */
export function useModelCommands(modelId: string | null): ModelCommands {
  const { t } = useLocale();
  const ledger = useLedgerCommand();

  /**
   * One place where a command name, a payload and a pair of sentences meet.
   *
   * `ledger.run` raises the toast itself — success only when `success` is given, and a `warning`
   * rather than an `error` when the broker refused for want of a capability. So there is nothing
   * to do here but hand it the words, which is why every verb below is one expression.
   */
  const send = useCallback(
    (command: ModelCommandName, payload: Readonly<Record<string, unknown>>, said?: Said): Promise<boolean> => {
      const words = said ?? SAID[command];
      return ledger.run({ command, payload: defined(payload) }, { success: t(words.ok), failure: t(words.no) });
    },
    [ledger, t],
  );

  /** The same, with `modelId` prepended, and refused outright when there is no model open. */
  const scoped = useCallback(
    (command: ModelCommandName, payload: Readonly<Record<string, unknown>>, said?: Said): Promise<boolean> =>
      modelId === null ? Promise.resolve(false) : send(command, { modelId, ...payload }, said),
    [modelId, send],
  );

  /**
   * One `useMemo` rather than fifteen `useCallback`s.
   *
   * Every verb closes over `send` or `scoped` and nothing else, so memoising the object once is
   * exactly as stable as memoising each function separately — and fifteen hooks would have made
   * the file longer without making any consumer's dependency array shorter.
   */
  return useMemo<ModelCommands>(
    () => ({
      create: (input) =>
        send('model.create', {
          key: input.key,
          name: input.name,
          nameAr: input.nameAr,
          description: input.description,
          periods: input.periods,
        }),
      update: (input) =>
        scoped('model.update', {
          name: input.name,
          nameAr: input.nameAr,
          description: input.description,
          periods: input.periods,
        }),
      publish: (fullHash) => scoped('model.publish', { fullHash }),
      revise: () => scoped('model.revise', {}),
      archive: () => scoped('model.archive', { archived: true }),
      // The one command that carries two acts, and the one call that has to say which words.
      restore: () => scoped('model.archive', { archived: false }, RESTORED),

      saveAssumption: (input) =>
        scoped('model.assumption.upsert', {
          key: input.key,
          label: input.label,
          labelAr: input.labelAr,
          unit: input.unit,
          value: input.value,
          // Sent even when null, which is the point: null clears the bound.
          low: input.low,
          high: input.high,
          note: input.note,
          sortOrder: input.sortOrder,
        }),
      deleteAssumption: (key) => scoped('model.assumption.delete', { key }),

      saveRow: (input) =>
        scoped('model.row.upsert', {
          key: input.key,
          label: input.label,
          labelAr: input.labelAr,
          unit: input.unit,
          note: input.note,
          sortOrder: input.sortOrder,
          // The tagged union collapses here, and only here, into the one key the broker wants.
          ...(input.body.kind === 'COMPUTED' ? { formula: input.body.formula } : { given: input.body.given }),
        }),
      deleteRow: (key) => scoped('model.row.delete', { key }),

      saveScenario: (input) =>
        scoped('model.scenario.upsert', {
          key: input.key,
          name: input.name,
          nameAr: input.nameAr,
          baseKey: input.baseKey,
          note: input.note,
          sortOrder: input.sortOrder,
        }),
      deleteScenario: (key) => scoped('model.scenario.delete', { key }),
      setOverride: (scenarioKey, assumptionKey, value, note) =>
        scoped('model.override.set', { scenarioKey, assumptionKey, value, note }),
      clearOverride: (scenarioKey, assumptionKey) =>
        scoped('model.override.clear', { scenarioKey, assumptionKey }),

      /**
       * The certificate, taken apart into the thirteen columns the table keeps.
       *
       * Every value below is read off the object the engine returned. There is no argument for a
       * grade, no argument for a hash and no argument for a target, so no call site can store a
       * CERTIFIED against a target the run never measured — the failure the whole mechanism
       * exists to prevent, and the only one a typed wrapper could not have caught by itself.
       *
       * An empty `checks` array is refused here rather than at the broker. A certificate that
       * measured nothing is not a lenient certificate, it is a bug upstream, and the toast for
       * `INVALID_ARGUMENT` would have sent whoever saw it looking in the wrong place.
       */
      certify: (certificate) =>
        certificate.checks.length === 0
          ? Promise.resolve(false)
          : scoped('model.certificate.record', {
              scenarioKey: certificate.scenario,
              targetKey: certificate.target.key,
              targetKind: certificate.target.kind,
              targetPeriod: certificate.target.period,
              grade: certificate.grade,
              resultsHash: certificate.resultsHash,
              fullHash: certificate.fullHash,
              checks: certificate.checks,
              limitations: certificate.limitations,
              passed: certificate.passed,
              warned: certificate.warned,
              failed: certificate.failed,
              unmeasured: certificate.unmeasured,
            }),

      running: ledger.running,
      error: ledger.error,
    }),
    [ledger.error, ledger.running, scoped, send],
  );
}
