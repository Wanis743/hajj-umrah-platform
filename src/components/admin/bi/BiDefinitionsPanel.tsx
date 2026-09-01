/**
 * The authoring shell: which dataset is being defined, or a new one.
 *
 * The pane below needs a dataset id, and the id has to come from somewhere -- so this
 * screen is the one that chooses, the same split the analysis builder makes between its
 * picker and its canvas. Four decisions are worth naming.
 *
 * 1. Two reads, not one. `catalog()` lists the datasets and the sources a new one may
 *    bind; `overview()` carries `capabilities.can_define`, which `BiDatasetDetail` does
 *    not. A capabilities read that failed is treated as "no privilege" rather than "no
 *    answer yet": offering a Save the server will refuse is worse than a read-only screen
 *    a reload can widen.
 * 2. An unqueryable dataset is still authorable. `get_bi_dataset_detail` checks
 *    `has_permission('bi_datasets','read')` and row scope -- not the source's own
 *    `required_permission` -- so a dataset nobody here can query is one whose definitions
 *    are still editable. The analysis builder disables those options because running a
 *    query does need that grant; this picker states the fact on the label and leaves the
 *    option live.
 * 3. A new dataset is saved before its source columns are offered. A default time column
 *    and a row filter are chosen from `bi_source_columns`, which only the detail read
 *    returns, so the first Save carries key, name and source, and the second pass -- in
 *    the pane, against real columns -- carries the rest. `datasetIssues` agrees: it raises
 *    the two source-dependent issues only while no source is named at all.
 * 4. The pane is keyed on the dataset id. Its own form reset watches
 *    `updated_at|status|version`, and two datasets seeded in one transaction can share all
 *    three -- which would leave the previous dataset's unsaved name standing over the new
 *    one's dimensions. Remounting is the cheaper guarantee.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { biAnalytics } from '@/services/biAnalytics';
import { biCommands } from '@/services/domainCommands';
import type {
  BiCatalog, BiDatasetSummary, BiSourceColumn, BiSourceSummary, BiStudioOverview,
} from '@/types/bi';
import { GroupLabel, InlineNote, NoticeBar, Panel, Pill } from './atoms';
import { BiDatasetAuthoring } from './BiDatasetAuthoring';
import { DatasetFormCard } from './BiDefinitionForms';
import type { DefinitionFilterField } from './BiFormFields';
import { datasetInput, emptyDatasetForm, type DatasetForm } from './biDefinitionState';
import { fmtInt, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import { useBiCommand } from './useBiCommand';

/** Stable empty lists. A `?? []` in the body is a new array on every render, which
 *  `react-hooks/exhaustive-deps` reads as a changed dependency. */
const NO_DATASETS: readonly BiDatasetSummary[] = [];
const NO_SOURCES: readonly BiSourceSummary[] = [];

/** A dataset that does not exist yet has no columns to offer and nothing to filter on --
 *  decision 3 above. Constants rather than inline literals so the form card is handed the
 *  same identity on every keystroke. */
const NO_COLUMNS: readonly BiSourceColumn[] = [];
const NO_FIELDS: readonly DefinitionFilterField[] = [];

/** What this screen is doing, as a union: nothing chosen, a draft not yet saved, or a
 *  saved dataset being authored. A boolean `creating` beside a `selectedId` would allow
 *  both at once, which is two dataset forms and no way to say which Save is which. */
type Mode =
  | { kind: 'NONE' }
  | { kind: 'NEW'; form: DatasetForm }
  | { kind: 'EDIT'; id: string };

const CLOSED: Mode = { kind: 'NONE' };

export function BiDefinitionsPanel() {
  const { t } = useBiI18n();
  const cmd = useBiCommand();
  const caps = useBiRead<BiStudioOverview>(() => biAnalytics.overview(), []);
  const catalog = useBiRead<BiCatalog>(() => biAnalytics.catalog(), []);
  const [mode, setMode] = useState<Mode>(CLOSED);

  const datasets = catalog.data?.datasets ?? NO_DATASETS;
  const sources = catalog.data?.sources ?? NO_SOURCES;
  // The server's own answer, and `false` while we do not have it -- including the moment
  // before the first read resolves, when a Save rendered on optimism would be pressable.
  const canDefine = caps.data?.capabilities.can_define ?? false;

  // Both reads gate the first paint. With only the catalog gated, the New button would
  // appear a beat after the picker, which reads as a screen changing its mind about what
  // the reader may do.
  if ((catalog.loading && catalog.data === null) || (caps.loading && caps.data === null)) {
    return <Spinner className="p-10" />;
  }

  const create = (form: DatasetForm) => {
    void cmd.run(() => biCommands.dataset.create(datasetInput(form)), {
      notice: t('أُنشئت المجموعة — عرّف أبعادها ومقاييسها',
        'Jeu créé — définissez ses dimensions et ses mesures',
        'Dataset created — now define its dimensions and metrics'),
      // The insert returns its own id, so this moves straight into the pane rather than
      // asking the catalog which of the rows it just reloaded is the new one.
      onSuccess: (row) => {
        catalog.reload();
        setMode(row === null ? CLOSED : { kind: 'EDIT', id: row.id });
      },
    });
  };

  // Choosing clears the last command's notice: a "created" line left standing above a
  // different dataset reads as though that one had just been created.
  const choose = (id: string) => {
    cmd.clear();
    setMode(id === '' ? CLOSED : { kind: 'EDIT', id });
  };

  const startNew = () => {
    cmd.clear();
    setMode({ kind: 'NEW', form: emptyDatasetForm() });
  };

  const draft = mode.kind === 'NEW' ? mode.form : null;

  return (
    <div className="space-y-4">
      <ReadNotes
        catalogError={catalog.error}
        capsError={caps.error}
        onRetry={catalog.reload}
      />

      <DatasetPicker
        datasets={datasets}
        selectedId={mode.kind === 'EDIT' ? mode.id : ''}
        canDefine={canDefine}
        busy={cmd.busy}
        onChoose={choose}
        onNew={startNew}
      />

      {cmd.notice !== null && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}
      {cmd.error !== null && <ErrorBanner message={cmd.error} />}

      {draft !== null && (
        <div className="space-y-2">
          <InlineNote tone="neutral">
            {t('اربط المصدر الآن — عمود الزمن الافتراضي ومرشّح الصفوف يُختاران بعد الحفظ، من أعمدة المصدر نفسها',
              'Liez la source maintenant — la colonne temporelle par défaut et le filtre de lignes se choisissent après l’enregistrement, parmi les colonnes réelles de la source',
              'Bind the source now — the default time column and the row filter are chosen after the first save, from the source’s own columns')}
          </InlineNote>
          <DatasetFormCard
            form={draft}
            sources={sources}
            timeColumns={NO_COLUMNS}
            filterFields={NO_FIELDS}
            existingKey={null}
            busy={cmd.busy}
            onChange={(form) => setMode({ kind: 'NEW', form })}
            onSave={() => create(draft)}
            onCancel={() => setMode(CLOSED)}
          />
        </div>
      )}

      {/* Keyed on the id, per decision 4: a different dataset is a different form, and the
          pane's own stamp cannot always tell two of them apart. */}
      {mode.kind === 'EDIT' && (
        <BiDatasetAuthoring
          key={mode.id}
          datasetId={mode.id}
          sources={sources}
          canDefine={canDefine}
          onSaved={catalog.reload}
        />
      )}

      {mode.kind === 'NONE' && <EmptyChoice canDefine={canDefine} />}
    </div>
  );
}

/**
 * Which dataset, and the one button that makes another.
 *
 * Private to this file so the shell's own return reads as the three states it has. Options
 * are never disabled here -- decision 2 above -- but the label still says when a dataset
 * cannot be queried: that is the same fact the analysis builder greys an option out for,
 * and a reader who met it there is owed the explanation here.
 */
function DatasetPicker({ datasets, selectedId, canDefine, busy, onChoose, onNew }: {
  datasets: readonly BiDatasetSummary[];
  selectedId: string;
  canDefine: boolean;
  busy: boolean;
  onChoose: (id: string) => void;
  onNew: () => void;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  // DRAFT and DEPRECATED both count: neither is a dataset the compiler will accept, and
  // "not published" is the one sentence true of both.
  const unpublished = datasets.filter((dataset) => dataset.status !== 'PUBLISHED').length;
  const choose = t('اختر مجموعة', 'Choisir un jeu', 'Choose a dataset');

  return (
    <Panel
      title={t('التعريفات', 'Définitions', 'Definitions')}
      subtitle={t('مجموعة واحدة: مصدرها، وأبعادها، ومقاييسها',
        'Un jeu : sa source, ses dimensions, ses mesures',
        'One dataset: its source, its dimensions, its metrics')}
      actions={canDefine ? (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onNew}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('مجموعة جديدة', 'Nouveau jeu', 'New dataset')}
        </button>
      ) : null}
    >
      {datasets.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          {canDefine
            ? t('لا مجموعات بعد — ابدأ واحدة', 'Aucun jeu — créez-en un',
              'No datasets yet — start one')
            : t('لا مجموعات بعد', 'Aucun jeu pour l’instant', 'No datasets yet')}
        </p>
      ) : (
        <div className="max-w-xl">
          <GroupLabel>{choose}</GroupLabel>
          <Select
            value={selectedId}
            onChange={(event) => onChoose(event.target.value)}
            className="input"
            disabled={busy}
            aria-label={choose}
          >
            <option value="">{t('— اختر —', '— Choisir —', '— Choose —')}</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {`${(isAr && dataset.name_ar) ? dataset.name_ar : dataset.name}`
                  + ` · ${labels.status[dataset.status]}`
                  + (dataset.readable_by_me ? '' : ` · ${t('غير قابل للاستعلام',
                    'non interrogeable', 'cannot query')}`)}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
            <span className="tabular">
              {t(`${fmtInt(datasets.length)} مجموعة`, `${fmtInt(datasets.length)} jeux`,
                `${fmtInt(datasets.length)} datasets`)}
            </span>
            {unpublished > 0 && (
              <Pill tone="warn">
                {t(`${fmtInt(unpublished)} غير منشورة`, `${fmtInt(unpublished)} non publiés`,
                  `${fmtInt(unpublished)} not published`)}
              </Pill>
            )}
          </p>
        </div>
      )}
    </Panel>
  );
}

/**
 * What the two reads have to say when one of them failed.
 *
 * The two failures are not the same event and are not offered the same recourse. The catalog
 * is the screen: without it there is no picker and no source list, so its error is retryable
 * in place. The capabilities read is a narrower question -- may this reader define anything
 * -- and `canDefine` has already answered `false` beneath this note, so the screen still
 * works for reading and a retry button would only offer to widen it. Saying so is the honest
 * version: a reader who expected a New button learns why it is missing.
 */
function ReadNotes({ catalogError, capsError, onRetry }: {
  catalogError: string | null;
  capsError: string | null;
  onRetry: () => void;
}) {
  const { t } = useBiI18n();

  return (
    <>
      {catalogError !== null && <ErrorBanner message={catalogError} onRetry={onRetry} />}
      {capsError !== null && (
        <InlineNote tone="warn">
          {t('لم تُقرأ الصلاحيات — الشاشة للقراءة حتى تُقرأ',
            'Privilèges non lus — écran en lecture seule jusqu’à leur lecture',
            'Privileges were not read — this screen stays read-only until they are')}
        </InlineNote>
      )}
    </>
  );
}

/**
 * Nothing chosen yet, said in the voice of what the reader may actually do.
 *
 * The privilege changes the sentence, not just the buttons: *"choose a dataset to define, or
 * start a new one"* invites two acts, and one of them is closed to a reader without
 * `can_define`. An empty state that promises a control the reader cannot see is worse than no
 * empty state at all.
 */
function EmptyChoice({ canDefine }: { canDefine: boolean }) {
  const { t } = useBiI18n();

  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-muted)]">
      {canDefine
        ? t('اختر مجموعة لتعريفها، أو ابدأ واحدة جديدة',
          'Choisissez un jeu à définir, ou créez-en un nouveau',
          'Choose a dataset to define, or start a new one')
        : t('اختر مجموعة لقراءة تعريفاتها',
          'Choisissez un jeu pour lire ses définitions',
          'Choose a dataset to read its definitions')}
    </p>
  );
}
