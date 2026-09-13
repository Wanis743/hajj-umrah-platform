/**
 * Seven tabs, seven rectangles.
 *
 * `biCsv` writes the tab a person is looking at to a file and `biClipboard` writes the same
 * rectangle to the clipboard as tab-separated columns, so the file and the paste can never
 * disagree about what the query log's columns are. One set of column lists, two consumers —
 * the split `../dms/export.ts` and `../crm/export.ts` both make, for the same reason.
 *
 * Cells are raw, in the sense `../shared/csv.ts` means it: `DEPRECATED` rather than
 * `Obsolète`, `2026-09-12T08:14:02Z` rather than `12 sept. 2026`, `0.84` rather than `84 %`.
 * A CSV is opened by a spreadsheet, and a file that arrives pre-formatted cannot be
 * un-formatted. Headers are the exception — they are read by a person and never parsed, so
 * they are translated.
 *
 * This module imports `./types` and nothing else of the app. It does not import `./model`,
 * and that is the one structural difference from Documents worth explaining. Documents hands
 * its table builder the whole model, because its model publishes the filtered lists its grids
 * render — `visible`, `visibleQueue`, `visibleExpiry`. This app's model publishes raw feeds
 * and leaves the search box to the shell, so there is no filtered list on the model to read.
 * Worse, one of the seven tabs is not on the model at all: the analysis grid holds a live
 * `BiQueryResult` that came back from a command, not from a dataset read. So the shell hands
 * over {@link BiExportScope} — the seven things it is actually showing — and this file stays
 * a pure function of what is on screen rather than of what was fetched.
 *
 * Three columns are long enough to be worth a word. `compiledSql` goes out whole and last,
 * because an errored query log line without its SQL is a complaint rather than a bug report,
 * and a person scanning the narrow columns should not have to scroll past a `SELECT` to reach
 * `outcome`. A filter list goes out as `field OP value`, pipe-separated inside brackets for
 * `IN`, which is compact and needs no CSV quoting. And an event's `payload` goes out as JSON,
 * which is the one cell here that is not flat: `bi_events.event_type` carries no CHECK, so an
 * event this app has never heard of arrives with its only description inside that object, and
 * an audit ledger that exports everything except the part it did not recognize is the wrong
 * trade for a tidy rectangle.
 *
 * What is *not* here: the analysis tab's truncation. A result clamped at five hundred rows
 * exports five hundred rows, and the sentence saying so belongs in the toast the export
 * command raises, not in a footer row that would break the rectangle for every reader who
 * only wanted the numbers.
 */
import { csvDocument } from '../shared/csv';
import {
  BI_OPERATOR_ARITY,
  type BiCounts,
  type BiDashboard,
  type BiDataset,
  type BiEvent,
  type BiFilter,
  type BiHealth,
  type BiOverview,
  type BiPowers,
  type BiQueryEntry,
  type BiQueryResult,
  type BiReport,
  type BiScalar,
  type BiTopDataset,
  type BiUsage,
  type BiView,
  type SourceRow,
} from './types';

/** The runtime's positional translator, narrowed to what a pure module needs. */
export type Translate = (ar: string, fr: string, en: string) => string;

/** A header row and the rows beneath it, all cells already strings. */
interface BiTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * What the shell is showing, tab by tab.
 *
 * Every member is the narrowed list the grid renders, not the feed behind it: exporting the
 * catalog while a search box holds `booking` should write the datasets whose names match,
 * because that is what "export what is on screen" means. The two nullable members are the two
 * tabs that can legitimately have no answer yet — an overview still loading, and an analysis
 * nobody has run.
 */
export interface BiExportScope {
  readonly overview: BiOverview | null;
  readonly datasets: readonly BiDataset[];
  readonly result: BiQueryResult | null;
  readonly dashboards: readonly BiDashboard[];
  readonly reports: readonly BiReport[];
  readonly queries: readonly BiQueryEntry[];
  readonly events: readonly BiEvent[];
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

/** A nullable stamp, date or id column, verbatim from the database. */
const at = (value: string | null): string => value ?? '';

const int = (value: number): string => String(value);

/**
 * A count the server may have no answer for. Blank rather than `0`, because `0` is a
 * measurement and a blank is the absence of one — a query log nobody may read is not a log
 * of no queries.
 */
const count = (value: number | null): string => (value === null ? '' : String(value));

/**
 * `TRUE` / `FALSE`, the one boolean spelling a spreadsheet reads back as a boolean rather
 * than as text.
 */
const flag = (value: boolean): string => (value ? 'TRUE' : 'FALSE');

/** A nullable boolean: blank where the log recorded no answer. */
const flagOrBlank = (value: boolean | null): string => (value === null ? '' : flag(value));

/** A list column, joined the way the shelves both show it and read it back. */
const list = (values: readonly string[]): string => values.join(', ');

/**
 * One cell of a result set, or one operand of a filter.
 *
 * Numbers go out at the precision the database sent, not at the metric's `decimals` — a
 * column formatted to two places on screen is a rounding for a reader, and rounding into the
 * file would make the spreadsheet's own total disagree with the server's.
 */
const scalar = (value: BiScalar | undefined): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return flag(value);
  return String(value);
};

/**
 * A filter as the compiler parses it, in one cell.
 *
 * The arity table decides which operand members to read, which is the same table the builder
 * uses to decide how many boxes to draw — so a filter that reads back oddly here is a filter
 * that was logged oddly, not one that was exported oddly. Pipes inside the brackets rather
 * than commas: an `IN` list of five values would otherwise quote the whole cell.
 */
const filterText = (filter: BiFilter): string => {
  const head = `${filter.field} ${filter.op}`;
  switch (BI_OPERATOR_ARITY[filter.op]) {
    case 'none': return head;
    case 'many': return `${head} [${(filter.values ?? []).map(scalar).join('|')}]`;
    case 'two': return `${head} ${scalar(filter.value)}..${scalar(filter.value2)}`;
    case 'one': return `${head} ${scalar(filter.value)}`;
  }
};

const filters = (values: readonly BiFilter[]): string => values.map(filterText).join(' AND ');

/**
 * A jsonb column, compact. An empty object exports as a blank rather than as `{}`, because a
 * literal `{}` in a spreadsheet cell reads as content and this is the absence of it.
 */
const json = (row: SourceRow): string =>
  Object.keys(row).length === 0 ? '' : JSON.stringify(row);

/* ------------------------------------------------------------------ *
 * The overview, long
 * ------------------------------------------------------------------ */

/** Section, item, measure, value — the shape every overview row takes. */
type Long = readonly [string, string, string, string];

/**
 * Twelve totals for the semantic layer, as the landing tab counts them.
 *
 * Published counts travel beside their totals rather than as a percentage, for the reason the
 * whole file exists: a ratio computed here is a ratio nobody can recompute, and a spreadsheet
 * given both numbers can divide them itself.
 */
function countsRows(counts: BiCounts, tr: Translate): readonly Long[] {
  const section = tr('الإجماليات', 'Totaux', 'Totals');
  const items = tr('العدد', 'Nombre', 'Count');
  const pairs: readonly (readonly [string, number])[] = [
    [tr('المصادر', 'Sources', 'Sources'), counts.sources],
    [tr('مجموعات البيانات', 'Jeux de données', 'Datasets'), counts.datasets],
    [tr('منشورة', 'Publiés', 'Published datasets'), counts.publishedDatasets],
    [tr('مسودة', 'Brouillons', 'Draft datasets'), counts.draftDatasets],
    [tr('مهملة', 'Obsolètes', 'Deprecated datasets'), counts.deprecatedDatasets],
    [tr('الأبعاد', 'Dimensions', 'Dimensions'), counts.dimensions],
    [tr('المؤشرات', 'Indicateurs', 'Metrics'), counts.metrics],
    [tr('مؤشرات منشورة', 'Indicateurs publiés', 'Published metrics'), counts.publishedMetrics],
    [tr('التقارير', 'Rapports', 'Reports'), counts.reports],
    [tr('التحليلات', 'Analyses', 'Analyses'), counts.visualizations],
    [tr('لوحات المعلومات', 'Tableaux de bord', 'Dashboards'), counts.dashboards],
    [tr('لوحات منشورة', 'Tableaux publiés', 'Published dashboards'), counts.publishedDashboards],
  ];
  return pairs.map(([item, value]) => [section, item, items, int(value)] as const);
}

/** The six ways the layer can be quietly wrong, each a count of things that should not be. */
function healthRows(health: BiHealth, tr: Translate): readonly Long[] {
  const section = tr('السلامة', 'Intégrité', 'Health');
  const items = tr('العدد', 'Nombre', 'Count');
  const pairs: readonly (readonly [string, number])[] = [
    [tr('بلا مصدر', 'Sans source', 'Datasets without a source'), health.datasetsWithoutSource],
    [tr('بلا مؤشر', 'Sans indicateur', 'Datasets without a metric'), health.datasetsWithoutMetric],
    [tr('لم تُستعلم', 'Jamais interrogés', 'Datasets never queried'), health.datasetsNeverQueried],
    [tr('راكدة 30 يومًا', 'Inactifs 30 j', 'Datasets stale 30d'), health.datasetsStale30d],
    [tr('تحليلات معلّقة', 'Analyses orphelines', 'Orphan analyses'), health.orphanVisualizations],
    [
      tr('منشور على مهمل', 'Publié sur obsolète', 'Published on deprecated'),
      health.publishedOnDeprecated,
    ],
  ];
  return pairs.map(([item, value]) => [section, item, items, int(value)] as const);
}

/**
 * Seven days of the query log, or the fact that this caller may not see it.
 *
 * The invisible case exports one row carrying `NOT_VISIBLE`, not six rows of zeros and not six
 * blanks. Zeros would claim there were no denials; blanks would claim nobody measured. The
 * discriminated union exists to keep those three apart, and the file it writes has to keep
 * them apart too or the type was decoration.
 */
function usageRows(usage: BiUsage, tr: Translate): readonly Long[] {
  const section = tr('الاستخدام (7 أيام)', 'Utilisation (7 j)', 'Usage (7d)');
  if (!usage.visible) {
    const log = tr('سجل الاستعلامات', 'Journal des requêtes', 'Query log');
    const access = tr('الوصول', 'Accès', 'Access');
    return [[section, log, access, 'NOT_VISIBLE']];
  }
  const queries = tr('استعلامات', 'Requêtes', 'Queries');
  const ms = tr('ميلي ثانية', 'Millisecondes', 'Milliseconds');
  return [
    [section, tr('المجموع', 'Total', 'Total'), queries, int(usage.queries7d)],
    [section, tr('مرفوضة', 'Refusées', 'Denied'), queries, int(usage.denied7d)],
    [section, tr('أخطاء', 'Erreurs', 'Errors'), queries, int(usage.errors7d)],
    [section, tr('مبتورة', 'Tronquées', 'Truncated'), queries, int(usage.truncated7d)],
    [section, tr('المئين 95', 'p95', 'p95 duration'), ms, int(usage.p95DurationMs)],
    [section, tr('الأبطأ', 'La plus lente', 'Slowest'), ms, int(usage.slowestMs)],
  ];
}

/** The datasets people actually use: three rows each, because three facts per dataset. */
function topDatasetRows(top: readonly BiTopDataset[], tr: Translate): readonly Long[] {
  const section = tr('الأكثر استخدامًا', 'Les plus utilisés', 'Top datasets');
  const rows: Long[] = [];
  top.forEach((dataset) => {
    const item = dataset.datasetKey;
    rows.push([section, item, tr('استعلامات', 'Requêtes', 'Queries'), int(dataset.queryCount)]);
    rows.push([section, item, tr('الحالة', 'État', 'Status'), dataset.status]);
    rows.push([
      section, item,
      tr('آخر استعلام', 'Dernière requête', 'Last queried'),
      at(dataset.lastQueriedAt),
    ]);
  });
  return rows;
}

/**
 * What this caller may do, as the server answered it.
 *
 * In the file because of what the file is for: the question somebody exports an overview to
 * answer is often "why can this account not publish that metric", and the seven booleans are
 * the answer. They come off the same read as the counts, so they cost nothing to carry.
 */
function powerRows(powers: BiPowers, tr: Translate): readonly Long[] {
  const section = tr('الصلاحيات', 'Droits', 'Powers');
  const granted = tr('ممنوح', 'Accordé', 'Granted');
  const pairs: readonly (readonly [string, boolean])[] = [
    [tr('تعريف', 'Définir', 'Define'), powers.canDefine],
    [tr('نشر التعريفات', 'Publier les définitions', 'Publish definitions'), powers.canPublishDefinitions],
    [tr('حفظ التحليل', "Enregistrer l'analyse", 'Save analysis'), powers.canSaveAnalysis],
    [tr('بناء اللوحات', 'Créer des tableaux', 'Build dashboards'), powers.canBuildDashboards],
    [tr('نشر اللوحات', 'Publier les tableaux', 'Publish dashboards'), powers.canPublishDashboards],
    [tr('قراءة السجل', 'Lire le journal', 'Read query log'), powers.canReadQueryLog],
    [tr('مزامنة المصادر', 'Synchroniser les sources', 'Sync sources'), powers.canSyncSources],
  ];
  return pairs.map(([item, value]) => [section, item, granted, flag(value)] as const);
}

/**
 * Four columns — section, item, measure, value — and one row per number on the tab.
 *
 * The other six tabs are grids and export as themselves. The overview is five panels whose
 * grains disagree: twelve totals, six health counts, six usage numbers or a stated absence of
 * them, three facts per top dataset and seven booleans. Widened into a single rectangle they
 * would be mostly empty cells; in long form every number the screen shows survives the trip,
 * and a pivot table puts any one of the five panels back together.
 *
 * `generatedAt` leads, as its own section. A report of totals with no as-of stamp is a report
 * that becomes wrong without ever changing, and this is the only tab whose numbers are all
 * measured at one instant by one read.
 *
 * An overview that has not answered yet exports its header and no rows — the same thing the
 * grids do when a search box matches nothing. Refusing to write the file would turn an empty
 * tab into a failure rather than an empty tab.
 */
function overviewTable(report: BiOverview | null, tr: Translate): BiTable {
  const header = [
    tr('القسم', 'Section', 'Section'),
    tr('البند', 'Poste', 'Item'),
    tr('القياس', 'Mesure', 'Measure'),
    tr('القيمة', 'Valeur', 'Value'),
  ];
  if (report === null) return { header, rows: [] };
  const stamp: Long = [
    tr('التقرير', 'Rapport', 'Report'),
    '',
    tr('وقت التوليد', 'Généré le', 'Generated at'),
    at(report.generatedAt),
  ];
  return {
    header,
    rows: [
      stamp,
      ...countsRows(report.counts, tr),
      ...healthRows(report.health, tr),
      ...usageRows(report.usage, tr),
      ...topDatasetRows(report.topDatasets, tr),
      ...powerRows(report.powers, tr),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * The catalog
 * ------------------------------------------------------------------ */

/**
 * The datasets, narrowed by whatever is in the search box.
 *
 * Datasets and not sources: the rail lists sources to filter by, but a source has no row on
 * this grid and exporting both grains into one rectangle would produce a file whose every
 * other row was half blank. `sourceKey` carries the association instead.
 *
 * `readableByMe` is the column somebody triaging this file is looking for — a published
 * dataset this caller cannot read is not a broken definition, it is a permission, and the two
 * get confused in every bug report that does not have this column in it.
 */
function catalogTable(rows: readonly BiDataset[], tr: Translate): BiTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('المفتاح', 'Clé', 'Key'),
      tr('الاسم', 'Nom', 'Name'),
      tr('الاسم بالعربية', 'Nom (ar)', 'Name (ar)'),
      tr('الحالة', 'État', 'Status'),
      tr('الإصدار', 'Version', 'Version'),
      tr('مفتاح المصدر', 'Clé de la source', 'Source key'),
      tr('المصدر', 'Source', 'Source'),
      tr('الصلاحية المطلوبة', 'Permission requise', 'Required permission'),
      tr('مقروء لي', 'Lisible par moi', 'Readable by me'),
      tr('عمود الزمن', 'Colonne temporelle', 'Time column'),
      tr('الأبعاد', 'Dimensions', 'Dimensions'),
      tr('المؤشرات', 'Indicateurs', 'Metrics'),
      tr('مؤشرات منشورة', 'Indicateurs publiés', 'Published metrics'),
      tr('عدد الاستعلامات', 'Nombre de requêtes', 'Query count'),
      tr('آخر استعلام', 'Dernière requête', 'Last queried'),
      tr('تاريخ النشر', 'Publié le', 'Published at'),
      tr('آخر تحديث', 'Mis à jour le', 'Updated at'),
      tr('الوصف', 'Description', 'Description'),
    ],
    rows: rows.map((dataset) => [
      dataset.id,
      dataset.key,
      dataset.name,
      at(dataset.nameAr),
      dataset.status,
      int(dataset.version),
      at(dataset.sourceKey),
      at(dataset.sourceName),
      at(dataset.requiredPermission),
      flag(dataset.readableByMe),
      at(dataset.timeColumn),
      int(dataset.dimensionCount),
      int(dataset.metricCount),
      int(dataset.publishedMetricCount),
      int(dataset.queryCount),
      at(dataset.lastQueriedAt),
      at(dataset.publishedAt),
      at(dataset.updatedAt),
      at(dataset.description),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The analysis
 * ------------------------------------------------------------------ */

/**
 * The result set, exactly as it came back.
 *
 * The only table here whose columns this file does not choose. A header is the compiler's own
 * `label` — the metric's name as whoever defined it wrote it — and a cell is read by `alias`,
 * which is the generated `d0` / `m1` and the only key a row actually has. Columns go out in
 * the order the result carries them, which is the order the grid paints, because a file whose
 * columns are sorted differently from the screen is a second opinion nobody asked for.
 *
 * Formatting is deliberately not applied: a `CURRENCY` metric exports `1250.4` and not
 * `1 250,40 DA`, and a `PERCENT` exports `0.84` and not `84 %`. The format lives on the
 * column for the grid's sake, and the grid is not what is being written here.
 */
function analysisTable(result: BiQueryResult | null, tr: Translate): BiTable {
  if (result === null) {
    return { header: [tr('لا نتيجة', 'Aucun résultat', 'No result')], rows: [] };
  }
  return {
    header: result.columns.map((column) => column.label),
    rows: result.rows.map((row) => result.columns.map((column) => scalar(row[column.alias]))),
  };
}

/* ------------------------------------------------------------------ *
 * The dashboards
 * ------------------------------------------------------------------ */

/**
 * One row per dashboard, at the grain the grid shows.
 *
 * `tileCount` and not the tiles: `get_bi_dashboards` sends a count and no tile data, because
 * every tile on a dashboard is separately authorized and separately logged. A tile-grained
 * export would have to run the dashboard to write itself.
 *
 * `fullyReadableByMe` is the honest name for what it is — false when at least one tile stands
 * on something this caller may not read, which is a dashboard that will render with a hole in
 * it rather than one that will fail.
 */
function dashboardTable(rows: readonly BiDashboard[], tr: Translate): BiTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('المفتاح', 'Clé', 'Key'),
      tr('العنوان', 'Titre', 'Title'),
      tr('العنوان بالعربية', 'Titre (ar)', 'Title (ar)'),
      tr('الحالة', 'État', 'Status'),
      tr('الإصدار', 'Version', 'Version'),
      tr('افتراضي', 'Par défaut', 'Default'),
      tr('الترتيب', 'Ordre', 'Sort order'),
      tr('البلاطات', 'Tuiles', 'Tiles'),
      tr('مقروء بالكامل لي', 'Entièrement lisible', 'Fully readable by me'),
      tr('تاريخ النشر', 'Publié le', 'Published at'),
      tr('تاريخ الإهمال', 'Obsolète le', 'Deprecated at'),
      tr('آخر تحديث', 'Mis à jour le', 'Updated at'),
      tr('الوصف', 'Description', 'Description'),
    ],
    rows: rows.map((dashboard) => [
      dashboard.id,
      dashboard.key,
      dashboard.title,
      at(dashboard.titleAr),
      dashboard.status,
      int(dashboard.version),
      flag(dashboard.isDefault),
      int(dashboard.sortOrder),
      int(dashboard.tileCount),
      flag(dashboard.fullyReadableByMe),
      at(dashboard.publishedAt),
      at(dashboard.deprecatedAt),
      at(dashboard.updatedAt),
      at(dashboard.description),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The reports
 * ------------------------------------------------------------------ */

/**
 * One row per report, with its analyses named rather than expanded.
 *
 * A report arrives with its analyses nested, and each of those is a whole definition — chart
 * type, shelves, filters, a row limit. Flattening to one row per analysis would give every
 * report's title a dozen repetitions and still not be the grid. So the grain stays the report
 * and two columns carry the composition: how many analyses, and which ones by key. Somebody
 * who needs an analysis in full opens it in the builder, where it is editable rather than
 * merely legible.
 *
 * `layout` is not a column. It is tile geometry — a twelve-column grid's worth of `x`, `y`,
 * `w`, `h` — and it describes where a thing is drawn, not what it says.
 */
function reportTable(rows: readonly BiReport[], tr: Translate): BiTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('المفتاح', 'Clé', 'Key'),
      tr('العنوان', 'Titre', 'Title'),
      tr('العنوان بالعربية', 'Titre (ar)', 'Title (ar)'),
      tr('الحالة', 'État', 'Status'),
      tr('الإصدار', 'Version', 'Version'),
      tr('الترتيب', 'Ordre', 'Sort order'),
      tr('عدد التحليلات', "Nombre d'analyses", 'Analyses'),
      tr('مفاتيح التحليلات', 'Clés des analyses', 'Analysis keys'),
      tr('تاريخ النشر', 'Publié le', 'Published at'),
      tr('تاريخ الإهمال', 'Obsolète le', 'Deprecated at'),
      tr('آخر تحديث', 'Mis à jour le', 'Updated at'),
      tr('الوصف', 'Description', 'Description'),
    ],
    rows: rows.map((report) => [
      report.id,
      report.key,
      report.title,
      at(report.titleAr),
      report.status,
      int(report.version),
      int(report.sortOrder),
      int(report.analyses.length),
      list(report.analyses.map((analysis) => analysis.key)),
      at(report.publishedAt),
      at(report.deprecatedAt),
      at(report.updatedAt),
      at(report.description),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The query log
 * ------------------------------------------------------------------ */

/**
 * Every run, including the refused ones — which is the point of the tab and the point of the
 * file. A semantic layer with no record of its refusals cannot be audited, and one whose
 * record cannot leave the screen cannot be audited by anybody who does not have the screen.
 *
 * The dataset goes out twice, resolved and requested, and the pair is not redundant. The log
 * row's own `dataset_id` is a foreign key the handler leaves null when the requested dataset
 * does not exist, while the request jsonb keeps whatever uuid was actually sent. A blank
 * resolved column beside a filled requested one is the signature of a query against a dataset
 * that was deleted or never existed — the single most informative line in the whole log, and
 * invisible if only one of the two columns is written. The visualization pair says the same
 * thing about a saved analysis.
 *
 * `limit` is what the caller sent, which may be outside 1..5000: the clamp happens after the
 * log line is written. Anybody reconciling this column against `rowCount` has to re-apply the
 * clamp, and exporting the clamped value instead would erase the evidence that a client asked
 * for a million rows.
 */
function queryTable(rows: readonly BiQueryEntry[], tr: Translate): BiTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('التاريخ', 'Date', 'Timestamp'),
      tr('النتيجة', 'Résultat', 'Outcome'),
      tr('مجموعة البيانات', 'Jeu de données', 'Dataset (resolved)'),
      tr('مفتاح المجموعة', 'Clé du jeu', 'Dataset key'),
      tr('اسم المجموعة', 'Nom du jeu', 'Dataset name'),
      tr('المجموعة المطلوبة', 'Jeu demandé', 'Dataset (requested)'),
      tr('التحليل', 'Analyse', 'Analysis (resolved)'),
      tr('عنوان التحليل', "Titre de l'analyse", 'Analysis title'),
      tr('التحليل المطلوب', 'Analyse demandée', 'Analysis (requested)'),
      tr('الفاعل', 'Acteur', 'Actor'),
      tr('دور الفاعل', 'Rôle', 'Actor role'),
      tr('لي', 'À moi', 'Mine'),
      tr('الأبعاد', 'Dimensions', 'Dimensions'),
      tr('المؤشرات', 'Indicateurs', 'Metrics'),
      tr('المرشّحات', 'Filtres', 'Filters'),
      tr('التحبيب الزمني', 'Granularité', 'Time grain'),
      tr('الترتيب حسب', 'Trié par', 'Order by'),
      tr('تنازلي', 'Décroissant', 'Order desc'),
      tr('الحد المطلوب', 'Limite demandée', 'Limit requested'),
      tr('الأعمدة', 'Colonnes', 'Columns'),
      tr('الصفوف', 'Lignes', 'Rows'),
      tr('المدة (مي.ث)', 'Durée (ms)', 'Duration (ms)'),
      tr('رمز الخطأ', "Code d'erreur", 'Error code'),
      tr('رسالة الخطأ', "Message d'erreur", 'Error message'),
      tr('SQL المُصرّف', 'SQL compilé', 'Compiled SQL'),
    ],
    rows: rows.map((entry) => [
      entry.id,
      at(entry.createdAt),
      entry.outcome,
      at(entry.datasetId),
      at(entry.datasetKey),
      at(entry.datasetName),
      at(entry.request.datasetId),
      at(entry.visualizationId),
      at(entry.visualizationTitle),
      at(entry.request.visualizationId),
      at(entry.actorId),
      at(entry.actorRole),
      flag(entry.isMine),
      list(entry.request.dimensions),
      list(entry.request.metrics),
      filters(entry.request.filters),
      at(entry.request.timeGrain),
      at(entry.request.orderBy),
      flagOrBlank(entry.request.orderDesc),
      count(entry.request.limit),
      count(entry.columnCount),
      count(entry.rowCount),
      count(entry.durationMs),
      at(entry.errorCode),
      at(entry.errorMessage),
      at(entry.compiledSql),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The event ledger
 * ------------------------------------------------------------------ */

/**
 * Who published what, and what it broke.
 *
 * No key column, for the reason the type gives: `get_bi_events` returns an id and a kind and
 * nothing that names the entity, so a line reads `DATASET · 8f2c1a44` and a reader who wants
 * the name opens the row. A column of empty strings would be worse than the uuid.
 *
 * `from`, `to` and `note` are lifted out of the payload by the mapper and exported as their
 * own columns because they are the three things nearly every event carries. `payload` follows
 * anyway, whole, because `event_type` has no CHECK constraint: the ledger can hold an event
 * kind this app has never heard of, and for that row the object is the only description that
 * exists. It goes last, so the twelve legible columns come first.
 */
function eventTable(rows: readonly BiEvent[], tr: Translate): BiTable {
  return {
    header: [
      tr('المعرّف', 'Identifiant', 'ID'),
      tr('التاريخ', 'Date', 'Timestamp'),
      tr('نوع الكيان', "Type d'entité", 'Entity kind'),
      tr('معرّف الكيان', "Identifiant d'entité", 'Entity ID'),
      tr('نوع الحدث', "Type d'événement", 'Event type'),
      tr('من', 'De', 'From'),
      tr('إلى', 'À', 'To'),
      tr('الفاعل', 'Acteur', 'Actor'),
      tr('دور الفاعل', 'Rôle', 'Actor role'),
      tr('ملاحظة', 'Note', 'Note'),
      tr('الحمولة', 'Charge utile', 'Payload'),
    ],
    rows: rows.map((event) => [
      event.id,
      at(event.createdAt),
      event.entityKind,
      at(event.entityId),
      event.eventType,
      at(event.from),
      at(event.to),
      at(event.actorId),
      at(event.actorRole),
      at(event.note),
      json(event.payload),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * The two consumers
 * ------------------------------------------------------------------ */

/** Exhaustive over {@link BiView}: a new tab is a compile error here, not a blank file. */
function biTable(view: BiView, scope: BiExportScope, tr: Translate): BiTable {
  switch (view) {
    case 'overview':   return overviewTable(scope.overview, tr);
    case 'catalog':    return catalogTable(scope.datasets, tr);
    case 'analysis':   return analysisTable(scope.result, tr);
    case 'dashboards': return dashboardTable(scope.dashboards, tr);
    case 'reports':    return reportTable(scope.reports, tr);
    case 'queries':    return queryTable(scope.queries, tr);
    case 'events':     return eventTable(scope.events, tr);
  }
}

/** The file. CRLF, the comma and the doubled quote are `csvDocument`'s business. */
export const biCsv = (view: BiView, scope: BiExportScope, tr: Translate): string => {
  const table = biTable(view, scope, tr);
  return csvDocument(table.header, table.rows);
};

/**
 * The same rectangle, tab-separated, for a paste into a sheet that is already open.
 *
 * No quoting: a cell holding a tab or a newline would break the paste, so those are replaced
 * by spaces rather than escaped — the clipboard has no CSV-style escape a spreadsheet honours
 * on paste. Which matters more here than in Documents: this app's widest columns are a
 * compiled `SELECT` and a jsonb payload, and both arrive with newlines in them.
 */
export const biClipboard = (view: BiView, scope: BiExportScope, tr: Translate): string => {
  const table = biTable(view, scope, tr);
  const flat = (cell: string): string => cell.replace(/[\t\r\n]+/g, ' ');
  const line = (cells: readonly string[]): string => cells.map(flat).join('\t');
  return [line(table.header), ...table.rows.map(line)].join('\n');
};
