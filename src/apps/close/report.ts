/**
 * Period close — what leaves the window.
 *
 * A close produces paper. Somebody signs the checklist, somebody else keeps it, and
 * an auditor asks for it eleven months later — so the export is not a convenience,
 * it is the artefact. Four of them, one per view, because "export" on a toolbar
 * means "the thing I am looking at" and nothing else.
 *
 * Values are raw on purpose: ISO dates, decimals with a dot, statuses in the reader's
 * language but amounts in nobody's. A close pack that renders `1 250,00 DA` is a close
 * pack Excel will read as text in one locale and as a number in the other.
 */
import { csvDocument } from '../shared/csv';
import { type CloseTask, type FiscalPeriod, PERIOD_STATUS_LABEL, TASK_STATUS_LABEL } from '../shared/ledger';
import type { Localized } from '@/platform/sdk';
import { CHECK_LABEL, CHECK_STATE_LABEL, type ChecklistRow, type CloseAssessment, type CloseCheck } from './checks';
import {
  CONTROL_FREQUENCY_LABEL,
  CONTROL_RESULT_LABEL,
  CONTROL_STATE_LABEL,
  controlState,
  type FinancialControl,
} from './controls';
import type { AuditRow } from './model';

/** The translator the runtime already holds, narrowed to what a pure module needs. */
export type Label = (value: Localized) => string;
export type Translate = (ar: string, fr: string, en: string) => string;

/** `close-2026-03-tasks.csv` — the period first, because that is how it is filed. */
export function suggestedFileName(period: FiscalPeriod | null, view: string, today: string): string {
  const stem = period === null ? today : period.label.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();
  return `close-${stem}-${view}.csv`;
}

/** The checklist somebody signs: one row per task, in the order it must be worked. */
export function checklistCsv(rows: readonly ChecklistRow[], t: Label, tr: Translate): string {
  return csvDocument(
    [
      tr('#', '#', '#'),
      tr('المهمة', 'Tâche', 'Task'),
      tr('الحالة', 'Statut', 'Status'),
      tr('يعتمد على', 'Dépend de', 'Depends on'),
      tr('غير مستوفى', 'Non satisfait', 'Unmet'),
      tr('المسؤول', 'Responsable', 'Owner'),
      tr('آخر تحديث', 'Mis à jour', 'Updated'),
    ],
    rows.map((row, index) => [
      String(index + 1),
      row.task.name,
      t(TASK_STATUS_LABEL[row.task.status]),
      row.task.dependencies.join(' | '),
      row.unmet.join(' | '),
      row.task.ownerId ?? '',
      row.task.updatedAt ?? '',
    ]),
  );
}

/** The gate, as it read at the moment of export — findings, not opinions. */
export function checkCsv(
  checks: readonly CloseCheck[],
  period: FiscalPeriod | null,
  t: Label,
  tr: Translate,
): string {
  return csvDocument(
    [
      tr('الفترة', 'Période', 'Period'),
      tr('الفحص', 'Contrôle', 'Check'),
      tr('النتيجة', 'Résultat', 'Result'),
      tr('العدد', 'Nombre', 'Count'),
      tr('الفرق', 'Écart', 'Difference'),
    ],
    checks.map((check) => [
      period?.label ?? '',
      t(CHECK_LABEL[check.id]),
      t(CHECK_STATE_LABEL[check.state]),
      String(check.count),
      check.amount === null ? '' : check.amount.toFixed(2),
    ]),
  );
}

/** The trail, exactly as the kernel handed it over. */
export function trailCsv(rows: readonly AuditRow[], tr: Translate): string {
  return csvDocument(
    [
      tr('الوقت', 'Horodatage', 'Timestamp'),
      tr('الإجراء', 'Action', 'Action'),
      tr('المورد', 'Ressource', 'Resource'),
      tr('المعرّف', 'Identifiant', 'Identifier'),
      tr('المستخدم', 'Utilisateur', 'User'),
    ],
    rows.map((row) => [row.at, row.action, row.resource, row.resourceId ?? '', row.email]),
  );
}

/**
 * The register, as an auditor asks for it.
 *
 * `state` is exported alongside `last_result` rather than instead of it, because the
 * two disagree on purpose: a control whose last test passed in March is `passed` and
 * `overdue`, and a file that carried only the first would be the misleading half.
 */
export function controlCsv(
  rows: readonly FinancialControl[],
  now: number,
  t: Label,
  tr: Translate,
): string {
  return csvDocument(
    [
      tr('الرمز', 'Code', 'Code'),
      tr('الوصف', 'Description', 'Description'),
      tr('المسؤول', 'Responsable', 'Owner'),
      tr('التواتر', 'Fréquence', 'Frequency'),
      tr('الحالة', 'État', 'State'),
      tr('آخر اختبار', 'Dernier test', 'Last tested'),
      tr('النتيجة', 'Résultat', 'Result'),
      tr('العيّنة', 'Population', 'Population'),
      tr('الاستثناءات', 'Exceptions', 'Exceptions'),
    ],
    rows.map((row) => [
      row.code,
      row.description,
      row.ownerRole ?? '',
      t(CONTROL_FREQUENCY_LABEL[row.frequency]),
      t(CONTROL_STATE_LABEL[controlState(row, now)]),
      row.lastTestedAt ?? '',
      row.lastResult === null ? '' : t(CONTROL_RESULT_LABEL[row.lastResult]),
      row.population,
      row.exceptions,
    ]),
  );
}

/** One control and its last test, for the thread asking whether it was done. */
export function controlClipboardText(
  control: FinancialControl,
  now: number,
  t: Label,
  tr: Translate,
): string {
  const parts = [
    `${control.code} — ${t(CONTROL_STATE_LABEL[controlState(control, now)])}`,
    `${tr('التواتر', 'Fréquence', 'Frequency')}: ${t(CONTROL_FREQUENCY_LABEL[control.frequency])}`,
  ];
  if (control.description !== '') parts.push(control.description);
  if (control.ownerRole !== null) {
    parts.push(`${tr('المسؤول', 'Responsable', 'Owner')}: ${control.ownerRole}`);
  }
  if (control.lastTestedAt === null) {
    parts.push(tr('لم يُختبر بعد.', 'Jamais testé.', 'Never tested.'));
  } else {
    const result = control.lastResult === null ? '' : ` — ${t(CONTROL_RESULT_LABEL[control.lastResult])}`;
    parts.push(`${tr('آخر اختبار', 'Dernier test', 'Last tested')}: ${control.lastTestedAt}${result}`);
  }
  if (control.exceptions !== '') {
    parts.push(`${tr('الاستثناءات', 'Exceptions', 'Exceptions')}: ${control.exceptions}`);
  }
  return parts.join('\n');
}

/**
 * The close status as a paragraph, for the mail somebody sends at 18:00.
 *
 * Counts rather than money: the question at that hour is what is left, and the
 * numbers that answer it do not need a thousands separator to be understood.
 */
export function summaryClipboardText(
  period: FiscalPeriod | null,
  assessment: CloseAssessment,
  t: Label,
  tr: Translate,
): string {
  if (period === null) return tr('لا فترة محدّدة.', 'Aucune période sélectionnée.', 'No period selected.');
  const lines = [
    `${period.label} — ${t(PERIOD_STATUS_LABEL[period.status])} (${period.start} → ${period.end})`,
    `${tr('مرحّل', 'Comptabilisées', 'Posted')}: ${assessment.posted} · ${tr('مسوّدات', 'Brouillons', 'Draft')}: ${assessment.unposted}`,
    `${tr('مدين', 'Débit', 'Debit')}: ${assessment.debit.toFixed(2)} · ${tr('دائن', 'Crédit', 'Credit')}: ${assessment.credit.toFixed(2)} · ${tr('الفرق', 'Écart', 'Difference')}: ${assessment.difference.toFixed(2)}`,
    `${tr('مهام مصدّقة', 'Tâches certifiées', 'Tasks certified')}: ${assessment.certified}/${assessment.taskTotal}`,
    `${tr('عوائق', 'Obstacles', 'Blockers')}: ${assessment.failures} · ${tr('تحذيرات', 'Avertissements', 'Warnings')}: ${assessment.warnings}`,
  ];
  const open = assessment.checks.filter((check) => check.state !== 'pass');
  for (const check of open) lines.push(`— ${t(CHECK_LABEL[check.id])}: ${check.count}`);
  return lines.join('\n');
}

/** One task, for pasting into whatever thread is asking about it. */
export function taskClipboardText(task: CloseTask, unmet: readonly string[], t: Label, tr: Translate): string {
  const parts = [`${task.name} — ${t(TASK_STATUS_LABEL[task.status])}`];
  if (task.dependencies.length > 0) {
    parts.push(`${tr('يعتمد على', 'Dépend de', 'Depends on')}: ${task.dependencies.join(', ')}`);
  }
  if (unmet.length > 0) parts.push(`${tr('غير مستوفى', 'Non satisfait', 'Unmet')}: ${unmet.join(', ')}`);
  if (task.updatedAt !== null) parts.push(`${tr('آخر تحديث', 'Mis à jour', 'Updated')}: ${task.updatedAt}`);
  return parts.join('\n');
}
