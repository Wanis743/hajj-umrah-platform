/**
 * The controls every definition form is built from, and the sentence for every issue code.
 *
 * Split out of the forms because three cards share them and a `.tsx` under `src/components`
 * fails the maintainability gate past 600 lines -- but also because the split is honest:
 * these know nothing about datasets, dimensions or metrics. A text row, a column list, a
 * save bar, and the translation of a `DefinitionIssue` into one sentence.
 *
 * The issue text lives here rather than in `biDefinitionState` for the same reason the
 * builder's does: the state file decides *what* is wrong and returns a code, and only a
 * component can reach the language context that turns a code into prose. Where the database
 * already has an authored sentence for a condition, the sentence below says the same thing
 * in the same voice, so a reader who trips the server-side check later does not think they
 * have hit a second, different rule.
 */
import { AlertTriangle, Save, Trash2, X } from 'lucide-react';
import type { BiDataType, BiSourceColumn } from '@/types/bi';
import { Field, InlineNote, Pill } from './atoms';
import { fmtInt, useBiI18n } from './biFormat';
import { definitionIssueKey, type DefinitionIssue } from './biDefinitionState';

/** A field descriptor for `BiFilterEditor`, built by the screen above from the dataset's
 *  dimensions and its source's columns. Declared here so every card can name it. */
export interface DefinitionFilterField {
  key: string;
  label: string;
  dataType?: BiDataType;
  group: string;
}

function useIssueText(): (issue: DefinitionIssue) => string {
  const { t } = useBiI18n();

  return (issue: DefinitionIssue): string => {
    switch (issue.kind) {
      case 'KEY_BLANK':
        return t('المفتاح مطلوب', 'La clé est requise', 'A key is required');
      case 'KEY_SHAPE':
        return t('يبدأ المفتاح بحرف صغير ثم حروف صغيرة أو أرقام أو شرطة سفلية، ٢ إلى ٦١ حرفًا',
          'Une clé commence par une minuscule, puis minuscules, chiffres ou tirets bas, 2 à 61 caractères',
          'A key starts with a lowercase letter, then lowercase letters, digits or underscores, 2 to 61 characters');
      case 'NAME_BLANK':
        return t('الاسم المعروض مطلوب', 'Le nom affiché est requis', 'A display name is required');
      case 'FILTER_NEEDS_SOURCE':
        return t('مرشّح الصفوف يحتاج مصدرًا ليرشّحه؛ اربط المصدر أولًا',
          'Un filtre de lignes a besoin d’une source à filtrer ; liez-la d’abord',
          'A row filter needs a source to filter; bind the source first');
      case 'TIME_COLUMN_NEEDS_SOURCE':
        return t('عمود الزمن الافتراضي عمود من المصدر؛ اربط المصدر أولًا',
          'La colonne temporelle par défaut vient de la source ; liez-la d’abord',
          'The default time column is a column of the source; bind the source first');
      case 'FILTER_INCOMPLETE':
        return t(`المرشّح على «${issue.field}» بلا قيمة`,
          `Le filtre sur « ${issue.field} » n’a pas de valeur`,
          `The filter on “${issue.field}” has no value`);
      case 'EXPRESSION_BLANK':
        return t('التعبير مطلوب — البعد يقرأ عمودًا فعليًا',
          'L’expression est requise — une dimension lit une colonne réelle',
          'An expression is required — a dimension reads a real column');
      case 'DRILL_PAIR':
        return t('التنقيب العميق يحتاج نوعًا وتعبيرًا معًا، أو لا شيء',
          'Le forage exige un type et une expression, ou aucun des deux',
          'Drill-through needs both a kind and an expression, or neither');
      case 'SELF_DRILL':
        return t('لا يمكن لبعد أن ينقّب إلى نفسه',
          'Une dimension ne peut pas descendre vers elle-même',
          'A dimension cannot drill into itself');
      case 'FORMULA_BLANK':
        return t('الصيغة مطلوبة لكل تجميع غير النسبة',
          'La formule est requise pour tout agrégat autre que RATIO',
          'A formula is required for every aggregate except RATIO');
      case 'RATIO_OPERAND_MISSING':
        return t('النسبة تحتاج بسطًا ومقامًا معًا',
          'Un ratio exige un numérateur et un dénominateur',
          'A ratio needs both a numerator and a denominator');
      case 'RATIO_SELF':
        return t('لا يمكن لنسبة أن تقسم نفسها على نفسها',
          'Un ratio ne peut pas se diviser par lui-même',
          'A ratio cannot divide itself by itself');
      case 'RATIO_UNKNOWN_OPERAND':
        return t(`«${issue.key}» ليس مقياسًا في هذه المجموعة؛ عرّفه أولًا`,
          `« ${issue.key} » n’est pas une mesure de ce jeu ; définissez-la d’abord`,
          `“${issue.key}” is not a metric of this dataset; define it first`);
      case 'RATIO_OF_RATIO':
        return t(`«${issue.key}» نسبة بنفسه؛ استخدم المقاييس الجمعية تحته`,
          `« ${issue.key} » est déjà un ratio ; utilisez les mesures additives sous-jacentes`,
          `“${issue.key}” is itself a ratio; use the underlying additive metrics instead`);
      case 'DECIMALS_RANGE':
        return t('الخانات العشرية عدد صحيح بين ٠ و٦',
          'Les décimales sont un entier entre 0 et 6',
          'Decimals is a whole number between 0 and 6');
      case 'SORT_ORDER_NUMBER':
        return t('الترتيب عدد صحيح', 'L’ordre est un entier', 'Sort order is a whole number');
    }
  };
}

/** Every reason Save is off, listed rather than summarised. A single "invalid" would leave
 *  the reader hunting for which field it meant. */
export function IssueList({ issues }: { issues: readonly DefinitionIssue[] }) {
  const issueText = useIssueText();
  if (issues.length === 0) return null;

  return (
    <div>
      {issues.map((issue) => (
        <InlineNote key={definitionIssueKey(issue)} tone="bad">{issueText(issue)}</InlineNote>
      ))}
    </div>
  );
}

/**
 * The columns an expression may name, measured from the source.
 *
 * `private.bi_assert_safe_expression` checks every token against exactly this list, so a
 * name absent from it is a refusal rather than a null. Shown scrollable and in full: a
 * truncated column list is worse than none, because the author would trust it.
 */
export function ColumnHints({ columns }: { columns: readonly BiSourceColumn[] }) {
  const { t } = useBiI18n();
  if (columns.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2">
      <p className="mb-1.5 text-[11px] text-[var(--text-muted)]">
        {t(`أعمدة المصدر (${fmtInt(columns.length)}) — التعبير لا يسمّي غيرها`,
          `Colonnes de la source (${fmtInt(columns.length)}) — l’expression ne peut nommer qu’elles`,
          `Source columns (${fmtInt(columns.length)}) — an expression may name only these`)}
      </p>
      <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
        {columns.map((column) => (
          <Pill key={column.column_name} tone="neutral" title={column.data_type}>
            <span className="font-mono" dir="ltr">{column.column_name}</span>
          </Pill>
        ))}
      </div>
    </div>
  );
}

/** Save, cancel, and -- only where the parent passes one -- delete. `blocked` is the issue
 *  list being non-empty; `busy` is a write already in flight, which `useBiCommand` also
 *  guards with a ref so a double click cannot become two rows. */
export function FormActions({ busy, blocked, onSave, onCancel, onDelete }: {
  busy: boolean;
  blocked: boolean;
  onSave: () => void;
  onCancel: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const { t } = useBiI18n();

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || blocked} onClick={onSave}>
        <Save className="me-1 h-3.5 w-3.5" aria-hidden="true" />
        {busy ? t('يُحفظ…', 'Enregistrement…', 'Saving…') : t('حفظ', 'Enregistrer', 'Save')}
      </button>
      {onCancel !== null && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
          <X className="me-1 h-3.5 w-3.5" aria-hidden="true" />
          {t('إلغاء', 'Annuler', 'Cancel')}
        </button>
      )}
      {onDelete !== null && (
        <button type="button" className="btn btn-danger btn-sm ms-auto" disabled={busy} onClick={onDelete}>
          <Trash2 className="me-1 h-3.5 w-3.5" aria-hidden="true" />
          {t('حذف', 'Supprimer', 'Delete')}
        </button>
      )}
    </div>
  );
}

/** A one-line text control. `code` marks a value the database reads as an identifier or an
 *  expression: monospace and forced LTR, because a key or a SQL fragment is ASCII even on an
 *  Arabic screen and bidi reordering would show it in an order it is not stored in. */
export function TextRow({ label, hint, value, onChange, placeholder, code, disabled }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  code?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className={code === true ? 'input font-mono text-[12px]' : 'input'}
        dir={code === true ? 'ltr' : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled === true}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** A multi-line control, for descriptions and for expressions. */
export function AreaRow({ label, hint, value, onChange, placeholder, code, rows }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  code?: boolean;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={code === true ? 'input font-mono text-[12px]' : 'input'}
        dir={code === true ? 'ltr' : undefined}
        rows={rows ?? 2}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/**
 * Renaming a key is legal and consequential, which is the pairing that earns a warning
 * rather than a refusal.
 *
 * `bi_visualizations.dimensions` and `.measures` are jsonb arrays of key strings, not
 * foreign keys, and a dimension's `drill_to_key` and a ratio's operands are keys too. So a
 * rename is accepted by the write and then fails later, somewhere else, when the compiler
 * cannot resolve the old name.
 */
export function RenameWarning({ show }: { show: boolean }) {
  const { t } = useBiI18n();
  if (!show) return null;

  return (
    <InlineNote tone="warn">
      <AlertTriangle className="me-1 inline h-3 w-3" aria-hidden="true" />
      {t('تغيير المفتاح مسموح، لكن كل تحليل محفوظ يسمّي المفتاح القديم سيتوقف عن الترجمة',
        'Renommer la clé est permis, mais toute analyse enregistrée qui cite l’ancienne cessera de compiler',
        'Renaming the key is allowed, but every saved analysis that cites the old one will stop compiling')}
    </InlineNote>
  );
}
