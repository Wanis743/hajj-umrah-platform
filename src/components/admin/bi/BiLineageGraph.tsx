/**
 * The four halves of a lineage answer, and the hierarchy under a dimension.
 *
 * Split out of the lineage panel because the panel's job is choosing a subject and these
 * are what an answer looks like once one is chosen. Every section here is read-only and
 * takes exactly the slice of `BiLineage` it draws, so none of them can accidentally start
 * depending on the picker's state.
 *
 * The two directions answer different questions and are deliberately shaped differently.
 * Upstream is "which physical columns does this read", and the honest unit there is a
 * table: relation, column, type. Downstream is "who would notice if I changed it", and
 * the honest unit is a list of named things a person can go look at -- an analysis inside
 * a report, a dashboard that is published, a RATIO built on this metric.
 */
import { ArrowRight, Columns3, LayoutGrid, LineChart, Link2 } from 'lucide-react';
import type {
  BiDrillPath, BiLineageAnalysis, BiLineageColumn, BiLineageDashboard, BiLineageDependent,
} from '@/types/bi';
import { Panel, Pill, StatusPill } from './atoms';
import { fmtInt, useBiChartLabels, useBiI18n, useBiLabels } from './biFormat';

/** Nothing to show, said in the section that has nothing -- rather than the section
 *  disappearing, which would leave the reader unsure whether it was empty or not asked. */
function Nothing({ children }: { children: string }) {
  return (
    <p className="py-6 text-center text-[12px] text-[var(--text-muted)]">{children}</p>
  );
}

/**
 * The physical columns behind the definition.
 *
 * `via` is the whole point of the column: 'source' means the dataset's relation exposes
 * it, 'expression' means this definition's own SQL names it. A dataset's lineage is all
 * source; a metric's is all expression; seeing which is which is how a reader tells "this
 * dataset can read that column" from "this metric does read that column".
 */
export function LineageUpstream({ columns }: { columns: readonly BiLineageColumn[] }) {
  const { t } = useBiI18n();

  return (
    <Panel
      title={t('المصدر الفعلي', 'Source physique', 'Upstream columns')}
      subtitle={t('الأعمدة التي يقرأها هذا التعريف فعلًا',
        'Les colonnes que cette définition lit réellement',
        'The columns this definition actually reads')}
      actions={<Pill tone="neutral">{fmtInt(columns.length)}</Pill>}
    >
      {columns.length === 0 ? (
        <Nothing>
          {t('لا عمود مقيس', 'Aucune colonne mesurée', 'No column measured')}
        </Nothing>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[520px]">
            <thead>
              <tr>
                <th>{t('العلاقة', 'Relation', 'Relation')}</th>
                <th>{t('العمود', 'Colonne', 'Column')}</th>
                <th>{t('النوع', 'Type', 'Type')}</th>
                <th>{t('عبر', 'Via', 'Via')}</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={`${column.relation}.${column.column_name}.${column.via}`}>
                  <td className="font-mono text-[11px]" dir="ltr">{column.relation}</td>
                  <td>
                    <span className="font-mono text-[11px]" dir="ltr">{column.column_name}</span>
                    {column.display_name !== column.column_name && (
                      <span className="ms-2 text-[11px] text-[var(--text-muted)]">
                        {column.display_name}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-[11px]" dir="ltr">{column.data_type}</td>
                  <td>
                    <Pill tone={column.via === 'source' ? 'neutral' : 'info'}>
                      {column.via === 'source'
                        ? t('المصدر', 'Source', 'Source')
                        : t('التعبير', 'Expression', 'Expression')}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * The saved analyses that would change meaning.
 *
 * `on_dashboards` is on the row because an analysis nobody placed and an analysis on four
 * dashboards are the same object with very different consequences, and the report it
 * belongs to is named because "which document says this" is the next question.
 */
export function LineageAnalyses({ analyses }: { analyses: readonly BiLineageAnalysis[] }) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const chartLabels = useBiChartLabels();

  return (
    <Panel
      title={t('التحليلات المتأثرة', 'Analyses concernées', 'Downstream analyses')}
      actions={<Pill tone="neutral">{fmtInt(analyses.length)}</Pill>}
    >
      {analyses.length === 0 ? (
        <Nothing>
          {t('لا تحليل يستخدم هذا', 'Aucune analyse ne l’utilise', 'No analysis uses this')}
        </Nothing>
      ) : (
        <ul className="space-y-2">
          {analyses.map((analysis) => (
            <li key={analysis.id} className="rounded-lg border border-[var(--border)] p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
                  <LineChart className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {analysis.title}
                </span>
                <Pill tone="neutral">{chartLabels[analysis.chart_type]}</Pill>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                <span className="font-mono" dir="ltr">{analysis.key}</span>
                {analysis.report_title !== null && (
                  <>
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    <span>{analysis.report_title}</span>
                    {analysis.report_status !== null && (
                      <StatusPill
                        status={analysis.report_status}
                        label={labels.status[analysis.report_status]}
                      />
                    )}
                  </>
                )}
                {analysis.on_dashboards > 0 && (
                  <Pill tone="info">
                    {t(`على ${fmtInt(analysis.on_dashboards)} لوحة`,
                      `Sur ${fmtInt(analysis.on_dashboards)} tableaux`,
                      `On ${fmtInt(analysis.on_dashboards)} dashboards`)}
                  </Pill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The dashboards that draw it, with the published ones marked.
 *
 * Published is the only distinction that matters here. A draft dashboard breaking is the
 * author's problem; a published one breaking is everybody's, which is why
 * `set_bi_status_command` refuses a deprecation that would blank one and why this list
 * shows the same fact before anyone tries.
 */
export function LineageDashboards({ dashboards }: {
  dashboards: readonly BiLineageDashboard[];
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();

  return (
    <Panel
      title={t('اللوحات المتأثرة', 'Tableaux concernés', 'Downstream dashboards')}
      actions={<Pill tone="neutral">{fmtInt(dashboards.length)}</Pill>}
    >
      {dashboards.length === 0 ? (
        <Nothing>
          {t('لا لوحة ترسم هذا', 'Aucun tableau ne le dessine', 'No dashboard draws this')}
        </Nothing>
      ) : (
        <ul className="space-y-1.5">
          {dashboards.map((dashboard) => (
            <li
              key={dashboard.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2.5"
            >
              <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
                <LayoutGrid className="h-3 w-3 shrink-0" aria-hidden="true" />
                {dashboard.title}
                <span className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
                  {dashboard.key}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                {dashboard.is_default && (
                  <Pill tone="info">{t('الافتراضية', 'Par défaut', 'Default')}</Pill>
                )}
                <StatusPill status={dashboard.status} label={labels.status[dashboard.status]} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The edges inside the semantic layer itself.
 *
 * Neither of these is discoverable by reading the row being edited: a RATIO names its
 * operands by key on its own row, not on theirs, and a drill hierarchy is a pointer from
 * the child. Deprecating a metric that two RATIOs divide by is the failure this section
 * exists to make visible.
 */
export function LineageDependents({ dependents }: {
  dependents: readonly BiLineageDependent[];
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();

  const relationLabel: Record<BiLineageDependent['relation'], string> = {
    numerator: t('كبسط', 'comme numérateur', 'as numerator'),
    denominator: t('كمقام', 'comme dénominateur', 'as denominator'),
    drills_into: t('ينقّب إليه', 'descend vers lui', 'drills into it'),
  };

  return (
    <Panel
      title={t('تعريفات تعتمد عليه', 'Définitions dépendantes', 'Dependent definitions')}
      subtitle={t('لا يظهر أي منها في صف هذا التعريف نفسه',
        'Aucune n’apparaît sur la ligne de cette définition',
        'None of these appear on this definition’s own row')}
      actions={<Pill tone="neutral">{fmtInt(dependents.length)}</Pill>}
    >
      {dependents.length === 0 ? (
        <Nothing>
          {t('لا تعريف يعتمد عليه', 'Aucune définition n’en dépend',
            'No definition depends on it')}
        </Nothing>
      ) : (
        <ul className="space-y-1.5">
          {dependents.map((dependent) => (
            <li
              key={`${dependent.kind}:${dependent.id}:${dependent.relation}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2.5"
            >
              <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
                {dependent.kind === 'METRIC'
                  ? <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                  : <Columns3 className="h-3 w-3 shrink-0" aria-hidden="true" />}
                {dependent.display_name}
                <span className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
                  {dependent.key}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                {relationLabel[dependent.relation]}
                {dependent.status !== undefined && (
                  <StatusPill status={dependent.status} label={labels.status[dependent.status]} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The hierarchy under a dimension, as the path a drill would take.
 *
 * Walked in the database by `get_bi_drill_path`, including its 32-level cycle guard, and
 * printed here as one ordered list. Two things are marked per level and they are not the
 * same thing: `has_drill_through` means a cell at this level opens records, and
 * `drill_through_kind` names which screen it opens. A level with a kind and no expression
 * is a hierarchy step only, which is worth seeing rather than discovering by clicking.
 */
export function LineageDrillPath({ path }: { path: BiDrillPath }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();

  return (
    <Panel
      title={t('التسلسل الهرمي', 'Hiérarchie', 'Drill hierarchy')}
      subtitle={t('يُحسب في قاعدة البيانات، حيث لا يمكن لواجهة تجاوز حارس الدوران',
        'Calculée dans la base, là où aucune interface ne peut contourner le garde-fou',
        'Walked in the database, where no interface can skip the cycle guard')}
      actions={
        <Pill tone="neutral">
          {t(`${fmtInt(path.depth)} مستوى`, `${fmtInt(path.depth)} niveaux`,
            `${fmtInt(path.depth)} levels`)}
        </Pill>
      }
    >
      {path.path.length === 0 ? (
        <Nothing>
          {t('لا مستوى تحت هذا البعد', 'Aucun niveau sous cette dimension',
            'No level under this dimension')}
        </Nothing>
      ) : (
        <ol className="space-y-1.5">
          {path.path.map((node) => (
            <li
              key={node.key}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-2.5"
              style={{ marginInlineStart: `${Math.min(node.depth, 8) * 0.75}rem` }}
            >
              <span className="text-[11px] text-[var(--text-muted)] tabular">
                {fmtInt(node.depth + 1)}
              </span>
              <span className="text-[13px] text-[var(--text-primary)]">
                {(isAr && node.display_name_ar) ? node.display_name_ar : node.display_name}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
                {node.key}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
                {node.data_type}
              </span>
              {node.drill_through_kind !== null && (
                <Pill tone={node.has_drill_through ? 'good' : 'neutral'}>
                  {labels.drillThrough[node.drill_through_kind]}
                </Pill>
              )}
              {node.drill_through_kind !== null && !node.has_drill_through && (
                <Pill tone="warn">
                  {t('بلا تعبير — مستوى فقط', 'Sans expression — niveau seul',
                    'No expression — level only')}
                </Pill>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
