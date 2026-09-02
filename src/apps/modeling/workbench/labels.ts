/**
 * Modeling workbench — the vocabulary.
 *
 * Sixty names, in three languages. They live in one file rather than beside the components
 * that render them for a reason worth stating: every record below is *total* over an engine
 * union, so adding a member to `CheckKind` or `ParseErrorCode` in `../engine` breaks this file
 * and nothing else. The compiler then tells whoever added it that three languages' worth of
 * label is owed — which is the only mechanism that stops a new check from reaching a screen
 * spelled `HELD_ROWS_DISCLOSED`.
 *
 * The engine names its findings with codes rather than sentences, so one run can be read in
 * Arabic and quoted in French without being recomputed. It is not silent, though: a `Check`
 * also carries a `detail` and a `Certificate` its `limitations`, and both are English prose
 * generated from the numbers the run actually found. Those cannot be translated here without
 * re-deriving them, so they are rendered as they arrive, beside a name in the reader's own
 * language and the digits that earned it. This file is where the codes get paid for, once.
 *
 * Tones sit next to the words because a grade's colour is part of its meaning — a PROVISIONAL
 * badge rendered in the same green as CERTIFIED is a lie told in CSS.
 */
import type { Localized, Tone } from '@/platform/sdk';
import type {
  AssumptionUnit,
  CheckKind,
  EvalNoteCode,
  Grade,
  GraphIssue,
  Outcome,
  ParseErrorCode,
  ScenarioIssueKind,
  SpecIssueKind,
  TargetKind,
} from '../engine';
import type { ModelStatus } from './document';

/* ------------------------------------------------------------------ *
 * The document's own words
 * ------------------------------------------------------------------ */

export const MODEL_STATUS_LABEL: Readonly<Record<ModelStatus, Localized>> = {
  DRAFT: { ar: 'مسوّدة', fr: 'Brouillon', en: 'Draft' },
  PUBLISHED: { ar: 'منشور', fr: 'Publié', en: 'Published' },
  ARCHIVED: { ar: 'مؤرشف', fr: 'Archivé', en: 'Archived' },
};

/**
 * A draft is `neutral`, not a warning.
 *
 * It is the state a model is *supposed* to be in while somebody edits it, and colouring the
 * ordinary case amber trains people to ignore amber.
 */
export const MODEL_STATUS_TONE: Readonly<Record<ModelStatus, Tone>> = {
  DRAFT: 'neutral',
  PUBLISHED: 'info',
  ARCHIVED: 'warning',
};

export const UNIT_LABEL: Readonly<Record<AssumptionUnit, Localized>> = {
  CURRENCY: { ar: 'مبلغ', fr: 'Montant', en: 'Amount' },
  RATE: { ar: 'نسبة', fr: 'Taux', en: 'Rate' },
  COUNT: { ar: 'عدد', fr: 'Nombre', en: 'Count' },
  DAYS: { ar: 'أيام', fr: 'Jours', en: 'Days' },
  FACTOR: { ar: 'معامل', fr: 'Facteur', en: 'Factor' },
};

/**
 * The mark a cell wears when the column header cannot carry the unit.
 *
 * A grid of eighteen periods has no room for `fmt.money` in every cell, so the number is
 * formatted plainly and the unit rides beside it. `COUNT` is deliberately blank: a headcount
 * of forty is not "40 count".
 */
export const UNIT_SUFFIX: Readonly<Record<AssumptionUnit, Localized>> = {
  CURRENCY: { ar: 'دج', fr: 'DZD', en: 'DZD' },
  RATE: { ar: '٪', fr: '%', en: '%' },
  COUNT: { ar: '', fr: '', en: '' },
  DAYS: { ar: 'ي', fr: 'j', en: 'd' },
  FACTOR: { ar: '×', fr: '×', en: '×' },
};

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

export const GRADE_LABEL: Readonly<Record<Grade, Localized>> = {
  CERTIFIED: { ar: 'مُصدَّق', fr: 'Certifié', en: 'Certified' },
  PROVISIONAL: { ar: 'مبدئي', fr: 'Provisoire', en: 'Provisional' },
  UNCERTIFIED: { ar: 'غير مُصدَّق', fr: 'Non certifié', en: 'Uncertified' },
};

/**
 * Three tones for three grades, and `warning` for the middle one on purpose.
 *
 * PROVISIONAL means every check that ran passed and some could not run. That is not a failure
 * and it is not a pass — it is a model somebody may quote as long as they say which parts were
 * unmeasured, and amber is the colour of exactly that sentence.
 */
export const GRADE_TONE: Readonly<Record<Grade, Tone>> = {
  CERTIFIED: 'success',
  PROVISIONAL: 'warning',
  UNCERTIFIED: 'danger',
};

/** One line explaining what the grade licenses. Read once, by whoever is about to quote it. */
export const GRADE_MEANING: Readonly<Record<Grade, Localized>> = {
  CERTIFIED: {
    ar: 'كل الفحوص أُجريت ونجحت. يمكن الاقتباس من هذا النموذج كما هو.',
    fr: 'Tous les contrôles ont été exécutés et réussis. Ce modèle peut être cité tel quel.',
    en: 'Every check ran and passed. This model can be quoted as it stands.',
  },
  PROVISIONAL: {
    ar: 'ما أُجري نجح، وبعض الفحوص لم يُجرَ. اذكر القيود عند الاقتباس.',
    fr: 'Ce qui a été mesuré passe, certains contrôles n’ont pas pu l’être. Citez les limites.',
    en: 'What was measured passes; some checks could not run. Quote the limitations with it.',
  },
  UNCERTIFIED: {
    ar: 'فحص واحد على الأقل فشل. هذا النموذج مسوّدة عمل، لا خطة.',
    fr: 'Au moins un contrôle a échoué. Ce modèle est un brouillon de travail, pas un plan.',
    en: 'At least one check failed. This model is working scratch, not a plan.',
  },
};

export const OUTCOME_LABEL: Readonly<Record<Outcome, Localized>> = {
  PASS: { ar: 'نجح', fr: 'Réussi', en: 'Pass' },
  WARN: { ar: 'تحذير', fr: 'Avertissement', en: 'Warning' },
  FAIL: { ar: 'فشل', fr: 'Échec', en: 'Fail' },
  UNMEASURED: { ar: 'لم يُقَس', fr: 'Non mesuré', en: 'Unmeasured' },
};

/** `UNMEASURED` is `neutral`, not `warning`: nothing is wrong, something is simply unknown. */
export const OUTCOME_TONE: Readonly<Record<Outcome, Tone>> = {
  PASS: 'success',
  WARN: 'warning',
  FAIL: 'danger',
  UNMEASURED: 'neutral',
};

/* ------------------------------------------------------------------ *
 * What was certified, and against what
 * ------------------------------------------------------------------ */

/** How the target reads a row: one period, the sum of all of them, or the last. */
export const TARGET_KIND_LABEL: Readonly<Record<TargetKind, Localized>> = {
  AT: { ar: 'في فترة', fr: 'À la période', en: 'At period' },
  TOTAL: { ar: 'المجموع', fr: 'Total', en: 'Total' },
  FINAL: { ar: 'الفترة الأخيرة', fr: 'Dernière période', en: 'Final period' },
};

/**
 * The nine checks, named as claims rather than as slugs.
 *
 * Phrased as what the check asserts — "every scenario runs", not "scenarios run" — because the
 * engine's own `detail` is English prose generated at run time from the numbers it found, and
 * that string cannot be translated here without re-deriving it. So the panel shows this name in
 * the reader's language, the `measured`/`threshold` pair beside it (digits are language-neutral),
 * and `detail` as the English specifics. A reader who cannot read the detail still learns from
 * the name what was tested and from the numbers how it came out.
 */
export const CHECK_LABEL: Readonly<Record<CheckKind, Localized>> = {
  SCENARIOS_RUN: {
    ar: 'كل سيناريو يعمل',
    fr: 'Chaque scénario s’exécute',
    en: 'Every scenario runs',
  },
  SCENARIO_COUNT: {
    ar: 'يوجد ما يُقارَن به',
    fr: 'Il existe un point de comparaison',
    en: 'There is something to compare against',
  },
  CLEAN_ARITHMETIC: {
    ar: 'لا خانة أبلغت عن مشكلة',
    fr: 'Aucune cellule n’a signalé de problème',
    en: 'No cell reported a problem',
  },
  WITHIN_RANGE: {
    ar: 'كل قيمة داخل مجالها المعلن',
    fr: 'Chaque valeur reste dans sa plage déclarée',
    en: 'Every value sits inside its declared range',
  },
  RANGES_DECLARED: {
    ar: 'مجالات كافية لقياس الحساسية',
    fr: 'Assez de plages pour mesurer la sensibilité',
    en: 'Enough ranges to measure sensitivity',
  },
  NO_DEAD_ASSUMPTIONS: {
    ar: 'كل افتراض يصل إلى سطر',
    fr: 'Chaque hypothèse atteint une ligne',
    en: 'Every assumption reaches a row',
  },
  TARGET_RESPONDS: {
    ar: 'الهدف يتحرّك بتحرّك الافتراضات',
    fr: 'La cible réagit aux hypothèses',
    en: 'The target responds to its assumptions',
  },
  AUDITABLE_DEPTH: {
    ar: 'سلسلة الاعتماد قصيرة بما يكفي للتتبّع',
    fr: 'La chaîne de dépendances reste traçable',
    en: 'The dependency chain is short enough to trace',
  },
  HELD_ROWS_DISCLOSED: {
    ar: 'الأسطر التي نفدت قيمها مُعلَنة',
    fr: 'Les lignes à court de valeurs sont déclarées',
    en: 'Rows that ran out of values are disclosed',
  },
};

/* ------------------------------------------------------------------ *
 * When a formula will not compile
 * ------------------------------------------------------------------ */

/**
 * The ten ways a formula can fail to parse, written as instructions rather than as diagnoses.
 *
 * These are the only labels in this file a person reads while *typing*, which changes what they
 * have to do. `BAD_ARITY` is not "arity mismatch" but "this function wants a different number of
 * arguments" — the reader is mid-edit, holding a cursor, and needs the next keystroke rather
 * than the name of their mistake. The parser reports a character offset alongside the code, so
 * none of these have to say *where*.
 */
export const PARSE_ERROR_LABEL: Readonly<Record<ParseErrorCode, Localized>> = {
  EMPTY: {
    ar: 'الصيغة فارغة',
    fr: 'La formule est vide',
    en: 'The formula is empty',
  },
  BAD_CHAR: {
    ar: 'حرف لا يُقرأ في الصيغة',
    fr: 'Un caractère illisible dans la formule',
    en: 'A character here is not readable in a formula',
  },
  BAD_NUMBER: {
    ar: 'رقم غير مكتمل',
    fr: 'Un nombre incomplet',
    en: 'This number is unfinished',
  },
  UNKNOWN_FUNCTION: {
    ar: 'دالة غير معروفة',
    fr: 'Fonction inconnue',
    en: 'No function by that name',
  },
  BAD_ARITY: {
    ar: 'عدد الوسائط لا يوافق الدالة',
    fr: 'Cette fonction attend un autre nombre d’arguments',
    en: 'This function wants a different number of arguments',
  },
  NEEDS_KEY: {
    ar: 'هذه الدالة تحتاج مفتاح سطر أو افتراض',
    fr: 'Cette fonction attend une clé de ligne ou d’hypothèse',
    en: 'This function needs the key of a row or an assumption',
  },
  BAD_LAG: {
    ar: 'الإزاحة الزمنية يجب أن تكون عددًا صحيحًا',
    fr: 'Le décalage doit être un nombre entier de périodes',
    en: 'The lag has to be a whole number of periods',
  },
  UNCLOSED: {
    ar: 'قوس لم يُغلق',
    fr: 'Une parenthèse reste ouverte',
    en: 'A bracket is still open',
  },
  UNEXPECTED: {
    ar: 'رمز في غير موضعه',
    fr: 'Un symbole hors de sa place',
    en: 'Something is out of place here',
  },
  TRAILING: {
    ar: 'نص زائد بعد نهاية الصيغة',
    fr: 'Du texte après la fin de la formule',
    en: 'There is text after the formula ends',
  },
};

/* ------------------------------------------------------------------ *
 * When a formula compiles and the arithmetic still says something
 * ------------------------------------------------------------------ */

/**
 * The five notes a cell can carry.
 *
 * A note is not an error: the run finished and produced a number. `BEFORE_START` is the ordinary
 * one — `prev(revenue)` in the first period has nothing behind it, which is a fact about the
 * axis rather than a mistake in the formula — and `CLEAN_ARITHMETIC` counts them anyway, because
 * a model quoting a total that silently began at zero is quoting an assumption nobody declared.
 */
export const EVAL_NOTE_LABEL: Readonly<Record<EvalNoteCode, Localized>> = {
  UNKNOWN_KEY: {
    ar: 'مفتاح لا يوجد في النموذج',
    fr: 'Une clé absente du modèle',
    en: 'A key that is not in this model',
  },
  BEFORE_START: {
    ar: 'قراءة قبل أول فترة',
    fr: 'Lecture avant la première période',
    en: 'Read from before the first period',
  },
  DIV_ZERO: {
    ar: 'قسمة على صفر',
    fr: 'Division par zéro',
    en: 'Divided by zero',
  },
  DOMAIN: {
    ar: 'قيمة خارج نطاق الدالة',
    fr: 'Valeur hors du domaine de la fonction',
    en: 'A value outside what the function accepts',
  },
  NOT_FINITE: {
    ar: 'النتيجة ليست عددًا منتهيًا',
    fr: 'Le résultat n’est pas un nombre fini',
    en: 'The result is not a finite number',
  },
};

/* ------------------------------------------------------------------ *
 * When the document itself is wrong
 * ------------------------------------------------------------------ */

/**
 * Three faults in the spec, which are the only ones that stop a compile before arithmetic.
 *
 * A row with no key cannot be referred to, two rows with one key cannot be told apart, and a
 * model with no periods has nowhere to put a number. Everything else the engine reports is a
 * result rather than a refusal.
 */
export const SPEC_ISSUE_LABEL: Readonly<Record<SpecIssueKind, Localized>> = {
  BAD_KEY: {
    ar: 'مفتاح غير صالح',
    fr: 'Clé invalide',
    en: 'Invalid key',
  },
  DUPLICATE_KEY: {
    ar: 'مفتاح مستعمل مرتين',
    fr: 'Clé utilisée deux fois',
    en: 'Key used twice',
  },
  NO_PERIODS: {
    ar: 'النموذج بلا فترات',
    fr: 'Le modèle n’a aucune période',
    en: 'The model has no periods',
  },
};
/**
 * Four faults in the scenario tree.
 *
 * `NO_BASE` is separate from `NO_SCENARIO` on purpose: the reader is holding a scenario that
 * does exist and it is the parent that has gone, so telling them "no such scenario" would send
 * them looking in the wrong place.
 */
export const SCENARIO_ISSUE_LABEL: Readonly<Record<ScenarioIssueKind, Localized>> = {
  NO_SCENARIO: {
    ar: 'لا سيناريو بهذا الاسم',
    fr: 'Aucun scénario de ce nom',
    en: 'No scenario by that name',
  },
  NO_BASE: {
    ar: 'السيناريو الأب مفقود',
    fr: 'Le scénario parent a disparu',
    en: 'The scenario it inherits from is gone',
  },
  CHAIN_CYCLE: {
    ar: 'سلسلة وراثة تدور على نفسها',
    fr: 'La chaîne d’héritage boucle sur elle-même',
    en: 'The inheritance chain loops back on itself',
  },
  UNDECLARED: {
    ar: 'تعديل على افتراض غير معلن',
    fr: 'Un ajustement sur une hypothèse non déclarée',
    en: 'An override on an assumption the model does not declare',
  },
};

/**
 * Three faults in the dependency graph, keyed off the union's own discriminant.
 *
 * `Record<GraphIssue['kind'], …>` rather than a hand-written union of three strings: the graph
 * gains a fault by gaining a member, and this record should break in that same commit.
 */
export const GRAPH_ISSUE_LABEL: Readonly<Record<GraphIssue['kind'], Localized>> = {
  MISSING: {
    ar: 'صيغة تقرأ مفتاحًا غير موجود',
    fr: 'Une formule lit une clé qui n’existe pas',
    en: 'A formula reads a key that does not exist',
  },
  SHADOWED: {
    ar: 'سطر محسوب يحجب افتراضًا بنفس المفتاح',
    fr: 'Une ligne calculée masque une hypothèse de même clé',
    en: 'A computed row hides an assumption with the same key',
  },
  CYCLE: {
    ar: 'أسطر تعتمد على بعضها في الفترة نفسها',
    fr: 'Des lignes dépendent les unes des autres dans la même période',
    en: 'Rows depend on each other inside one period',
  },
};
