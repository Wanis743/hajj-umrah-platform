/**
 * Reports: a document made of saved analyses, read in order.
 *
 * A report and a dashboard are different objects on purpose, and this screen is where
 * the difference shows. A report is read top to bottom -- its analyses have a
 * `sort_order` and no geometry, because the argument they make is sequential. A
 * dashboard is a grid you scan. Forcing one shape on both would give the report a layout
 * it does not need and the dashboard an order it does not have.
 *
 * Nothing here writes. A report's status moves through `set_bi_status_command` on the
 * studio screen, where the impact of a deprecation is shown next to it.
 */
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import type { BiReport, BiSavedVisualization } from '@/types/bi';
import { Panel, Pill, StatusPill } from './atoms';
import { BiSavedTile } from './BiSavedTile';
import { fmtDate, fmtInt, useBiI18n, useBiLabels, useBiRead } from './biFormat';

/** One shared empty array, so an unloaded payload does not hand the derived values a
 *  fresh identity on every render. */
const NO_REPORTS: readonly BiReport[] = [];

export function BiReportsPanel() {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<BiReport[]>(() => biAnalytics.reports(), []);
  const [selected, setSelected] = useState<string | null>(null);

  const reports = data ?? NO_REPORTS;
  const active = reports.find((r) => r.id === selected) ?? reports[0] ?? null;

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {reports.length === 0 ? (
        <Panel title={t('التقارير', 'Rapports', 'Reports')}>
          <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('لا تقرير بعد — احفظ تحليلًا من المُنشئ ثم أضفه إلى تقرير',
              'Aucun rapport — enregistrez une analyse depuis le générateur, puis ajoutez-la à un rapport',
              'No report yet — save an analysis from the builder, then add it to a report')}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <p className="px-1 text-[11px] text-[var(--text-muted)] tabular">
              {t(`${fmtInt(reports.length)} تقرير`, `${fmtInt(reports.length)} rapports`,
                `${fmtInt(reports.length)} reports`)}
            </p>
            <ul className="space-y-2">
              {reports.map((report) => (
                <li key={report.id}>
                  <ReportRow
                    report={report}
                    active={report.id === active?.id}
                    onSelect={() => setSelected(report.id)}
                  />
                </li>
              ))}
            </ul>
          </div>

          {active && <ReportBody report={active} />}
        </div>
      )}
    </div>
  );
}

/**
 * One report in the list.
 *
 * The analysis count is on the row because an empty report is the common failure of a
 * report builder: it saves, it publishes, and it says nothing.
 */
function ReportRow({ report, active, onSelect }: {
  report: BiReport;
  active: boolean;
  onSelect: () => void;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const title = (isAr && report.title_ar) ? report.title_ar : report.title;
  const denied = report.visualizations.filter((v) => !v.readable_by_me).length;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`card w-full p-3 text-start transition-colors ${
        active ? 'border-[var(--accent)] bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
        <StatusPill status={report.status} label={labels.status[report.status]} />
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
        {report.key}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <span className="tabular">
          {t(`${fmtInt(report.visualizations.length)} تحليل`,
            `${fmtInt(report.visualizations.length)} analyses`,
            `${fmtInt(report.visualizations.length)} analyses`)}
        </span>
        {report.visualizations.length === 0 && (
          <Pill tone="warn">{t('فارغ', 'Vide', 'Empty')}</Pill>
        )}
        {denied > 0 && (
          <Pill tone="warn">
            {t(`${fmtInt(denied)} غير مقروء`, `${fmtInt(denied)} non lisibles`,
              `${fmtInt(denied)} not readable`)}
          </Pill>
        )}
      </div>
    </button>
  );
}

/**
 * The report itself: its heading, then every analysis in `sort_order`.
 *
 * Each analysis is its own read, so a report of nine charts writes nine ledger rows and
 * nine authorization checks rather than one of each. That is the point -- a report is not
 * a permission boundary, and the analyses inside it are not all about the same data.
 */
function ReportBody({ report }: { report: BiReport }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const title = (isAr && report.title_ar) ? report.title_ar : report.title;
  const ordered = [...report.visualizations].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="min-w-0 space-y-4">
      <Panel
        title={title}
        subtitle={report.description ?? undefined}
        actions={<StatusPill status={report.status} label={labels.status[report.status]} />}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <span className="font-mono" dir="ltr">{report.key}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">
            {t(`الإصدار ${fmtInt(report.version)}`, `Version ${fmtInt(report.version)}`,
              `Version ${fmtInt(report.version)}`)}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {report.published_at === null
              ? t('غير منشور', 'Non publié', 'Not published')
              : t(`نُشر ${fmtDate(report.published_at)}`,
                `Publié le ${fmtDate(report.published_at)}`,
                `Published ${fmtDate(report.published_at)}`)}
          </span>
          {report.deprecated_at !== null && (
            <Pill tone="bad">
              {t(`أُهمل ${fmtDate(report.deprecated_at)}`,
                `Déprécié le ${fmtDate(report.deprecated_at)}`,
                `Deprecated ${fmtDate(report.deprecated_at)}`)}
            </Pill>
          )}
        </div>
      </Panel>

      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-muted)]">
          {t('هذا التقرير لا يحتوي تحليلًا', 'Ce rapport ne contient aucune analyse',
            'This report holds no analysis')}
        </p>
      ) : (
        <div className="space-y-4">
          {ordered.map((analysis) => (
            <AnalysisSection key={analysis.id} analysis={analysis} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One analysis inside a report: what it is made of, then the chart.
 *
 * The definition line is printed above the numbers rather than hidden behind a tooltip,
 * because a report is read by people who did not build it, and "which metric, grouped by
 * what, filtered how" is the first question any of them will have.
 */
function AnalysisSection({ analysis }: { analysis: BiSavedVisualization }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const title = (isAr && analysis.title_ar) ? analysis.title_ar : analysis.title;
  const grain = analysis.time_grain === null ? null : labels.grain[analysis.time_grain];

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
        <FileText className="h-3 w-3" aria-hidden="true" />
        <span className="font-mono" dir="ltr">{analysis.dataset_key}</span>
        {grain !== null && <Pill tone="info">{grain}</Pill>}
        {analysis.dataset_status === 'DEPRECATED' && (
          <Pill tone="bad">
            {t('المجموعة مُهملة', 'Jeu déprécié', 'Dataset deprecated')}
          </Pill>
        )}
        {analysis.filters.length > 0 && (
          <span className="tabular">
            {t(`${fmtInt(analysis.filters.length)} مرشّح`,
              `${fmtInt(analysis.filters.length)} filtres`,
              `${fmtInt(analysis.filters.length)} filters`)}
          </span>
        )}
      </div>
      <BiSavedTile
        visualizationId={analysis.id}
        title={title}
        subtitle={definitionLine(analysis)}
        readable={analysis.readable_by_me}
        height={300}
      />
    </div>
  );
}

/** The analysis as one sentence of keys: measures by dimensions. Keys rather than
 *  labels, because the same keys are what appear in the compiled statement the tile can
 *  be asked for, and a reader comparing the two should find the same words. */
function definitionLine(analysis: BiSavedVisualization): string {
  const measures = analysis.measures.join(', ');
  const dimensions = analysis.dimensions.join(', ');
  if (measures === '' && dimensions === '') return analysis.key;
  if (dimensions === '') return measures;
  if (measures === '') return dimensions;
  return `${measures} × ${dimensions}`;
}
