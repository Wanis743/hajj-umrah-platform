/**
 * The analysis builder: pick a dataset, fill two shelves, run it, click into the
 * result.
 *
 * This file is only the dataset choice and the reducer that everything below it
 * dispatches into. The canvas is a separate component for one structural reason: the
 * dataset detail read needs a non-null id, and a hook that has to tolerate a null
 * argument is a hook that will one day be called with one. Choosing a dataset mounts
 * the canvas; the canvas's id is therefore always a real dataset.
 *
 * A dataset the caller may not query is listed and not selectable. Hiding it would
 * make the catalog and this picker disagree about what exists, and `readable_by_me` is
 * the source's own permission re-checked for this caller -- a fact worth showing once
 * here rather than discovering as a refusal after a request has been assembled.
 */
import { useReducer } from 'react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { biAnalytics } from '@/services/biAnalytics';
import type { BiCatalog, BiDatasetSummary } from '@/types/bi';
import { GroupLabel, Panel, Pill } from './atoms';
import { builderReducer, initialBuilderState } from './biBuilderState';
import { fmtInt, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import { BiAnalysisCanvas } from './BiAnalysisCanvas';

/** One shared empty array, so an unloaded payload does not hand the derived counts a
 *  fresh identity on every render. */
const NO_DATASETS: readonly BiDatasetSummary[] = [];

export function BiAnalysisBuilder() {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const { data, loading, error, reload } = useBiRead<BiCatalog>(() => biAnalytics.catalog(), []);
  const [state, dispatch] = useReducer(builderReducer, null, () => initialBuilderState());

  const datasets = data?.datasets ?? NO_DATASETS;
  const blocked = datasets.filter((d) => !d.readable_by_me).length;

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      <Panel
        title={t('مجموعة البيانات', 'Jeu de données', 'Dataset')}
        subtitle={t('كل حقل وكل مقياس أدناه معرّف في هذه المجموعة، ولا شيء غيرها',
          'Chaque champ et chaque mesure ci-dessous est défini dans ce jeu, et nulle part ailleurs',
          'Every field and measure below is defined in this dataset, and nowhere else')}
      >
        <div className="max-w-xl">
          <GroupLabel>{t('اختر مجموعة', 'Choisir un jeu', 'Choose a dataset')}</GroupLabel>
          <Select
            value={state.datasetId ?? ''}
            onChange={(e) => dispatch({
              type: 'DATASET',
              datasetId: e.target.value === '' ? null : e.target.value,
            })}
            className="input"
            aria-label={t('مجموعة البيانات', 'Jeu de données', 'Dataset')}
          >
            <option value="">{t('— اختر —', '— Choisir —', '— Choose —')}</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id} disabled={!dataset.readable_by_me}>
                {`${(isAr && dataset.name_ar) ? dataset.name_ar : dataset.name}`
                  + ` · ${labels.status[dataset.status]}`
                  + (dataset.readable_by_me ? '' : ` · ${t('غير قابل للاستعلام', 'Non interrogeable', 'cannot query')}`)}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
            <span className="tabular">
              {t(`${fmtInt(datasets.length)} مجموعة`, `${fmtInt(datasets.length)} jeux`,
                `${fmtInt(datasets.length)} datasets`)}
            </span>
            {blocked > 0 && (
              <Pill tone="warn">
                {t(`${fmtInt(blocked)} غير قابلة للاستعلام`, `${fmtInt(blocked)} non interrogeables`,
                  `${fmtInt(blocked)} cannot be queried`)}
              </Pill>
            )}
          </p>
        </div>
      </Panel>

      {state.datasetId === null ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-muted)]">
          {t('اختر مجموعة لتبدأ التحليل', 'Choisissez un jeu pour commencer',
            'Choose a dataset to start an analysis')}
        </p>
      ) : (
        <BiAnalysisCanvas datasetId={state.datasetId} state={state} dispatch={dispatch} />
      )}
    </div>
  );
}
