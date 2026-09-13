/**
 * Every union in the migration, translated once.
 *
 * Exhaustive `Record`s over the unions in `./types`, so a value added to a CHECK
 * constraint and not added here fails typecheck instead of rendering a raw SQL
 * token to an analyst. `./tones` gives the same guarantee for colour and the two
 * files are deliberately parallel: if one carries a key the other lacks, the
 * compiler says so.
 *
 * Plain data rather than the hooks the admin shell used. `biFormat.ts` built these
 * tables inside `useBiLabels()` and `useBiChartLabels()`, which meant six `Record`s
 * and a thirty-three-entry one were reallocated on every render of every screen,
 * and none of them could be read outside a component — a chart picker sorting its
 * options by name had to be a component to do it. Here the words are `Localized`
 * triples and the choosing happens at the call site through the runtime's `t`,
 * which is what every other app in the OS does.
 *
 * Two vocabularies are deliberately absent. {@link BiDataType} is not translated
 * because `text` and `timestamp` name Postgres types and the legacy screens were
 * right to print them raw — a reader comparing a column to the source catalog
 * needs the word the catalog uses. {@link BiFilterOperator} is not translated for
 * the reason `OPERATOR_SQL` in `./format` states: a filter is read beside the
 * statement it compiled to.
 */
import type { Localized } from '@/platform/sdk';
import type {
  BiAggregate,
  BiChartType,
  BiDrillKind,
  BiEntityKind,
  BiGovernedKind,
  BiMetricFormat,
  BiQueryOutcome,
  BiStatus,
  BiTimeGrain,
  BiView,
} from './types';

/** Argument order is Arabic, French, English — the same order as `text()` in a
 *  manifest, and the same helper name `src/apps/dms/labels.ts` uses. */
const w = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

/* ------------------------------------------------------------------ *
 * The app's own furniture
 * ------------------------------------------------------------------ */

/**
 * The seven tabs.
 *
 * Shorter than the jump list's wording on purpose: the manifest says
 * "Analysis builder" because somebody arriving from Start needs to know what they
 * are opening, and a nav rail 220 pixels wide beside an open window does not.
 */
export const VIEW_LABEL: Readonly<Record<BiView, Localized>> = {
  overview: w('نظرة عامة', "Vue d'ensemble", 'Overview'),
  catalog: w('الفهرس', 'Catalogue', 'Catalog'),
  analysis: w('التحليل', 'Analyse', 'Analysis'),
  dashboards: w('لوحات المعلومات', 'Tableaux de bord', 'Dashboards'),
  reports: w('التقارير', 'Rapports', 'Reports'),
  queries: w('الاستعلامات', 'Requêtes', 'Queries'),
  events: w('الأحداث', 'Événements', 'Events'),
};

/* ------------------------------------------------------------------ *
 * Governance
 * ------------------------------------------------------------------ */

/** A definition's standing. `./tones` colours the same three keys. */
export const STATUS_LABEL: Readonly<Record<BiStatus, Localized>> = {
  DRAFT: w('مسودة', 'Brouillon', 'Draft'),
  PUBLISHED: w('منشور', 'Publié', 'Published'),
  DEPRECATED: w('مُهمل', 'Déprécié', 'Deprecated'),
};

/**
 * The four things that carry a status of their own.
 *
 * Singular, because these name one row at a time — a confirmation asking to
 * publish "the dataset" reads better than one naming a plural it is not acting on.
 */
export const GOVERNED_KIND_LABEL: Readonly<Record<BiGovernedKind, Localized>> = {
  DATASET: w('مجموعة بيانات', 'Jeu de données', 'Dataset'),
  METRIC: w('مؤشر', 'Indicateur', 'Metric'),
  REPORT: w('تقرير', 'Rapport', 'Report'),
  DASHBOARD: w('لوحة معلومات', 'Tableau de bord', 'Dashboard'),
};

/**
 * Everything the governance ledger can be about.
 *
 * Wider than {@link GOVERNED_KIND_LABEL} by three, and the extra three are why
 * `bi_events.entity_kind` is its own union: a dimension and a visualization take
 * their standing from the parent they belong to, and a source is not a definition
 * at all — it is the table underneath one. All three still generate history.
 */
export const ENTITY_KIND_LABEL: Readonly<Record<BiEntityKind, Localized>> = {
  DATASET: GOVERNED_KIND_LABEL.DATASET,
  DIMENSION: w('بُعد', 'Dimension', 'Dimension'),
  METRIC: GOVERNED_KIND_LABEL.METRIC,
  REPORT: GOVERNED_KIND_LABEL.REPORT,
  VISUALIZATION: w('تمثيل مرئي', 'Visualisation', 'Visualization'),
  DASHBOARD: GOVERNED_KIND_LABEL.DASHBOARD,
  SOURCE: w('مصدر', 'Source', 'Source'),
};

/** How a logged query ended. Amber on `DENIED` rather than red, for the reason
 *  `OUTCOME_TONE` in `./tones` gives. */
export const OUTCOME_LABEL: Readonly<Record<BiQueryOutcome, Localized>> = {
  OK: w('نجح', 'Réussi', 'OK'),
  DENIED: w('مرفوض', 'Refusé', 'Denied'),
  ERROR: w('خطأ', 'Erreur', 'Error'),
};

/* ------------------------------------------------------------------ *
 * The semantic layer's own words
 * ------------------------------------------------------------------ */

/**
 * How a metric folds its column.
 *
 * `RATIO` is the odd one and keeps the bare word: it is not an aggregate Postgres
 * has, it is the compiler's `sum(n) / nullif(sum(d), 0)`, and a metric declaring
 * it carries two expressions instead of one. Calling it "Average" — the closest
 * everyday word — would hide that it is a quotient of two sums and not a mean.
 */
export const AGGREGATE_LABEL: Readonly<Record<BiAggregate, Localized>> = {
  SUM: w('مجموع', 'Somme', 'Sum'),
  COUNT: w('عدد', 'Nombre', 'Count'),
  COUNT_DISTINCT: w('عدد مميّز', 'Nombre distinct', 'Distinct count'),
  AVG: w('متوسط', 'Moyenne', 'Average'),
  MIN: w('أدنى', 'Minimum', 'Minimum'),
  MAX: w('أقصى', 'Maximum', 'Maximum'),
  RATIO: w('نسبة', 'Ratio', 'Ratio'),
};

/** The bucket a time axis is truncated to. `periodLabel` in `./format` prints the
 *  buckets themselves; these name the choice. */
export const GRAIN_LABEL: Readonly<Record<BiTimeGrain, Localized>> = {
  DAY: w('يوم', 'Jour', 'Day'),
  WEEK: w('أسبوع', 'Semaine', 'Week'),
  MONTH: w('شهر', 'Mois', 'Month'),
  QUARTER: w('ربع', 'Trimestre', 'Quarter'),
  YEAR: w('سنة', 'Année', 'Year'),
};

/**
 * How a metric prints.
 *
 * `DURATION_HOURS` says its unit out loud because that is the one format whose
 * input is not self-evident: the column holds a count of hours and the screen
 * shows `2h 15min`, so an author picking it needs to know which end they are
 * declaring.
 */
export const METRIC_FORMAT_LABEL: Readonly<Record<BiMetricFormat, Localized>> = {
  NUMBER: w('رقم', 'Nombre', 'Number'),
  INTEGER: w('عدد صحيح', 'Entier', 'Integer'),
  CURRENCY: w('عملة', 'Monnaie', 'Currency'),
  PERCENT: w('نسبة مئوية', 'Pourcentage', 'Percent'),
  DURATION_HOURS: w('مدة (ساعات)', 'Durée (heures)', 'Duration (hours)'),
};

/* ------------------------------------------------------------------ *
 * Drill-through
 * ------------------------------------------------------------------ */

/**
 * What a cell opens.
 *
 * These name applications rather than tables, which is a stronger version of what
 * `useBiLabels` already said — "these name screens in this application rather than
 * tables in the database" — because in the OS they really are separate programs
 * and `shell.launch` really opens them. So the word is the one on the other app's
 * window title, not the one in the migration: `bi_dimensions.drill_kind` says
 * `CRM_CUSTOMER` and the person clicking arrives in Customers.
 *
 * The `CRM_` prefixes are dropped for the same reason. A reader who has just
 * clicked a number does not need to know which schema the row lives in.
 */
export const DRILL_LABEL: Readonly<Record<BiDrillKind, Localized>> = {
  BOOKING: w('حجز', 'Réservation', 'Booking'),
  PILGRIM: w('حاج', 'Pèlerin', 'Pilgrim'),
  PACKAGE: w('باقة', 'Forfait', 'Package'),
  INVOICE: w('فاتورة', 'Facture', 'Invoice'),
  PAYMENT: w('دفعة', 'Paiement', 'Payment'),
  JOURNAL_ENTRY: w('قيد يومية', 'Écriture comptable', 'Journal entry'),
  CRM_LEAD: w('عميل محتمل', 'Piste', 'Lead'),
  CRM_OPPORTUNITY: w('فرصة', 'Opportunité', 'Opportunity'),
  CRM_QUOTE: w('عرض سعر', 'Devis', 'Quote'),
  CRM_CUSTOMER: w('عميل', 'Client', 'Customer'),
  DOCUMENT: w('وثيقة', 'Document', 'Document'),
};

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

/**
 * All thirty-three chart types, in the order the union declares them.
 *
 * Key order is kept identical to `BiChartType` and to the migration's CHECK so the
 * three lists can be read side by side — a `Record` does not care, but the person
 * adding the thirty-fourth does. `./model`'s `CHART_FAMILY` covers the same keys
 * and answers a different question: this file says what a type is called, that one
 * says whether anything can draw it.
 *
 * Several names are loanwords in all three languages — Sankey, Gantt, Pareto,
 * treemap, radar — and are left as they are. Inventing an Arabic calque for a
 * diagram named after the engineer who published it in 1898 would leave an analyst
 * unable to search for what they are looking at.
 */
export const CHART_LABEL: Readonly<Record<BiChartType, Localized>> = {
  TABLE: w('جدول', 'Tableau', 'Table'),
  PIVOT: w('جدول محوري', 'Tableau croisé', 'Pivot table'),
  KPI: w('مؤشر', 'Indicateur', 'KPI'),
  LINE: w('خط', 'Courbe', 'Line'),
  AREA: w('مساحة', 'Aire', 'Area'),
  BAR: w('أعمدة أفقية', 'Barres', 'Bar'),
  COLUMN: w('أعمدة', 'Colonnes', 'Column'),
  STACKED_BAR: w('أعمدة أفقية مكدّسة', 'Barres empilées', 'Stacked bar'),
  STACKED_COLUMN: w('أعمدة مكدّسة', 'Colonnes empilées', 'Stacked column'),
  PIE: w('دائري', 'Camembert', 'Pie'),
  DONUT: w('حلقي', 'Anneau', 'Donut'),
  SCATTER: w('انتشار', 'Nuage de points', 'Scatter'),
  BUBBLE: w('فقاعات', 'Bulles', 'Bubble'),
  WATERFALL: w('شلال', 'Cascade', 'Waterfall'),
  BRIDGE: w('جسر', 'Pont', 'Bridge'),
  BULLET: w('هدف', 'Bullet', 'Bullet'),
  HISTOGRAM: w('مدرّج تكراري', 'Histogramme', 'Histogram'),
  BOX_PLOT: w('صندوقي', 'Boîte à moustaches', 'Box plot'),
  HEATMAP: w('خريطة حرارية', 'Carte de chaleur', 'Heatmap'),
  TREEMAP: w('خريطة شجرية', 'Treemap', 'Treemap'),
  DECOMPOSITION_TREE: w('شجرة تفكيك', 'Arbre de décomposition', 'Decomposition tree'),
  SANKEY: w('سانكي', 'Sankey', 'Sankey'),
  FUNNEL: w('قمع', 'Entonnoir', 'Funnel'),
  GANTT: w('غانت', 'Gantt', 'Gantt'),
  CORRELATION_MATRIX: w('مصفوفة ارتباط', 'Matrice de corrélation', 'Correlation matrix'),
  PARETO: w('باريتو', 'Pareto', 'Pareto'),
  FORECAST_BAND: w('نطاق تنبؤ', 'Bande de prévision', 'Forecast band'),
  SENSITIVITY_MATRIX: w('مصفوفة حساسية', 'Matrice de sensibilité', 'Sensitivity matrix'),
  DEPENDENCY_GRAPH: w('مخطط تبعيات', 'Graphe de dépendances', 'Dependency graph'),
  DRIVER_TREE: w('شجرة محرّكات', 'Arbre de facteurs', 'Driver tree'),
  RADAR: w('راداري', 'Radar', 'Radar'),
  GAUGE: w('مقياس', 'Jauge', 'Gauge'),
  COMBO: w('مركّب', 'Combiné', 'Combo'),
};
