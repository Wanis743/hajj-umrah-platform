/**
 * One saved analysis, fetched and drawn: the unit both the report reader and the
 * dashboard grid are built out of.
 *
 * Each tile fetches its own numbers through `run_bi_visualization_command` rather than
 * being handed them by its parent, and that is a deliberate cost. Three things follow
 * from it that a single batched read would lose:
 *
 * 1. Every tile is separately authorized. A grid of six where the viewer may read four
 *    renders four charts and two stated refusals, instead of one refusal for the page.
 * 2. Every tile is separately logged. `bi_query_log` gets one row per tile per view,
 *    which is what makes "who read this number, and what statement produced it"
 *    answerable at the granularity of the number rather than the page.
 * 3. A dashboard is usable while it loads. Tiles arrive as they finish instead of the
 *    page staying blank until its slowest query returns.
 *
 * A tile the caller may not read does not call at all. The refusal is already known from
 * `readable_by_me`, and spending a ledger row to be told it again would make the audit
 * trail noisier without making it more true.
 */
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import type { BiQuerySuccess, BiVisualizationChrome } from '@/types/bi';
import { BiChart } from './BiChart';
import { InlineNote, Panel, Pill } from './atoms';
import { fmtInt, fmtMs, useBiI18n, useBiRead } from './biFormat';

/** What `run_bi_visualization_command` returns once the failure branch has been
 *  unwrapped into an error: the numbers and how to draw them, in one round trip. */
type TileResult = BiQuerySuccess & BiVisualizationChrome;

export function BiSavedTile({ visualizationId, title, subtitle, readable, height = 260 }: {
  visualizationId: string;
  /** The tile's resolved title -- the tile's override or the analysis's own, decided
   *  server-side so the grid does not have to know which one it got. */
  title: string;
  subtitle?: string;
  /** Whether the caller may read the dataset behind this analysis. False renders the
   *  refusal and makes no call. */
  readable: boolean;
  height?: number;
}) {
  const { t } = useBiI18n();

  return (
    <Panel title={title} subtitle={subtitle} className="h-full">
      {readable ? (
        <TileBody visualizationId={visualizationId} height={height} />
      ) : (
        <div className="py-6 text-center">
          <Pill tone="warn">{t('غير مقروء', 'Non lisible', 'Not readable')}</Pill>
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            {t('لا تملك صلاحية قراءة المصدر خلف هذا التحليل',
              'Vous n’avez pas la permission de lire la source derrière cette analyse',
              'You may not read the source behind this analysis')}
          </p>
        </div>
      )}
    </Panel>
  );
}

/**
 * The read, in its own component so the hook is never called with an id it may not use.
 *
 * The marks are not clickable. Drilling changes the request, and a saved analysis on
 * someone else's dashboard is not this reader's to change -- the builder is where a
 * question gets edited. `BiChart` expresses that by the absence of `onSelect`.
 */
function TileBody({ visualizationId, height }: { visualizationId: string; height: number }) {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<TileResult>(
    () => biAnalytics.runVisualization(visualizationId), [visualizationId],
  );

  if (loading && !data) return <Spinner className="py-10" />;
  if (!data) {
    return (
      <ErrorBanner
        message={error ?? t('لم يُقاس هذا التحليل', 'Analyse non mesurée',
          'This analysis did not run')}
        onRetry={reload}
      />
    );
  }

  return (
    <div>
      <BiChart type={data.chart_type} result={data} height={height} />
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span className="tabular">
          {t(`${fmtInt(data.row_count)} صف`, `${fmtInt(data.row_count)} lignes`,
            `${fmtInt(data.row_count)} rows`)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular">{fmtMs(data.duration_ms)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono" dir="ltr">{data.visualization_key}</span>
        {data.truncated && (
          <Pill tone="warn">
            {t(`مبتور عند ${fmtInt(data.row_limit)}`, `Tronqué à ${fmtInt(data.row_limit)}`,
              `Truncated at ${fmtInt(data.row_limit)}`)}
          </Pill>
        )}
      </p>
      {error !== null && <InlineNote tone="warn">{error}</InlineNote>}
    </div>
  );
}
