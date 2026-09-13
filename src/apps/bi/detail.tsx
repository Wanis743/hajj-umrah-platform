/**
 * The 360 pane: one record, read out in full.
 *
 * `list.tsx` owns the five grids and their thirty-odd columns; this file is the other half of
 * that split, where a dataset is read out completely — its source, its dimensions, its metrics,
 * what depends on it — and where a query run, an event and a source are described one at a time.
 *
 * Four states, in the order a reader meets them: nothing selected, a report still arriving, a
 * report that came back with nothing, and a record. The middle two are not interchangeable. A
 * report that has not arrived is drawn as *arriving*, never as *empty*, because an empty state
 * over a loading pane reads as "there is nothing on this dataset" — and an analyst who believes
 * that closes the pane and builds on something else. `Waiting` and `Nothing` come from
 * `./pane` so that there is exactly one rendering of each in the app.
 *
 * The pane also guards that the 360 it is holding is about *this* row. `model.dataset` is keyed
 * on `BiModelParams.datasetId`, which follows the selection by one render, so a pane that drew
 * whatever had most recently arrived would show the previous dataset's metrics under the new
 * dataset's name for exactly one frame. One identity check removes that.
 *
 * Lineage pre-empts everything, and lives in `./lineage` rather than here. When `shell.lineage`
 * is set the pane stops being an inspector and becomes a trace — *what would break if I changed
 * this* is a different question from *what is this*, asked about the same selected row and
 * answered in the same rectangle.
 */
import type { ReactElement } from 'react';
import {
  AlertTriangle,
  Boxes,
  Database,
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  Ruler,
  ScrollText,
  Sigma,
  SquareTerminal,
  Table2,
  Trash2,
} from 'lucide-react';
import {
  Button,
  fmt,
  IconButton,
  InfoBar,
  PropertyRow,
  Section,
  useLocale,
} from '@/platform/sdk';
import { Chip, Count, Dash, Latency, OpenChip, Stack, StateChip, Tinted } from './cells';
import { actorLabel, DASH, filterText, int } from './format';
import {
  AGGREGATE_LABEL,
  CHART_LABEL,
  DRILL_LABEL,
  ENTITY_KIND_LABEL,
  GRAIN_LABEL,
  METRIC_FORMAT_LABEL,
  OUTCOME_LABEL,
  STATUS_LABEL,
} from './labels';
import { LineagePane } from './lineage';
import { Nothing, Waiting } from './pane';
import type { Desk } from './pane';
import { BiShelves } from './shelves';
import { CAPTION, PANE, ROW, WRAP } from './styles';
import { additiveTone, eventTone, OUTCOME_TONE, STATUS_TONE } from './tones';
import type { BiShell } from './shell';
import type {
  BiAnalysis,
  BiDimension,
  BiEntityKind,
  BiEvent,
  BiMetric,
  BiQueryEntry,
  BiTile,
} from './types';

/* ------------------------------------------------------------------ *
 * The catalog's 360
 * ------------------------------------------------------------------ */

interface DimensionProps {
  readonly dimension: BiDimension;
  readonly shell: BiShell;
}

/**
 * One dimension: what it is called, what it compiles to, and where it drills.
 *
 * The expression is shown and not parsed. A `BEFORE` trigger validates it server-side against the
 * source's real columns, and this app does not have a SQL parser and should not grow one — so the
 * honest rendering is the text, monospaced, with the tooltip carrying the whole of it.
 */
function DimensionRow({ dimension, shell }: DimensionProps) {
  const { t, tr } = useLocale();
  return (
    <div style={ROW}>
      <Stack
        title={dimension.name}
        caption={dimension.expression}
        hint={dimension.description ?? dimension.expression}
        mono
      />
      <span style={{ marginInlineStart: 'auto', flex: 'none', ...WRAP }}>
        {dimension.drillKind === null ? null : (
          <Chip text={t(DRILL_LABEL[dimension.drillKind])} tone="info" />
        )}
        <IconButton
          icon={Ruler}
          label={tr('تحرير البُعد', 'Modifier la dimension', 'Edit dimension')}
          onClick={() => shell.editDimension(dimension)}
        />
        <IconButton
          icon={Trash2}
          label={tr('حذف', 'Supprimer', 'Delete')}
          tone="danger"
          onClick={() => shell.removeDefinition('dimension', dimension.id, dimension.name)}
        />
      </span>
    </div>
  );
}

interface MetricProps {
  readonly metric: BiMetric;
  readonly shell: BiShell;
}

/**
 * One metric: its aggregate, its formula, its own filters, and whether it may be added up.
 *
 * `isAdditive` is drawn on every non-additive metric and on no additive one. An average that is
 * stacked, subtotalled or summed across a chart produces a number that is simply wrong, and the
 * only place a reader can learn that before they do it is here.
 */
function MetricRow({ metric, shell }: MetricProps) {
  const { t, tr } = useLocale();
  const formula = metric.formula === ''
    ? `${metric.numeratorKey ?? DASH} ÷ ${metric.denominatorKey ?? DASH}`
    : metric.formula;
  return (
    <div style={ROW}>
      <Stack
        title={metric.name}
        caption={`${t(AGGREGATE_LABEL[metric.aggregate])} · ${formula}`}
        hint={metric.description ?? formula}
        mono
      />
      <span style={{ marginInlineStart: 'auto', flex: 'none', ...WRAP }}>
        {metric.format === 'NUMBER' ? null : (
          // Shown only when it is not the plain default, for the same reason
          // `isAdditive` is: a metric that reads as a percentage or an amount of money
          // is a different number from the one its formula suggests, and the aggregate
          // beside it does not say so.
          <Chip text={t(METRIC_FORMAT_LABEL[metric.format])} tone="neutral" />
        )}
        {metric.filters.length === 0 ? null : (
          <Chip
            text={`${metric.filters.length}`}
            tone="info"
            title={metric.filters.map(filterText).join('  ·  ')}
          />
        )}
        {metric.isAdditive ? null : (
          <Chip
            text={tr('غير جمعي', 'Non additive', 'Non-additive')}
            tone={additiveTone(metric.isAdditive)}
            title={tr(
              'جمع هذا المقياس أو تكديسه يعطي رقمًا خاطئًا',
              'Sommer ou empiler cette mesure produit un nombre faux',
              'Summing or stacking this metric produces a number that is wrong',
            )}
          />
        )}
        <StateChip value={metric.status} tones={STATUS_TONE} labels={STATUS_LABEL} />
        <IconButton
          icon={Sigma}
          label={tr('تحرير المقياس', 'Modifier la mesure', 'Edit metric')}
          onClick={() => shell.editMetric(metric)}
        />
        <IconButton
          icon={Trash2}
          label={tr('حذف', 'Supprimer', 'Delete')}
          tone="danger"
          onClick={() => shell.removeDefinition('metric', metric.id, metric.name)}
        />
      </span>
    </div>
  );
}

/**
 * The selected dataset, read out in full.
 *
 * The identity check on the first line is the point of the whole function. `model.dataset` is
 * keyed on a param that follows the selection by one render, so without it this pane would draw
 * the previous dataset's dimensions under the new dataset's name for exactly one frame — and a
 * frame is long enough for somebody to click a delete.
 *
 * A deactivated source is the loudest thing this pane can say. The dataset's definitions survive
 * a source that has vanished, by design — they are deactivated rather than deleted, so nothing is
 * lost when a relation is renamed — and every query against them will be refused with a sentence
 * that says why. Better to read it here than in a red toast after a run.
 */
function DatasetPane({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const read = shell.model.dataset;
  const detail = read.value;
  const selected = shell.selectedId;

  if (selected === null) {
    return (
      <Nothing
        icon={Database}
        title={tr('لم تُحدَّد مجموعة', 'Aucun jeu sélectionné', 'No dataset selected')}
        hint={tr(
          'اختر صفًا لقراءة مصدره وأبعاده ومقاييسه.',
          'Choisissez une ligne pour lire sa source, ses dimensions et ses mesures.',
          'Pick a row to read its source, its dimensions and its metrics.',
        )}
      />
    );
  }
  if (detail === null || detail.dataset.id !== selected) return <Waiting />;

  const { dataset, source, dimensions, metrics, columns } = detail;

  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 7, minWidth: 0 }}>
        <span className="fx-title-ellipsis" style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600 }}>
          {dataset.name}
        </span>
        <div style={WRAP}>
          <StateChip value={dataset.status} tones={STATUS_TONE} labels={STATUS_LABEL} />
          <span className="fx-mono" style={CAPTION}>{dataset.key}</span>
          <span style={CAPTION}>v{dataset.version}</span>
        </div>
        {dataset.description === null || dataset.description === '' ? null : (
          <span style={CAPTION}>{dataset.description}</span>
        )}
      </div>

      {source !== null && !source.isActive ? (
        <InfoBar
          tone="danger"
          icon={AlertTriangle}
          title={tr('المصدر غير نشط', 'Source inactive', 'Source inactive')}
        >
          {tr(
            'لم يعثر آخر مزامنة على العلاقة. التعريفات محفوظة، وكل استعلام سيُرفض حتى تعود.',
            'La dernière synchronisation n’a pas trouvé la relation. Les définitions sont conservées ; toute requête sera refusée jusqu’à son retour.',
            'The last sync could not find the relation. The definitions are kept, and every query will be refused until it comes back.',
          )}
        </InfoBar>
      ) : null}
      {source !== null && !source.readableByMe ? (
        <InfoBar tone="warning" icon={AlertTriangle} title={tr('قراءة ممنوعة', 'Lecture refusée', 'Not readable')}>
          {tr(
            `تحتاج إلى ${source.requiredPermission} لقراءة هذا المصدر.`,
            `Il vous faut ${source.requiredPermission} pour lire cette source.`,
            `You need ${source.requiredPermission} to read this source.`,
          )}
        </InfoBar>
      ) : null}

      <Section
        title={tr('المصدر', 'Source', 'Source')}
        action={
          <Button
            icon={GitBranch}
            variant="subtle"
            size="sm"
            onClick={() => shell.showLineage({ kind: 'DATASET', id: dataset.id })}
          >
            {tr('النسب', 'Traçabilité', 'Lineage')}
          </Button>
        }
      >
        <div>
          <PropertyRow label={tr('العلاقة', 'Relation', 'Relation')} mono>
            {source === null ? <Dash /> : source.relation}
          </PropertyRow>
          <PropertyRow label={tr('الإذن', 'Permission', 'Permission')} mono>
            {source === null ? <Dash /> : source.requiredPermission}
          </PropertyRow>
          <PropertyRow label={tr('عمود الزمن', 'Colonne temporelle', 'Time column')} mono>
            {dataset.timeColumn ?? <Dash />}
          </PropertyRow>
          <PropertyRow label={tr('أعمدة متاحة', 'Colonnes disponibles', 'Columns available')}>
            <Count value={columns.length} />
          </PropertyRow>
          <PropertyRow label={tr('شروط دائمة', 'Filtres permanents', 'Row filters')}>
            {dataset.rowFilters.length === 0 ? (
              <Dash />
            ) : (
              <span
                className="fx-mono"
                title={dataset.rowFilters.map(filterText).join('  ·  ')}
              >
                {dataset.rowFilters.map(filterText).join('  ·  ')}
              </span>
            )}
          </PropertyRow>
          <PropertyRow label={tr('الاستعلامات', 'Requêtes', 'Queries')}>
            {`${int(dataset.queryCount, lang)}${dataset.lastQueriedAt === null ? '' : ` · ${fmt.relativeTime(dataset.lastQueriedAt, lang)}`}`}
          </PropertyRow>
        </div>
      </Section>

      <Section title={`${tr('الأبعاد', 'Dimensions', 'Dimensions')} (${int(dimensions.length, lang)})`}>
        {dimensions.length === 0 ? (
          <span style={CAPTION}>
            {tr(
              'لا أبعاد بعد. البُعد هو ما يُجمَّع عليه.',
              'Aucune dimension. Une dimension est ce sur quoi on regroupe.',
              'No dimensions yet. A dimension is what you group by.',
            )}
          </span>
        ) : (
          <div>
            {dimensions.map((dimension) => (
              <DimensionRow key={dimension.id} dimension={dimension} shell={shell} />
            ))}
          </div>
        )}
      </Section>

      <Section title={`${tr('المقاييس', 'Mesures', 'Metrics')} (${int(metrics.length, lang)})`}>
        {metrics.length === 0 ? (
          <span style={CAPTION}>
            {tr(
              'لا مقاييس بعد. المقياس هو ما يُحسب.',
              'Aucune mesure. Une mesure est ce que l’on calcule.',
              'No metrics yet. A metric is what gets computed.',
            )}
          </span>
        ) : (
          <div>
            {metrics.map((metric) => (
              <MetricRow key={metric.id} metric={metric} shell={shell} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The dashboard's 360
 * ------------------------------------------------------------------ */

interface TileProps {
  readonly tile: BiTile;
  readonly shell: BiShell;
}

/**
 * One tile: what it shows, where it sits, and whether this reader may see it.
 *
 * `readableByMe` false renders a stated refusal rather than an error, which is the same choice
 * the tile itself makes on the board. A reader who cannot see two of six tiles is better served
 * by being told so than by a board that quietly has four.
 */
function TileRow({ tile, shell }: TileProps) {
  const { t, tr } = useLocale();
  return (
    <div style={ROW}>
      <Stack
        title={tile.title}
        caption={`${t(CHART_LABEL[tile.analysis.chartType])} · ${tile.analysis.datasetKey}`}
        hint={`${tile.grid.w}×${tile.grid.h} @ ${tile.grid.x},${tile.grid.y}`}
        mono
      />
      <span style={{ marginInlineStart: 'auto', flex: 'none', ...WRAP }}>
        {tile.readableByMe ? null : (
          <Chip text={tr('ممنوع', 'Refusé', 'Denied')} tone="warning" />
        )}
        <IconButton
          icon={Boxes}
          label={tr('تحرير البلاطة', 'Modifier la tuile', 'Edit tile')}
          onClick={() => shell.editTile(tile)}
        />
        <IconButton
          icon={Trash2}
          label={tr('حذف', 'Supprimer', 'Delete')}
          tone="danger"
          onClick={() => shell.removeDefinition('tile', tile.id, tile.title)}
        />
      </span>
    </div>
  );
}

function DashboardPane({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const detail = shell.model.dashboard.value;
  const selected = shell.selectedId;

  if (selected === null) {
    return (
      <Nothing
        icon={LayoutDashboard}
        title={tr('لم تُحدَّد لوحة', 'Aucun tableau sélectionné', 'No dashboard selected')}
        hint={tr(
          'اختر لوحة لقراءة بلاطاتها.',
          'Choisissez un tableau pour lire ses tuiles.',
          'Pick a dashboard to read its tiles.',
        )}
      />
    );
  }
  if (detail === null || detail.dashboard.id !== selected) return <Waiting />;

  const { dashboard, tiles, canEdit, canPublish } = detail;
  const denied = tiles.filter((tile) => !tile.readableByMe).length;

  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 7, minWidth: 0 }}>
        <span className="fx-title-ellipsis" style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600 }}>
          {dashboard.title}
        </span>
        <div style={WRAP}>
          <StateChip value={dashboard.status} tones={STATUS_TONE} labels={STATUS_LABEL} />
          <span className="fx-mono" style={CAPTION}>{dashboard.key}</span>
          {dashboard.isDefault ? <Chip text={tr('افتراضية', 'Par défaut', 'Default')} tone="accent" /> : null}
        </div>
        {dashboard.description === null || dashboard.description === '' ? null : (
          <span style={CAPTION}>{dashboard.description}</span>
        )}
      </div>

      {denied === 0 ? null : (
        <InfoBar tone="warning" icon={AlertTriangle} title={tr('بلاطات ممنوعة', 'Tuiles refusées', 'Denied tiles')}>
          {tr(
            `${denied} من ${tiles.length} بلاطة فوق مجموعة بيانات لا تقرؤها.`,
            `${denied} tuiles sur ${tiles.length} portent sur un jeu de données que vous ne lisez pas.`,
            `${denied} of ${tiles.length} tiles sit on a dataset you cannot read.`,
          )}
        </InfoBar>
      )}

      <Section title={tr('اللوحة', 'Le tableau', 'The board')}>
        <div>
          <PropertyRow label={tr('البلاطات', 'Tuiles', 'Tiles')}>
            <Count value={tiles.length} />
          </PropertyRow>
          <PropertyRow label={tr('النسخة', 'Version', 'Version')}>{`v${dashboard.version}`}</PropertyRow>
          <PropertyRow label={tr('النشر', 'Publication', 'Published')}>
            {dashboard.publishedAt === null ? <Dash /> : fmt.date(dashboard.publishedAt, lang)}
          </PropertyRow>
          <PropertyRow label={tr('صلاحياتي', 'Mes droits', 'My rights')}>
            <span style={WRAP}>
              <Chip
                text={tr('تعديل', 'Modifier', 'Edit')}
                tone={canEdit ? 'success' : 'neutral'}
              />
              <Chip
                text={tr('نشر', 'Publier', 'Publish')}
                tone={canPublish ? 'success' : 'neutral'}
              />
            </span>
          </PropertyRow>
        </div>
      </Section>

      <Section title={`${tr('البلاطات', 'Tuiles', 'Tiles')} (${int(tiles.length, lang)})`}>
        {tiles.length === 0 ? (
          <span style={CAPTION}>
            {tr(
              'لوحة فارغة. احفظ تحليلًا ثم أضفه كبلاطة.',
              'Tableau vide. Enregistrez une analyse, puis ajoutez-la comme tuile.',
              'An empty board. Save an analysis, then add it as a tile.',
            )}
          </span>
        ) : (
          <div>
            {tiles.map((tile) => (
              <TileRow key={tile.id} tile={tile} shell={shell} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The report's 360
 * ------------------------------------------------------------------ */

interface AnalysisProps {
  readonly analysis: BiAnalysis;
  readonly reportId: string;
  readonly shell: BiShell;
}

/**
 * One saved analysis, with the two verbs that differ.
 *
 * *Open* loads the definition onto the builder's shelves and changes to the analysis tab, so the
 * reader is looking at the question; *Edit* opens the form over its title and its options, so
 * the reader is changing what it is called. Two different intentions, and conflating them is how
 * somebody renames a chart when they meant to run it.
 */
function AnalysisRow({ analysis, reportId, shell }: AnalysisProps) {
  const { t, tr } = useLocale();
  return (
    <div style={ROW}>
      <Stack
        title={analysis.title}
        caption={`${t(CHART_LABEL[analysis.chartType])} · ${analysis.datasetKey}`}
        hint={analysis.key}
        mono
      />
      <span style={{ marginInlineStart: 'auto', flex: 'none', ...WRAP }}>
        {analysis.readableByMe ? null : (
          <Chip text={tr('ممنوع', 'Refusé', 'Denied')} tone="warning" />
        )}
        <IconButton
          icon={ExternalLink}
          label={tr('فتح في المُنشئ', 'Ouvrir dans le constructeur', 'Open in the builder')}
          onClick={() => shell.openAnalysis(analysis, reportId)}
        />
        <IconButton
          icon={Table2}
          label={tr('تحرير', 'Modifier', 'Edit')}
          onClick={() => shell.editAnalysis(analysis, reportId)}
        />
        <IconButton
          icon={Trash2}
          label={tr('حذف', 'Supprimer', 'Delete')}
          tone="danger"
          onClick={() => shell.removeDefinition('analysis', analysis.id, analysis.title)}
        />
      </span>
    </div>
  );
}

/**
 * The selected report and the analyses bound into it.
 *
 * The analyses arrive inline on the row — `BiReport.analyses` is the whole list — so this pane
 * needs no read of its own and reads `shell.selectedRow` directly. That is why it is the only
 * 360 here with no loading state: there is nothing to wait for.
 */
function ReportPane({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const report = shell.visible.reports.find((one) => one.id === shell.selectedId) ?? null;

  if (report === null) {
    return (
      <Nothing
        icon={ScrollText}
        title={tr('لم يُحدَّد تقرير', 'Aucun rapport sélectionné', 'No report selected')}
        hint={tr(
          'اختر تقريرًا لقراءة التحليلات المربوطة به.',
          'Choisissez un rapport pour lire ses analyses.',
          'Pick a report to read the analyses bound into it.',
        )}
      />
    );
  }

  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 7, minWidth: 0 }}>
        <span className="fx-title-ellipsis" style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600 }}>
          {report.title}
        </span>
        <div style={WRAP}>
          <StateChip value={report.status} tones={STATUS_TONE} labels={STATUS_LABEL} />
          <span className="fx-mono" style={CAPTION}>{report.key}</span>
          <span style={CAPTION}>v{report.version}</span>
        </div>
        {report.description === null || report.description === '' ? null : (
          <span style={CAPTION}>{report.description}</span>
        )}
      </div>

      <Section title={tr('التقرير', 'Le rapport', 'The report')}>
        <div>
          <PropertyRow label={tr('التحليلات', 'Analyses', 'Analyses')}>
            <Count value={report.analyses.length} />
          </PropertyRow>
          <PropertyRow label={tr('النشر', 'Publication', 'Published')}>
            {report.publishedAt === null ? <Dash /> : fmt.date(report.publishedAt, lang)}
          </PropertyRow>
          <PropertyRow label={tr('الإيقاف', 'Dépréciation', 'Deprecated')}>
            {report.deprecatedAt === null ? <Dash /> : fmt.date(report.deprecatedAt, lang)}
          </PropertyRow>
        </div>
      </Section>

      <Section title={`${tr('التحليلات', 'Analyses', 'Analyses')} (${int(report.analyses.length, lang)})`}>
        {report.analyses.length === 0 ? (
          <span style={CAPTION}>
            {tr(
              'تقرير بلا تحليلات. أضف واحدًا من المُنشئ.',
              'Un rapport sans analyse. Ajoutez-en une depuis le constructeur.',
              'A report with no analyses. Add one from the builder.',
            )}
          </span>
        ) : (
          <div>
            {report.analyses.map((analysis) => (
              <AnalysisRow
                key={analysis.id}
                analysis={analysis}
                reportId={report.id}
                shell={shell}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The two ledgers' 360
 * ------------------------------------------------------------------ */

/**
 * One logged run, read out.
 *
 * The request is the whole of what was asked — dataset, dimensions, measures, grain, limit — and
 * it is drawn as the log recorded it rather than reconstructed from the dataset's current
 * definition. A metric renamed since the run was made is still the metric key that ran, and a
 * pane that resolved it against today's catalog would be quietly rewriting history.
 */
function QueryPane({ shell, entry }: Desk & { readonly entry: BiQueryEntry }) {
  const { t, tr, lang } = useLocale();
  const request = entry.request;
  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 7, minWidth: 0 }}>
        <span className="fx-title-ellipsis" style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600 }}>
          {entry.visualizationTitle ?? entry.datasetName ?? tr('استعلام حر', 'Requête ad hoc', 'Ad-hoc query')}
        </span>
        <div style={WRAP}>
          <StateChip value={entry.outcome} tones={OUTCOME_TONE} labels={OUTCOME_LABEL} />
          {entry.datasetKey === null ? null : (
            <span className="fx-mono" style={CAPTION}>{entry.datasetKey}</span>
          )}
          {entry.isMine ? <Chip text={tr('لي', 'À moi', 'Mine')} tone="accent" /> : null}
        </div>
      </div>

      {entry.errorMessage === null ? null : (
        <InfoBar
          tone={entry.outcome === 'DENIED' ? 'warning' : 'danger'}
          icon={AlertTriangle}
          title={entry.errorCode ?? tr('رُفض', 'Refusée', 'Refused')}
        >
          {entry.errorMessage}
        </InfoBar>
      )}

      <Section
        title={tr('التشغيل', 'L’exécution', 'The run')}
        action={
          entry.compiledSql === null ? undefined : (
            <Button
              icon={SquareTerminal}
              variant="subtle"
              size="sm"
              onClick={() => shell.showSql(
                entry.visualizationTitle ?? entry.datasetKey ?? tr('استعلام', 'Requête', 'Query'),
                entry.compiledSql,
              )}
            >
              SQL
            </Button>
          )
        }
      >
        <div>
          <PropertyRow label={tr('الوقت', 'Heure', 'When')}>
            {entry.createdAt === null ? <Dash /> : fmt.dateTime(entry.createdAt, lang)}
          </PropertyRow>
          <PropertyRow label={tr('المدة', 'Durée', 'Duration')}>
            <Latency ms={entry.durationMs} />
          </PropertyRow>
          <PropertyRow label={tr('الصفوف', 'Lignes', 'Rows')}>
            <Count value={entry.rowCount} />
          </PropertyRow>
          <PropertyRow label={tr('الأعمدة', 'Colonnes', 'Columns')}>
            <Count value={entry.columnCount} />
          </PropertyRow>
          <PropertyRow label={tr('المنفِّذ', 'Exécutant', 'Ran by')} mono>
            {actorLabel(entry.actorId)}
          </PropertyRow>
          <PropertyRow label={tr('الدور', 'Rôle', 'Role')}>{entry.actorRole ?? <Dash />}</PropertyRow>
        </div>
      </Section>

      <Section title={tr('ما طُلب', 'Ce qui a été demandé', 'What was asked')}>
        <div>
          <PropertyRow label={tr('الأبعاد', 'Dimensions', 'Dimensions')} mono>
            {request.dimensions.length === 0 ? <Dash /> : request.dimensions.join(', ')}
          </PropertyRow>
          <PropertyRow label={tr('المقاييس', 'Mesures', 'Measures')} mono>
            {request.metrics.length === 0 ? <Dash /> : request.metrics.join(', ')}
          </PropertyRow>
          <PropertyRow label={tr('الحبيبة', 'Granularité', 'Grain')}>
            {request.timeGrain === null ? <Dash /> : t(GRAIN_LABEL[request.timeGrain])}
          </PropertyRow>
          <PropertyRow label={tr('الشروط', 'Filtres', 'Filters')} mono>
            {request.filters.length === 0 ? <Dash /> : request.filters.map(filterText).join('  ·  ')}
          </PropertyRow>
          <PropertyRow label={tr('الحد', 'Limite', 'Limit')}>
            <Count value={request.limit} />
          </PropertyRow>
        </div>
      </Section>
    </div>
  );
}

/** One ledger line, read out. Short by nature: an event is a fact, not a record with parts. */
function EventPane({ event }: { readonly event: BiEvent }) {
  const { t, tr, lang } = useLocale();
  const kind = ENTITY_KIND_LABEL[event.entityKind as BiEntityKind];
  return (
    <div style={PANE}>
      <div style={{ display: 'grid', gap: 7, minWidth: 0 }}>
        <OpenChip token={event.eventType} tone={eventTone(event.to, event.eventType)} />
        <div style={WRAP}>
          <Chip text={kind === undefined ? event.entityKind : t(kind)} tone="info" />
          {event.entityId === null ? null : (
            <span className="fx-mono" style={CAPTION}>{actorLabel(event.entityId)}</span>
          )}
        </div>
      </div>
      <Section title={tr('الحدث', 'L’événement', 'The event')}>
        <div>
          <PropertyRow label={tr('الوقت', 'Heure', 'When')}>
            {event.createdAt === null ? <Dash /> : fmt.dateTime(event.createdAt, lang)}
          </PropertyRow>
          <PropertyRow label={tr('الانتقال', 'Transition', 'Transition')}>
            {event.to === null ? (
              <Dash />
            ) : (
              <span style={WRAP}>
                {event.from === null ? null : (
                  <>
                    <Tinted text={t(STATUS_LABEL[event.from])} />
                    <span style={{ color: 'var(--fx-text-disabled)' }}>→</span>
                  </>
                )}
                <StateChip value={event.to} tones={STATUS_TONE} labels={STATUS_LABEL} />
              </span>
            )}
          </PropertyRow>
          <PropertyRow label={tr('الفاعل', 'Auteur', 'By')} mono>
            {actorLabel(event.actorId)}
          </PropertyRow>
          <PropertyRow label={tr('الدور', 'Rôle', 'Role')}>{event.actorRole ?? <Dash />}</PropertyRow>
          <PropertyRow label={tr('الكيان', 'Entité', 'Entity')} mono>
            {event.entityId ?? <Dash />}
          </PropertyRow>
        </div>
      </Section>
      {event.note === null || event.note === '' ? null : (
        <Section title={tr('الملاحظة', 'Note', 'Note')}>
          <span style={{ fontSize: 'var(--fx-caption)', lineHeight: 1.5 }}>{event.note}</span>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The overview's 360
 * ------------------------------------------------------------------ */

/**
 * The registered sources, which are what every dataset in the catalog is ultimately built on.
 *
 * They appear nowhere else in the app: `model.sources` feeds the dataset editor's picker and is
 * otherwise invisible, and yet *which relations may this workspace read at all* is the first
 * question a new analyst asks. Branch scoping is drawn because it changes what a number means —
 * a branch-scoped source answers differently for two readers and neither of them is wrong.
 */
function SourcePane({ shell }: Desk) {
  const { tr, lang } = useLocale();
  const sources = shell.model.sources;
  if (sources.length === 0) {
    return (
      <Nothing
        icon={Database}
        title={tr('لا مصادر', 'Aucune source', 'No sources')}
        hint={tr(
          'سجِّل علاقة ثم زامِن الأعمدة لتبني عليها.',
          'Enregistrez une relation, puis synchronisez ses colonnes.',
          'Register a relation, then sync its columns to build on it.',
        )}
      />
    );
  }
  return (
    <div style={PANE}>
      <Section title={`${tr('المصادر المسجَّلة', 'Sources enregistrées', 'Registered sources')} (${int(sources.length, lang)})`}>
        <div>
          {sources.map((source) => (
            <div key={source.id} style={ROW}>
              <Stack title={source.name} caption={source.relation} hint={source.requiredPermission} mono />
              <span style={{ marginInlineStart: 'auto', flex: 'none', ...WRAP }}>
                {source.branchScoped ? (
                  <Chip
                    text={tr('حسب الفرع', 'Par agence', 'Per branch')}
                    tone="info"
                    title={tr(
                      'تُصفَّى الصفوف حسب فرع القارئ',
                      'Les lignes sont filtrées selon l’agence du lecteur',
                      'Rows are filtered to the reader’s own branch',
                    )}
                  />
                ) : null}
                <Count value={source.columnCount} />
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The pane
 * ------------------------------------------------------------------ */

export interface BiDetailProps {
  readonly shell: BiShell;
}

/**
 * Whatever is worth saying about what is selected on the tab in front of you.
 *
 * A switch with all seven cases and no `default`, so an eighth view fails typecheck here rather
 * than silently rendering an empty rail. The analysis tab hands its 360 to the builder, which is
 * the only pane that writes rather than reads — the shelves are a 360px column by nature and the
 * result they compose belongs in the content area beside them.
 */
export function BiDetail({ shell }: BiDetailProps): ReactElement | null {
  const { tr } = useLocale();

  if (shell.lineage !== null) return <LineagePane shell={shell} />;

  switch (shell.view) {
    case 'overview':
      return <SourcePane shell={shell} />;
    case 'catalog':
      return <DatasetPane shell={shell} />;
    case 'analysis':
      return <BiShelves shell={shell} />;
    case 'dashboards':
      return <DashboardPane shell={shell} />;
    case 'reports':
      return <ReportPane shell={shell} />;
    case 'queries': {
      const entry = shell.visible.queries.find((one) => one.id === shell.selectedId) ?? null;
      if (entry === null) {
        return (
          <Nothing
            icon={SquareTerminal}
            title={tr('لم يُحدَّد تشغيل', 'Aucune exécution', 'No run selected')}
            hint={tr(
              'اختر سطرًا لقراءة ما طُلب وما حدث.',
              'Choisissez une ligne pour lire ce qui a été demandé et ce qui s’est passé.',
              'Pick a line to read what was asked and what happened.',
            )}
          />
        );
      }
      return <QueryPane shell={shell} entry={entry} />;
    }
    case 'events': {
      const event = shell.visible.events.find((one) => one.id === shell.selectedId) ?? null;
      if (event === null) {
        return (
          <Nothing
            icon={ScrollText}
            title={tr('لم يُحدَّد حدث', 'Aucun événement', 'No event selected')}
            hint={tr(
              'اختر سطرًا لقراءة الانتقال وملاحظته.',
              'Choisissez une ligne pour lire la transition et sa note.',
              'Pick a line to read the transition and its note.',
            )}
          />
        );
      }
      return <EventPane event={event} />;
    }
  }
}
