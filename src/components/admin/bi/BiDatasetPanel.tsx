/**
 * The catalog: every dataset this caller may see, and the allow-listed tables a dataset may
 * be defined over.
 *
 * Two facts sit on every row that a definition list usually omits. `readable_by_me` is the
 * source's own permission re-checked for this caller, so a dataset whose definition they may
 * read but whose rows they may never query says so here rather than failing at the first
 * run. And the query count is on the row, because a dataset that answers forty questions a
 * day and one nobody has ever run are not the same kind of object: the first is worth
 * maintaining and the second is a liability with a name.
 *
 * Nothing on this screen writes. Authoring lives in the definition forms; this is the map.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import type { BiCatalog, BiDatasetSummary, BiSourceSummary } from '@/types/bi';
import { GroupLabel, Panel, Pill, StatusPill } from './atoms';
import { fmtInt, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import { BiDatasetDetailPanel } from './BiDatasetDetailPanel';

const STATUS_FILTERS = ['ALL', 'DRAFT', 'PUBLISHED', 'DEPRECATED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** One shared empty array, so an unloaded payload does not hand the filter memo a fresh
 *  identity on every render. */
const NO_DATASETS: readonly BiDatasetSummary[] = [];

export function BiDatasetPanel() {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const { data, loading, error, reload } = useBiRead<BiCatalog>(() => biAnalytics.catalog(), []);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selected, setSelected] = useState<string | null>(null);

  const datasets = data?.datasets ?? NO_DATASETS;
  // Key, both names and the source are all searched: an author looks for "bookings" and a
  // reviewer looks for the table it reads, and both are the same question. The filter reads
  // `data` rather than the derived list, so the memo keys off the payload itself.
  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return (data?.datasets ?? NO_DATASETS).filter((d) => (status === 'ALL' || d.status === status)
      && (needle === ''
        || `${d.key} ${d.name} ${d.name_ar ?? ''} ${d.source_key ?? ''}`
          .toLowerCase().includes(needle)));
  }, [data, text, status]);

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="relative grow">
              <Search
                className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <input
                className="input ps-8"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('ابحث بالمفتاح أو الاسم', 'Clé ou nom', 'Key, name or source')}
                aria-label={t('ابحث في المجموعات', 'Rechercher', 'Search datasets')}
              />
            </label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="input w-auto"
              aria-label={t('الحالة', 'Statut', 'Status')}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'ALL' ? t('كل الحالات', 'Tous', 'All statuses') : labels.status[s]}
                </option>
              ))}
            </Select>
          </div>

          <p className="px-1 text-[11px] text-[var(--text-muted)]">
            {t(`${fmtInt(shown.length)} من ${fmtInt(datasets.length)} مجموعة · ${fmtInt(data?.sources.length ?? 0)} مصدر`,
              `${fmtInt(shown.length)} sur ${fmtInt(datasets.length)} jeux · ${fmtInt(data?.sources.length ?? 0)} sources`,
              `${fmtInt(shown.length)} of ${fmtInt(datasets.length)} datasets · ${fmtInt(data?.sources.length ?? 0)} sources`)}
          </p>

          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center text-[13px] text-[var(--text-muted)]">
              {t('لا مجموعة تطابق البحث', 'Aucun jeu ne correspond', 'No dataset matches')}
            </p>
          ) : (
            <ul className="space-y-2">
              {shown.map((dataset) => (
                <li key={dataset.id}>
                  <DatasetRow
                    dataset={dataset}
                    active={dataset.id === selected}
                    onSelect={() => setSelected(dataset.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected
          ? <BiDatasetDetailPanel datasetId={selected} />
          : <SourcesPanel sources={data?.sources ?? []} />}
      </div>
    </div>
  );
}

/**
 * One dataset in the list.
 *
 * The "cannot query" pill is the load-bearing one: a dataset can be published, complete and
 * still unreadable by this caller, because the source carries its own permission and the
 * semantic layer checks it again at run time. Saying so on the row is the difference between
 * a screen that looks broken later and one that was honest first.
 */
function DatasetRow({ dataset, active, onSelect }: {
  dataset: BiDatasetSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const name = (isAr && dataset.name_ar) ? dataset.name_ar : dataset.name;

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
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{name}</span>
        <StatusPill status={dataset.status} label={labels.status[dataset.status]} />
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
        {dataset.key}
        {dataset.source_key ? ` · ${dataset.source_key}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <span className="tabular">
          {t(`${fmtInt(dataset.dimension_count)} بعد`, `${fmtInt(dataset.dimension_count)} dim.`,
            `${fmtInt(dataset.dimension_count)} dim`)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular">
          {t(`${fmtInt(dataset.metric_count)} مقياس`, `${fmtInt(dataset.metric_count)} mes.`,
            `${fmtInt(dataset.metric_count)} metrics`)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular">
          {t(`${fmtInt(dataset.query_count)} استعلام`, `${fmtInt(dataset.query_count)} requêtes`,
            `${fmtInt(dataset.query_count)} queries`)}
        </span>
        {!dataset.readable_by_me && (
          <Pill tone="warn">{t('غير قابل للاستعلام', 'Non interrogeable', 'Cannot query')}</Pill>
        )}
        {dataset.query_count === 0 && (
          <Pill tone="neutral">{t('لم يُستعلم', 'Jamais interrogé', 'Never queried')}</Pill>
        )}
      </div>
    </button>
  );
}

/**
 * The allowlist, shown where an empty detail pane would otherwise be.
 *
 * These rows are measured from information_schema by `sync_bi_sources_command` and have no
 * client write path at all, not even for an admin through PostgREST -- which is what makes
 * the semantic layer safe to expose: a dataset can only ever be defined over a relation that
 * is already on this list, with the permission this list names.
 *
 * `required_permission` is the column to read. It is checked for the caller in addition to
 * the dataset's own grant, because a definer function that queried a table its caller may not
 * read would be a hole straight through RBAC.
 */
function SourcesPanel({ sources }: { sources: readonly BiSourceSummary[] }) {
  const { t, isAr } = useBiI18n();

  return (
    <Panel
      title={t('المصادر المسموح بها', 'Sources autorisées', 'Allow-listed sources')}
      subtitle={t('اختر مجموعة من القائمة، أو اقرأ ما يمكن تعريف مجموعة عليه',
        'Choisissez un jeu à gauche, ou lisez ce sur quoi un jeu peut être défini',
        'Pick a dataset on the left, or read what a dataset may be defined over')}
    >
      <GroupLabel>
        {t('مقيسة من الكتالوج، بلا مسار كتابة من العميل',
          'Mesurées depuis le catalogue, sans écriture côté client',
          'Measured from the catalog, with no client write path')}
      </GroupLabel>
      {sources.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا مصادر بعد — شغّل المزامنة', 'Aucune source — lancez la synchronisation',
            'No sources yet — run a sync')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[620px]">
            <thead>
              <tr>
                <th>{t('المصدر', 'Source', 'Source')}</th>
                <th>{t('العلاقة', 'Relation', 'Relation')}</th>
                <th>{t('الصلاحية المطلوبة', 'Permission requise', 'Required permission')}</th>
                <th>{t('عمود الزمن', 'Colonne temps', 'Time column')}</th>
                <th className="end">{t('أعمدة', 'Colonnes', 'Columns')}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <span className="font-medium text-[var(--text-primary)]">
                      {(isAr && source.display_name_ar) ? source.display_name_ar : source.display_name}
                    </span>
                    {source.is_branch_scoped && (
                      <Pill tone="info">{t('نطاق الفرع', 'Par agence', 'Branch scoped')}</Pill>
                    )}
                  </td>
                  <td className="font-mono text-[11px] text-[var(--text-secondary)]" dir="ltr">
                    {source.relation}
                  </td>
                  <td className="font-mono text-[11px] text-[var(--text-secondary)]" dir="ltr">
                    {source.required_permission}
                  </td>
                  <td className="font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
                    {source.default_time_column ?? '—'}
                  </td>
                  <td className="end tabular">{fmtInt(source.column_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
